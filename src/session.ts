// doctrine:begin IMPL-001
// 取得の共有 — 地図・見出し・帯・命令が同じひと揃いを見るための層。
//
// なぜ要るか: コード側の面（SPEC-005）は地図を開いていなくても効く。
// 取得を画面が抱えると、画面を開くまで見出しが出ない。取得はここに置き、
// 画面はその読み手の一つにする。上流の CLI を呼ぶのは相変わらずここだけである。
import * as vscode from "vscode";

import { staleDocumentIds } from "./doctrine/audit.js";
import type { RunOptions } from "./doctrine/cli.js";
import { GraphStore, type PartialFetch, type Snapshot } from "./doctrine/graph.js";
import { locateDocsRoot, locatePluginRoot } from "./doctrine/locate.js";
import { messages } from "./l10n.js";
import { carryAudit, NO_AUDIT, type AuditCarry } from "./model/cadence.js";
import { toRelative } from "./model/paths.js";
import { fetchTraceRanges } from "./doctrine/trace.js";
import { actionOnSave, sameRanges } from "./model/trace.js";
import { chooseCandidate, collectCandidates, type TreeCandidate } from "./model/workspace.js";

/** 統治木が続けて変わったときに取得を畳む待ち時間（速い拍）。 */
const FAST_COALESCE_MS = 400;

/** setTimeout が受け取れる上限。超えると実行環境が 1 ミリ秒へ潰す。 */
const MAX_DELAY_MS = 2147483647;

/** 統治木がまだ無いあいだ、敷かれたかを見に行く間隔。 */
const TREE_POLL_MS = 3000;

const CHOSEN_FOLDER_KEY = "doctrineLens.chosenFolder";

/** 候補の集合を一つの字面にする。数ではなく中身で見分けるため。 */
function candidateKey(candidates: readonly TreeCandidate[]): string {
  return candidates.map((c) => `${c.folder}\u0000${c.docsRoot}`).sort().join("\u0001");
}

/** 取得ができない理由。いずれも異常ではない（SPEC-001 エラー時挙動）。 */
export interface Unavailable {
  readonly text: string;
  readonly detail: string;
}

export interface SessionState {
  readonly snapshot: Snapshot | null;
  readonly unavailable: Unavailable | null;
  readonly failure: { reason: string; detail: string } | null;
  readonly partial: readonly PartialFetch[];
  readonly busy: boolean;
  /** いま見ている統治木。候補が無ければ `null`。 */
  readonly candidate: TreeCandidate | null;
  /** 統治木を持つ作業フォルダの数。二つ以上なら切り替えを出す（ADR-006）。 */
  readonly candidateCount: number;
  /** 指紋の判定を取った時刻。一度も取れていなければ `null`（ADR-008）。 */
  readonly auditAt: Date | null;
  /**
   * 指紋が食い違っている文書の数。
   *
   * 速い拍では監査を走らせないので `snapshot.findings` は `null` になる。
   * そこから数えると、保存のたびに 0 へ落ちる（実際に起きた欠陥）。
   * 速い拍でも保たれる `staleIds` から数え、ここに載せる。
   */
  /** 指紋の食い違いの件数。**一度も取れていなければ `null`。** */
  readonly staleCount: number | null;
}

const EMPTY_STATE: SessionState = {
  snapshot: null,
  unavailable: null,
  failure: null,
  partial: [],
  busy: false,
  candidate: null,
  candidateCount: 0,
  auditAt: null,
  staleCount: null,
};

export class LensSession {
  readonly #store = new GraphStore();
  readonly #memento: vscode.Memento;
  readonly #changed = new vscode.EventEmitter<SessionState>();
  readonly #disposables: vscode.Disposable[] = [];
  readonly #watchers: vscode.FileSystemWatcher[] = [];
  #waitTimer: ReturnType<typeof setInterval> | undefined;
  #fastTimer: ReturnType<typeof setTimeout> | undefined;
  #probeTimer: ReturnType<typeof setTimeout> | undefined;
  #auditTimer: ReturnType<typeof setTimeout> | undefined;
  #state: SessionState = EMPTY_STATE;
  #carry: AuditCarry = NO_AUDIT;
  #watchedRoot: string | undefined;
  /**
   * 最後に見ていた統治木。
   *
   * 状態の candidate ではなくこちらを見る。統治木を持たない窓を一度でも挟むと
   * candidate が消え、そのあと別の木を開いても「変わった」と判じられなくなる。
   * 前の木の地図と指紋の食い違いがそのまま新しい木の状態として出る。
   */
  #lastDocsRoot: string | undefined;

