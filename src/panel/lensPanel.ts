// doctrine:begin IMPL-001
// 画面の器 — webview の生成と受け渡し（IMPL-001）。
//
// 取得そのものは LensSession が持つ。ここはその読み手の一つである。
// 明細の組み立ては `src/model/consequence.ts` と `src/model/view.ts` が持つ。
// ここがするのは、起点をカーソルから決めることと、組んだ結果を webview へ流すこと、
// そして webview から来た「開け」を編集器へつなぐことだけである。
import * as vscode from "vscode";

import type { PartialFetch } from "../doctrine/graph.js";
import { adviceFor, messages, shellStrings, viewStrings } from "../l10n.js";
import { buildConsequence } from "../model/consequence.js";
import { rangeAtLine, toEditorLine } from "../model/trace.js";
import { buildView, formatTime } from "../model/view.js";
import type { LensSession, SessionState } from "../session.js";
import type { ToHost, ToWebview } from "../shared/protocol.js";
import { renderHtml } from "./html.js";

const VIEW_TYPE = "doctrineLens.consequence";

/** 部分的に取れなかったものの名前を訳す（ADR-007）。
 *
 * **引数を `PartialFetch["what"]` で受ける**（CHANGE-029）。`string` で受けていたので、
 * 生産者が一人も居ない枝（`"titles"`）が型に咎められずに残っていた。
 * 題名の欠けは部分的な失敗ではなく、脚注（`footNoTitles`）で告げる設計である
 * （`ADR-020` で継ぎを捨てたときに移った）。 */
function partialName(what: PartialFetch["what"]): string {
  if (what === "registry") return messages.partialRegistry();
  if (what === "ranges") return messages.partialRanges();
  if (what === "orphans") return messages.partialOrphans();
  if (what === "glossary") return messages.partialGlossary();
  return messages.partialFindings();
}

/**
 * 部分的に取れなかったものの診断。
 *
 * `absent` は「この構成である限り永久に取れない」を意味する。一時的な失敗と
 * 同じ見え方にすると、読み手は待てば直ると思い、直し方に辿り着けない。
 */
function partialDetail(partial: readonly { reason: string; detail: string }[]): string {
  return partial
    .filter((p) => p.detail)
    .map((p) => (p.reason === "absent" ? p.detail : `${p.reason}: ${p.detail}`))
    .join("\n");
}

export class LensPanel {
  /** 器の種類。復元器の登録に使う。 */
  static readonly viewType = VIEW_TYPE;

  static #current: LensPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  readonly #session: LensSession;
  readonly #disposables: vscode.Disposable[] = [];

  /**
   * 直前に組んだ明細。同じ起点・同じ取得なら組み直さない。
   *
   * カーソルが動くたびに組み直す設計なので、矢印キー一回ごとに全部を組む。
   * 起点は「印が囲む範囲」の単位なので、その範囲の中で動いている間は
   * 答えが変わらない。実測で 6000 文書の木の組み立てに 2 秒かかる
   * （`descendantCounts` が節点ごとに幅優先を回すため O(V²) である）。
   * 打鍵のたびに 2 秒待たせないために、鍵が同じなら前の結果をそのまま出す。
   */
  #last: { readonly key: string; readonly view: ToWebview & { kind: "view" } } | null = null;
  #lastSnapshot: unknown = null;

  /**
   * 直前に前面に在った文章編集器。
   *
   * **明細が焦点を取ると `activeTextEditor` は `undefined` になる。**
   * 焦点が外れたことと「起点が無い」ことは別である（`ADR-023`）。
   * 覚えていないと、明細を触ろうとした瞬間に明細そのものが消える——
   * 脚注の行き先も循環の行も、押すために焦点を取ると押す対象ごと描き直された
   * （`CHANGE-028`）。
   */
  #lastEditor: vscode.TextEditor | undefined;

  static show(context: vscode.ExtensionContext, session: LensSession): LensPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (LensPanel.#current) {
      LensPanel.#current.#panel.reveal(column);
      return LensPanel.#current;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, shellStrings().title, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    LensPanel.#current = new LensPanel(panel, context, session);
    return LensPanel.#current;
  }

