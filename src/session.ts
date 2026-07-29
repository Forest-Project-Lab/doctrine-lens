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
import { carryAudit, NO_AUDIT } from "./model/cadence.js";
import { toRelative } from "./model/paths.js";
import { shouldRefreshOnSave } from "./model/trace.js";
import { chooseCandidate, collectCandidates, type TreeCandidate } from "./model/workspace.js";

/** 統治木が続けて変わったときに取得を畳む待ち時間（速い拍）。 */
const FAST_COALESCE_MS = 400;

/** 統治木がまだ無いあいだ、敷かれたかを見に行く間隔。 */
const TREE_POLL_MS = 3000;

const CHOSEN_FOLDER_KEY = "doctrineLens.chosenFolder";

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
  readonly staleCount: number;
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
  staleCount: 0,
};

export class LensSession {
  readonly #store = new GraphStore();
  readonly #memento: vscode.Memento;
  readonly #changed = new vscode.EventEmitter<SessionState>();
  readonly #disposables: vscode.Disposable[] = [];
  readonly #watchers: vscode.FileSystemWatcher[] = [];
  #waitTimer: ReturnType<typeof setInterval> | undefined;
  #fastTimer: ReturnType<typeof setTimeout> | undefined;
  #auditTimer: ReturnType<typeof setTimeout> | undefined;
  #state: SessionState = EMPTY_STATE;
  #staleIds: ReadonlySet<string> = NO_AUDIT.staleIds;
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
    return this.#staleIds;
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
    this.#staleIds = NO_AUDIT.staleIds;
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
   * その保存で取り直すべきか（SPEC-005 制約）。
   *
   * 判じるのは src/model/trace.ts の純粋な関数である。ここは編集器の位置を
   * 相対パスへ直して渡すだけ。
   */
  wantsRefreshFor(uri: vscode.Uri): boolean {
    const relPath = this.toRelativePath(uri);
    const folder = this.#state.candidate?.folder;
    const docsRoot = this.#state.candidate?.docsRoot;
    const docsRel = folder && docsRoot ? toRelative(folder, docsRoot) : null;
    return shouldRefreshOnSave(relPath, docsRel, this.#state.snapshot?.ranges ?? null);
  }

  /** 上流が使う相対パスを、編集器の位置へ直す。 */
  toUri(relPath: string): vscode.Uri | null {
    const folder = this.#state.candidate?.folder;
    if (!folder) return null;
    return vscode.Uri.joinPath(vscode.Uri.file(folder), ...relPath.split("/"));
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
      // 敷かれるのを待つ。監視が取り落としても数秒で追いつく。
      this.#installWatcher();
      this.#waitForTree();
      // 設定で指したのに見つからない場合と、そもそも無い場合を区別して伝える。
      const override = vscode.workspace
        .getConfiguration("doctrineLens")
        .get<string>("docsRoot", "")
        .trim();
      this.#emit({
        ...EMPTY_STATE,
        unavailable: override
          ? { text: messages.docsRootRejected(override), detail: messages.docsRootRejectedDetail() }
          : { text: messages.noTree(), detail: messages.noTreeDetail() },
      });
      return;
    }
    // 見る木が変わったら、前の木の判定を持ち越さない。
    if (this.#lastDocsRoot !== undefined && this.#lastDocsRoot !== chosen.docsRoot) {
      this.#forget();
    }
    this.#lastDocsRoot = chosen.docsRoot;
    // まだ木を持たない作業フォルダが残っているなら、見張りは続ける。
    // 二つ目のフォルダに木を敷いたときに切り替えの選択肢が出るようにするため。
    if (candidates.length >= (vscode.workspace.workspaceFolders?.length ?? 0)) {
      this.#stopWaiting();
    } else {
      this.#waitForTree();
    }

    const config = vscode.workspace.getConfiguration("doctrineLens");
    const override = config.get<string>("pluginPath", "").trim();
    const pluginRoot = locatePluginRoot(chosen.folder, override);
    if (!pluginRoot) {
      this.#staleIds = NO_AUDIT.staleIds;
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
      const carried = carryAudit(
        { auditAt: this.#state.auditAt, staleIds: this.#staleIds },
        {
          withAudit,
          failed: result.failure !== null,
          staleIds: findings ? staleDocumentIds(findings) : null,
        },
      );
      const auditAt = carried.auditAt;
      this.#staleIds = carried.staleIds;
      this.#emit({
        snapshot: result.snapshot,
        failure: result.failure,
        partial: result.partial,
        unavailable: null,
        busy: false,
        candidate: chosen,
        candidateCount: candidates.length,
        auditAt,
        staleCount: this.#staleIds.size,
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
    // 見張りが見るのは「木を持つフォルダの数が変わったか」だけである。
    // 数が変わったときに取り直せば、その回で監視も張り直される。
    this.#waitTimer = setInterval(() => {
      if (this.candidates().length === this.#state.candidateCount) return;
      void this.refresh();
    }, TREE_POLL_MS);
  }

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

    const auditDelay = config.get<number>("auditDebounceMs", 2500);
    if (this.#auditTimer) clearTimeout(this.#auditTimer);
    if (auditDelay <= 0) return;
    this.#auditTimer = setTimeout(() => {
      this.#auditTimer = undefined;
      void this.refresh(true);
    }, auditDelay);
  }
}