  readonly onDidChange = this.#changed.event;

  constructor(memento: vscode.Memento) {
    this.#memento = memento;
    this.#disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("doctrineLens")) void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.#forget();
        this.#installWatcher();
        void this.refresh();
      }),
    );
    this.#installWatcher();
  }

  dispose(): void {
    if (this.#fastTimer) clearTimeout(this.#fastTimer);
    if (this.#probeTimer) clearTimeout(this.#probeTimer);
    if (this.#auditTimer) clearTimeout(this.#auditTimer);
    this.#stopWaiting();
    for (const watcher of this.#watchers.splice(0)) watcher.dispose();
    for (const item of this.#disposables.splice(0)) item.dispose();
    this.#changed.dispose();
  }

  get state(): SessionState {
    return this.#state;
  }

  get snapshot(): Snapshot | null {
    return this.#state.snapshot;
  }

  /** 上流が指紋の食い違いを挙げた文書の id。判定は上流が済ませてある（ADR-005）。 */
  get staleIds(): ReadonlySet<string> {
    // 取れていない回は空で返す。**「食い違っている」と印を付ける先が無い**だけで、
    // 「食い違いが無い」とは言わない。件数は `staleCount` が `null` で言う（ADR-023）。
    return this.#carry.staleIds ?? new Set();
  }

  /** 統治木を持つ作業フォルダの候補（ADR-006）。 */
  candidates(): TreeCandidate[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const override = vscode.workspace
      .getConfiguration("doctrineLens")
      .get<string>("docsRoot", "");
    return collectCandidates(
      folders.map((f) => f.uri.fsPath),
      (folder) => locateDocsRoot(folder, override),
    );
  }

  /** 見る統治木を選び直す（ADR-006）。 */
  async choose(folder: string): Promise<void> {
    await this.#memento.update(CHOSEN_FOLDER_KEY, folder);
    this.#forget();
    await this.refresh();
  }

  /**
   * 取得した結果と判定を捨てる。
   *
   * 統治木の同一性が変わったら判定も捨てる。残すと、別の木の食い違いを
   * いまの木の数として出す。id は木をまたいで衝突するので、
   * 別のプロジェクトのコードに誤った印が付く。
   */
  #forget(): void {
    this.#store.clear();
    this.#carry = NO_AUDIT;
    this.#watchedRoot = undefined;
    this.#lastDocsRoot = undefined;
  }

  /**
   * 編集器の位置を、上流が使う相対パスへ直す。
   *
   * 上流は作業フォルダからの相対・`/` 区切りで返す。作業フォルダの外なら `null`。
   * Windows の区切りと大小文字は `toRelative` が吸収する。
   */
  toRelativePath(uri: vscode.Uri): string | null {
    const folder = this.#state.candidate?.folder;
    if (!folder || uri.scheme !== "file") return null;
    return toRelative(folder, uri.fsPath);
  }

  /**
   * 保存を受け取る（SPEC-005 制約）。
   *
   * 何をするかを判じるのは src/model/trace.ts の純粋な関数である。ここは
   * 編集器の位置を相対パスへ直して渡し、決まったことを実行するだけ。
   */
  onDidSave(uri: vscode.Uri): void {
    const relPath = this.toRelativePath(uri);
    const folder = this.#state.candidate?.folder;
    const docsRoot = this.#state.candidate?.docsRoot;
    const docsRel = folder && docsRoot ? toRelative(folder, docsRoot) : null;
    const action = actionOnSave(relPath, docsRel, this.#state.snapshot?.ranges ?? null);
    if (action === "refresh") this.scheduleRefresh();
    else if (action === "probe") this.#scheduleProbe();
  }

  /**
   * 範囲だけを上流へ一本訊く。増減していたら取り直す。
   *
   * まだ知らないファイルの保存で使う。印を新しく書いた原本を拾うためである。
   * すべて取り直すと上流の CLI が七本走るので、ここは一本で済ませる。
   */
  #scheduleProbe(): void {
    const config = vscode.workspace.getConfiguration("doctrineLens");
    if (!config.get<boolean>("autoRefresh", true)) return;
    if (this.#probeTimer) clearTimeout(this.#probeTimer);
    this.#probeTimer = setTimeout(() => {
      this.#probeTimer = undefined;
      void this.#probe();
    }, FAST_COALESCE_MS);
  }

  async #probe(): Promise<void> {
    const chosen = this.#state.candidate;
    const known = this.#state.snapshot?.ranges;
    if (!chosen || !known) return;
    const config = vscode.workspace.getConfiguration("doctrineLens");
    const pluginRoot = locatePluginRoot(chosen.folder, config.get<string>("pluginPath", ""));
    if (!pluginRoot) return;
    const outcome = await fetchTraceRanges(chosen.folder, chosen.docsRoot, pluginRoot, {
      pythonPath: config.get<string>("pythonPath", "python3"),
      timeoutMs: config.get<number>("timeoutMs", 20000),
      cwd: chosen.folder,
    });
    if (!outcome.ok) return;
    // 範囲の集合が変わっていれば、印が足された（あるいは消えた）ということである。
    if (!sameRanges(known, outcome.value)) this.scheduleRefresh();
  }

  /**
   * 上流が使う相対パスを、編集器の位置へ直す。
   *
   * **座標系を呼び手が言う。** 上流は二つの基準で相対パスを返す——
   * 範囲（`trace-index`）は作業フォルダ基準、所見（`docs-audit`）は統治木基準。
   * 既定を作業フォルダに寄せていたので、**所見の道は一度も開けていなかった**
   * （実測。`lens/spec/SPEC-006-….md` を作業フォルダに継いで「見つからない」を出していた。
   * `CHANGE-027`）。
   */
  toUri(relPath: string, base: "workspace" | "docs"): vscode.Uri | null {
    const candidate = this.#state.candidate;
    const root = base === "docs" ? candidate?.docsRoot : candidate?.folder;
    if (!root) return null;
    return vscode.Uri.joinPath(vscode.Uri.file(root), ...relPath.split("/"));
  }

  /**
   * 取り直す。
   *
   * `withAudit` が偽なら監査を飛ばす（速い拍。ADR-008）。
   * 飛ばしたときは、前回の判定と、それを取った時刻をそのまま保つ。
   */
  async refresh(withAudit = true): Promise<void> {
    const candidates = this.candidates();
    const chosen = chooseCandidate(candidates, this.#memento.get<string>(CHOSEN_FOLDER_KEY));

    if (!vscode.workspace.workspaceFolders?.length) {
      this.#forget();
      // 見る先が無くなったのに 3 秒ごとの見張りが残ると、閉じたあとも回り続ける。
      this.#stopWaiting();
      this.#emit({ ...EMPTY_STATE, unavailable: { text: messages.noWorkspace(), detail: "" } });
      return;
    }
    if (!chosen) {
      this.#forget();
      this.#lastCandidateKey = candidateKey(candidates);
      // 敷かれるのを待つ。監視が取り落としても数秒で追いつく。
      this.#installWatcher();
      this.#waitForTree();
      // 設定で指したのに見つからない場合と、そもそも無い場合を区別して伝える。
      const override = vscode.workspace
        .getConfiguration("doctrineLens")
        .get<string>("docsRoot", "")
        .trim();
      // **木を敷く手立ては、その plugin が提供するものである。**
      // 木も plugin も無いのは初回の利用者そのものなのに、ここで返ると
      // plugin の導入手順が永久に出ない。先に見て、無ければ両方を告げる。
      const pluginForHint = locatePluginRoot(
        candidates[0]?.folder ?? "",
        vscode.workspace.getConfiguration("doctrineLens").get<string>("pluginPath", "").trim(),
      );
      this.#emit({
        ...EMPTY_STATE,
        unavailable: override
          ? { text: messages.docsRootRejected(override), detail: messages.docsRootRejectedDetail() }
          : {
              text: messages.noTree(),
              detail: pluginForHint
                ? messages.noTreeDetail()
                : `${messages.noTreeDetail()}\n\n${messages.noPlugin()}\n${messages.noPluginDetail()}`,
            },
      });
      return;
    }
    // 見る木が変わったら、前の木の判定を持ち越さない。
    if (this.#lastDocsRoot !== undefined && this.#lastDocsRoot !== chosen.docsRoot) {
      this.#forget();
    }
    this.#lastDocsRoot = chosen.docsRoot;
    this.#lastCandidateKey = candidateKey(candidates);
    // 見張りは止めない。木が消えた・戻った・二つ目に敷かれた、のどれも
    // ファイルの監視だけでは拾えないためである（ディレクトリごと消える回は
    // 監視が発火せず、45 秒待っても取り直しが一度も走らなかった）。
    // 見るのは候補の集合の同一性だけで、statSync が数回走るに過ぎない。
    this.#waitForTree();

    const config = vscode.workspace.getConfiguration("doctrineLens");
    const override = config.get<string>("pluginPath", "").trim();
    const pluginRoot = locatePluginRoot(chosen.folder, override);
    if (!pluginRoot) {
      this.#carry = NO_AUDIT;
      // 設定で指したのに解決できない場合と、そもそも入っていない場合を分ける。
      // 分けないと、入っているのに指定を誤った利用者へ「導入せよ」と案内して
      // しまい、直し方に辿り着けない。
      this.#emit({
        ...EMPTY_STATE,
        candidate: chosen,
        candidateCount: candidates.length,
        unavailable: override
          ? { text: messages.pluginPathRejected(override), detail: "" }
          : { text: messages.noPlugin(), detail: messages.noPluginDetail() },
      });
      return;
    }

    const options: RunOptions = {
      pythonPath: config.get<string>("pythonPath", "python3"),
      timeoutMs: config.get<number>("timeoutMs", 20000),
      cwd: chosen.folder,
    };

    this.#emit({ busy: true, candidate: chosen, candidateCount: candidates.length });
    try {
      const result = await this.#store.refresh(
        chosen.folder,
        chosen.docsRoot,
        pluginRoot,
        options,
        withAudit,
      );
      // 待っているあいだに見る木が変わっていたら、この結果はもう別の木の話である。
      // 出すと、捨てたはずの地図と食い違いの数が新しい木の状態として現れる。
      // 新しい木の取り直しは、切り替えた側が既に走らせている。
      if (this.#lastDocsRoot !== chosen.docsRoot) return;

      // 監査を飛ばした回は、前回の判定と時刻を保つ（ADR-008・受入基準 10）。
      // 引き継ぎの規則は carryAudit に一つだけ置いてある。
      const findings = result.failure === null ? result.snapshot?.findings : null;
      this.#carry = carryAudit(this.#carry, {
        withAudit,
        failed: result.failure !== null,
        staleIds: findings ? staleDocumentIds(findings) : null,
        findings: findings ?? null,
        checksRun: result.snapshot?.checksRun ?? [],
      });
      const auditAt = this.#carry.auditAt;
      // 監査を飛ばした回の取得は判定を持たない。持たない値で前回の判定を
      // 上書きしない。事実（図・範囲・題名）は新しいものをそのまま出す。
      const snapshot = result.snapshot
        ? {
            ...result.snapshot,
            findings: this.#carry.findings ? [...this.#carry.findings] : null,
            checksRun: this.#carry.checksRun ? [...this.#carry.checksRun] : null,
          }
        : result.snapshot;
      this.#emit({
        snapshot,
        failure: result.failure,
        partial: result.partial,
        unavailable: null,
        busy: false,
        candidate: chosen,
        candidateCount: candidates.length,
        auditAt,
        staleCount: this.#carry.staleIds?.size ?? null,
      });
      // 見る木が決まった／変わったら、その木を監視し直す。
      if (this.#watchedRoot !== chosen.docsRoot) {
        this.#watchedRoot = chosen.docsRoot;
        this.#installWatcher();
      }
    } catch (error) {
      // 取得で拡張機能が止まってはならない（SPEC-001）。
      this.#emit({
        failure: { reason: "exit-nonzero", detail: String(error) },
        busy: false,
      });
    }
  }

  #emit(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    // 統治木の有無を編集器の文脈へ出す。右クリックの項目をこれで絞る。
    // 統治木を持たないプロジェクトの全ファイルに項目を挿し込まないため。
    const hasTree = this.#state.candidate !== null && this.#state.candidate !== undefined;
    if (hasTree !== this.#hasTree) {
      this.#hasTree = hasTree;
      void vscode.commands.executeCommand("setContext", "doctrineLens.hasTree", hasTree);
    }
    this.#changed.fire(this.#state);
  }

  #hasTree: boolean | undefined;

  /**
   * 統治木の `.md` と、印を持ちうる原本の保存を見る。
   *
   * 監視は保存の合図にだけ使う。何が変わったかは上流に問い直して知る。
   */
  #installWatcher(): void {
    for (const watcher of this.#watchers.splice(0)) watcher.dispose();
    // いま見ている木を監視する。作業フォルダの一つ目に固定すると、
    // docsRoot で下位を指した木や、二つ目のフォルダの木の変更を拾わない。
    const target = this.#state.candidate?.docsRoot;
    const schedule = (): void => this.scheduleRefresh();
    const watch = (base: string, glob: string): void => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(base), glob),
      );
      watcher.onDidChange(schedule);
      watcher.onDidCreate(schedule);
      watcher.onDidDelete(schedule);
      this.#watchers.push(watcher);
    };

    if (target) watch(target, "**/*.md");

    // 木がまだ無いフォルダも見る。
    //
    // 一つ目のフォルダだけを見ると、二つ目以降に敷かれた木を取り落とす。
    // 拡張子を `.md` に絞ると、`_system/` を作った時点では何も起きない。
    // どちらも「案内どおりに敷いたのに何も起きない」に化ける。
    // 一つ見つけたあとも他のフォルダを見続ける。見るのをやめると、二つ目に
    // 木を敷いても切り替えの選択肢が出ない（ADR-006 が想定する構成である）。
    const withTree = new Set(this.candidates().map((c) => c.folder));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (withTree.has(folder.uri.fsPath)) continue;
      watch(folder.uri.fsPath, "{doctrine_docs,docs}/**");
    }
  }

  /**
   * 木が敷かれるのを軽く待つ。
   *
   * 監視だけに頼ると、監視が武装し終わる前に木が作られた回を取り落とす。
   * 実測で、案内どおりに敷いても半分の回は何も起こらなかった。取りこぼしても
   * 数秒で追いつくよう、木が無いあいだだけ場所の解決を試す。
   * 解決は statSync を数回するだけで、上流の CLI は起こさない。
   */
  #waitForTree(): void {
    if (this.#waitTimer) return;
    // 見るのは候補の集合そのものである。数だけを見ると、片方が消えて片方が
    // 増えた回を取り落とす。いま見ている木が消えた回も、これで拾える。
    this.#waitTimer = setInterval(() => {
      const now = candidateKey(this.candidates());
      if (now === this.#lastCandidateKey) return;
      void this.refresh();
    }, TREE_POLL_MS);
  }

  /** いま見えている候補の集合を、一つの字面にする。 */
  #lastCandidateKey = "";

  #stopWaiting(): void {
    if (this.#waitTimer) clearInterval(this.#waitTimer);
    this.#waitTimer = undefined;
  }

  /**
   * 取り直しを予約する（ADR-008）。
   *
   * 速い拍（登録簿・グラフ・範囲）を短い畳みで走らせ、
   * 監査はそれより長い畳みで別に走らせる。設定が `0` なら監査は自動で走らせない。
   */
  scheduleRefresh(): void {
    const config = vscode.workspace.getConfiguration("doctrineLens");
    if (!config.get<boolean>("autoRefresh", true)) return;

    // 木が汚れた。以降の要求が、汚れる前に始まった取得へ相乗りしないようにする。
    this.#store.markDirty();

    if (this.#fastTimer) clearTimeout(this.#fastTimer);
    this.#fastTimer = setTimeout(() => {
      this.#fastTimer = undefined;
      void this.refresh(false);
    }, FAST_COALESCE_MS);

    // 待ち時間は丸める。32bit を超える値を渡すと実行環境が 1 ミリ秒へ潰すので、
    // 「めったに走らせない」つもりの設定が「保存のたびに即座に全件監査」になる
    // （利用者の意図の正反対で、案内も出ない。実際に再現した）。
    // 0 は「自動で走らせない」の意なので、丸める前に分ける。
    const configured = config.get<number>("auditDebounceMs", 2500);
    if (this.#auditTimer) clearTimeout(this.#auditTimer);
    if (!Number.isFinite(configured) || configured <= 0) return;
    const auditDelay = Math.min(Math.trunc(configured), MAX_DELAY_MS);
    this.#auditTimer = setTimeout(() => {
      this.#auditTimer = undefined;
      void this.refresh(true);
    }, auditDelay);
  }
}
// doctrine:end IMPL-001