  /**
   * 編集器が復元した器を受け取る。
   *
   * 復元器を登録しないと、窓を開き直したときにタブが黙って消える。
   */
  static revive(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    session: LensSession,
  ): void {
    if (LensPanel.#current) {
      panel.dispose();
      return;
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    };
    LensPanel.#current = new LensPanel(panel, context, session);
  }

  static get current(): LensPanel | undefined {
    return LensPanel.#current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    session: LensSession,
  ) {
    this.#panel = panel;
    this.#session = session;

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
    );
    panel.webview.html = renderHtml(panel.webview, scriptUri, vscode.env.language, shellStrings());

    this.#disposables.push(
      panel.webview.onDidReceiveMessage((message: ToHost) => {
        void this.#onMessage(message);
      }),
      panel.onDidDispose(() => this.dispose()),
      session.onDidChange((state) => this.#publish(state)),
      // 起点はカーソルから決まる。動いたら組み直す。
      // 組み直しは純粋な関数だけなので、上流を起こさない。
      vscode.window.onDidChangeActiveTextEditor(() => this.#publish(session.state)),
      vscode.window.onDidChangeTextEditorSelection(() => this.#publish(session.state)),
    );
  }

  dispose(): void {
    LensPanel.#current = undefined;
    for (const item of this.#disposables.splice(0)) item.dispose();
    this.#panel.dispose();
  }

  // --- 内側 --------------------------------------------------------------

  #post(message: ToWebview): void {
    void this.#panel.webview.postMessage(message);
  }

  /**
   * いま開いている位置から起点の文書を決める。
   *
   * 印が囲む範囲の中に居ればその文書。統治木の `.md` を開いていればその文書。
   * どちらでもなければ起点は無い（利用者に選ばせない。ADR-012）。
   */
  #originId(): { id: string | null; openFile: string } {
    // 前面に文章編集器が在るあいだは、それを覚える。無いときは覚えたほうを見る。
    // 閉じられた編集器は捨てる（消えた文書を起点として出さない）。
    if (vscode.window.activeTextEditor) this.#lastEditor = vscode.window.activeTextEditor;
    else if (this.#lastEditor?.document.isClosed) this.#lastEditor = undefined;
    const editor = vscode.window.activeTextEditor ?? this.#lastEditor;
    const state = this.#session.state;
    if (!editor) return { id: null, openFile: "" };
    const relPath = this.#session.toRelativePath(editor.document.uri);
    const openFile = relPath ?? editor.document.fileName;
    if (!relPath) return { id: null, openFile };

    const ranges = state.snapshot?.ranges;
    if (ranges) {
      const hit = rangeAtLine(ranges, relPath, editor.selection.active.line + 1);
      if (hit) return { id: hit.id, openFile };
    }
    // 統治木の中の文書そのものを開いているとき。
    const docsRoot = state.candidate?.docsRoot;
    const node = state.snapshot?.graph.nodes.find((n) => {
      if (!docsRoot) return false;
      const full = vscode.Uri.joinPath(vscode.Uri.file(docsRoot), n.path).fsPath;
      return full === editor.document.uri.fsPath;
    });
    return { id: node?.id ?? null, openFile };
  }

  /** いまの取得の状態から明細を組み、webview へ流す。 */
  #publish(state: SessionState): void {
    this.#post({ kind: "busy", busy: state.busy });

    if (state.unavailable) {
      this.#post({
        kind: "notice",
        tone: "info",
        text: state.unavailable.text,
        detail: state.unavailable.detail,
      });
    }

    const snapshot = state.snapshot;
    if (snapshot) {
      const { id, openFile } = this.#originId();
      const auditAt = state.auditAt ? formatTime(state.auditAt) : "";
      // 鍵は「答えを変えうるもの」だけで組む。取得は同一性で見る（中身は不変である）。
      const key = JSON.stringify([id, openFile, auditAt, snapshot.checksRun?.length ?? null, snapshot.glossary.size]);
      if (this.#last?.key === key && this.#lastSnapshot === snapshot) {
        this.#post(this.#last.view);
      } else {
        const consequence = buildConsequence(snapshot.graph, id, {
          // 素通しする。取れなかったかどうかの扱いは模型が持つ（ADR-021 決定 4）。
          findings: snapshot.findings,
          // 取れなかったときは null のまま渡す。空配列に潰すと「無い」と断定する。
          ranges: snapshot.ranges,
          reverseOrphans: snapshot.reverseOrphans ? new Set(snapshot.reverseOrphans) : null,
          // 素通しする。取れなかったかどうかの扱いは模型が持つ（試験が届く層）。
          registry: snapshot.registry,
        });
        const message = {
          kind: "view" as const,
          view: buildView(consequence, snapshot.docMeta, viewStrings(), {
            openFile,
            auditAt,
            // 一件でも取れていなければ言う。全滅のときだけ言うと、
            // 48 件中 1 件欠けが黙って通る（ADR-017）。
            titlesMissing: snapshot.graph.nodes.some(
              (n) => !snapshot.docMeta.get(n.id)?.title?.trim(),
            ),
            // 取れていなければ null を渡す。0 と渡すと「0 検査を走らせた」になる。
            checksRun: snapshot.checksRun?.length ?? null,
            glossary: snapshot.glossary,
          }),
        };
        this.#last = { key, view: message };
        this.#lastSnapshot = snapshot;
        this.#post(message);
      }
    }

    if (state.failure) {
      // 取得に失敗しても、直前に取れた明細は消さない（SPEC-001）。
      const kept = state.snapshot ? messages.keptPrevious() : "";
      this.#post({
        kind: "notice",
        tone: "error",
        text: `${adviceFor(state.failure.reason)} ${kept}`.trim(),
        detail: state.failure.detail,
      });
    } else if (state.partial.length > 0) {
      this.#post({
        kind: "notice",
        tone: "info",
        text: messages.partial(state.partial.map((p) => partialName(p.what)).join(" / ")),
        detail: partialDetail(state.partial),
      });
    } else if (!state.busy && !state.unavailable) {
      this.#post({ kind: "notice", tone: "info", text: "", detail: "" });
    }
  }

  async #onMessage(message: ToHost): Promise<void> {
    switch (message.kind) {
      case "ready": {
        if (this.#session.snapshot) this.#publish(this.#session.state);
        else await this.#session.refresh();
        return;
      }
      case "refresh":
        await this.#session.refresh();
        return;
      case "openDocument": {
        const snapshot = this.#session.snapshot;
        const node = snapshot?.graph.nodes.find((n) => n.id === message.id);
        if (!snapshot || !node) {
          void vscode.window.showInformationMessage(messages.notInGraph(message.id));
          return;
        }
        const target = vscode.Uri.joinPath(vscode.Uri.file(snapshot.docsRoot), node.path);
        await openOrExplain(target, node.path);
        return;
      }
      case "openRange":
        await openRange(
          this.#session,
          message.path,
          message.beginLine,
          message.endLine,
          message.base,
        );
        return;
    }
  }
}

/**
 * 文書を開く。消えていたら、その旨を出して終わる。
 *
 * 明細は前回取った姿を出しているので、行が指す文書が既に無いことがある。
 * 包まないと、押しても何も起きず、通知も帯も変わらない。
 */
export async function openOrExplain(uri: vscode.Uri, shown: string): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  } catch {
    void vscode.window.showInformationMessage(messages.missingFile(shown));
  }
}

/**
 * コード範囲を編集器で開き、その範囲を選んで見せる。
 *
 * 行の番号は上流が返す 1 始まりのまま受け取り、ここで 0 始まりへ直す。
 * この変換は toEditorLine の一箇所だけで行う（SPEC-005 退行観点）。
 */
export async function openRange(
  session: LensSession,
  relPath: string,
  beginLine: number,
  endLine: number,
  base: "workspace" | "docs",
): Promise<void> {
  const uri = session.toUri(relPath, base);
  if (!uri) {
    void vscode.window.showInformationMessage(messages.cannotOpen(relPath));
    return;
  }
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    void vscode.window.showInformationMessage(messages.missingFile(relPath));
    return;
  }
  const lastLine = Math.max(0, document.lineCount - 1);
  const begin = Math.min(toEditorLine(beginLine), lastLine);
  const end = Math.min(toEditorLine(endLine), lastLine);
  await vscode.window.showTextDocument(document, {
    selection: new vscode.Range(begin, 0, Math.max(begin, end), 0),
    preview: false,
  });
}
// doctrine:end IMPL-001
