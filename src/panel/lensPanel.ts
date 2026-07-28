// 画面の器 — webview の生成と受け渡し（IMPL-001）。
//
// 取得そのものは LensSession が持つ。ここはその読み手の一つである。
import * as vscode from "vscode";

import { toEditorLine } from "../codelens/traceLens.js";
import { messages, webviewStrings } from "../l10n.js";
import type { LensSession, SessionState } from "../session.js";
import type { SavedLens, ToHost, ToWebview } from "../shared/protocol.js";
import { renderHtml } from "./html.js";

const VIEW_TYPE = "doctrineLens.map";
const SAVED_LENSES_KEY = "doctrineLens.savedLenses";

/** 失敗の種類ごとの案内。読み手が次に何をすればよいかまで書く（ADR-007）。 */
function adviceFor(reason: string): string {
  if (reason === "spawn-failed") return messages.spawnFailed();
  if (reason === "bad-json") return messages.badJson();
  if (reason === "timeout") return messages.timedOut();
  return messages.exitNonZero();
}

/** 部分的に取れなかったものの名前を訳す（ADR-007）。 */
function partialName(what: string): string {
  if (what === "registry") return messages.partialRegistry();
  if (what === "ranges") return messages.partialRanges();
  return messages.partialFindings();
}

export class LensPanel {
  /** 器の種類。復元器の登録に使う。 */
  static readonly viewType = VIEW_TYPE;

  static #current: LensPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  readonly #context: vscode.ExtensionContext;
  readonly #session: LensSession;
  readonly #disposables: vscode.Disposable[] = [];
  #ready = false;
  #pendingReveal: string | undefined;

  static show(context: vscode.ExtensionContext, session: LensSession): LensPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (LensPanel.#current) {
      LensPanel.#current.#panel.reveal(column);
      return LensPanel.#current;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Doctrine Lens", column, {
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
   * 復元器を登録しないと、窓を開き直したときに地図のタブが黙って消える。
   * webview 側は `getState` で前回のレンズと位置を持っているので、
   * 器さえ繋ぎ直せば同じ見え方に戻る。
   */
  static revive(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    session: LensSession,
  ): void {
    // 既に開いているなら、復元されたほうは捨てる（器は一つだけ持つ）。
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
    this.#context = context;
    this.#session = session;

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
    );
    panel.webview.html = renderHtml(panel.webview, scriptUri, vscode.env.language);

    this.#disposables.push(
      panel.webview.onDidReceiveMessage((message: ToHost) => {
        void this.#onMessage(message);
      }),
      panel.onDidDispose(() => this.dispose()),
      session.onDidChange((state) => this.#publish(state)),
    );
  }

  dispose(): void {
    LensPanel.#current = undefined;
    for (const item of this.#disposables.splice(0)) item.dispose();
    this.#panel.dispose();
  }

  /** いま開いている文書を地図で示す。取得が済んでいなければ済んでから示す。 */
  reveal(docId: string): void {
    if (this.#ready) this.#post({ kind: "reveal", docId });
    else this.#pendingReveal = docId;
  }

  // --- 内側 --------------------------------------------------------------

  #post(message: ToWebview): void {
    void this.#panel.webview.postMessage(message);
  }

  /** いまの取得の状態を webview へ流す。 */
  #publish(state: SessionState): void {
    this.#post({ kind: "busy", busy: state.busy });

    if (state.unavailable) {
      this.#post({
        kind: "notice",
        tone: "info",
        text: state.unavailable.text,
        detail: state.unavailable.detail,
      });
      return;
    }

    if (state.snapshot) {
      this.#post({
        kind: "snapshot",
        graph: state.snapshot.graph,
        registry: state.snapshot.registry,
        docsRoot: state.snapshot.docsRoot,
        savedLenses: this.#savedLenses(),
        ranges: state.snapshot.ranges,
        staleIds: [...this.#session.staleIds],
        strings: webviewStrings(),
        auditAt: state.auditAt ? state.auditAt.toISOString() : null,
      });
    }

    if (state.failure) {
      // 取得に失敗しても、直前に取れた地図は消さない（SPEC-001）。
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
        text: messages.partial(state.partial.map(partialName).join(" / ")),
        detail: "",
      });
    } else if (!state.busy) {
      this.#post({ kind: "notice", tone: "info", text: "", detail: "" });
    }
  }

  #savedLenses(): SavedLens[] {
    return this.#context.workspaceState.get<SavedLens[]>(SAVED_LENSES_KEY, []);
  }

  async #storeLenses(lenses: SavedLens[], justSaved?: string): Promise<void> {
    await this.#context.workspaceState.update(SAVED_LENSES_KEY, lenses);
    this.#post({ kind: "savedLenses", savedLenses: lenses, justSaved });
  }

  async #onMessage(message: ToHost): Promise<void> {
    switch (message.kind) {
      case "ready": {
        this.#ready = true;
        // 文字列は必ず先に渡す。統治木が無い場合 snapshot は来ないので、
        // snapshot に相乗りさせると空文字の画面になる。
        this.#post({ kind: "strings", strings: webviewStrings() });
        // 既に取れているならそれを流し、無ければ取りに行く。
        if (this.#session.snapshot) this.#publish(this.#session.state);
        else await this.#session.refresh();
        if (this.#pendingReveal) {
          this.#post({ kind: "reveal", docId: this.#pendingReveal });
          this.#pendingReveal = undefined;
        }
        return;
      }
      case "refresh":
        await this.#session.refresh();
        return;
      case "openDocument": {
        const snapshot = this.#session.snapshot;
        if (!snapshot) return;
        const target = vscode.Uri.joinPath(vscode.Uri.file(snapshot.docsRoot), message.path);
        const document = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(document, { preview: true });
        return;
      }
      case "openRange":
        await openRange(this.#session, message.path, message.beginLine, message.endLine);
        return;
      case "requestSaveLens": {
        const name = (
          await vscode.window.showInputBox({
            prompt: messages.lensPromptName(),
            validateInput: (v) => (v.trim() ? undefined : messages.lensPromptName()),
          })
        )?.trim();
        // 取り消したときは何もしない。
        if (!name) return;
        const lenses = this.#savedLenses().filter((s) => s.name !== name);
        lenses.push({ name, lens: message.lens, focus: message.focus });
        lenses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        await this.#storeLenses(lenses, name);
        return;
      }
      case "deleteLens": {
        await this.#storeLenses(this.#savedLenses().filter((s) => s.name !== message.name));
        return;
      }
    }
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
): Promise<void> {
  const uri = session.toUri(relPath);
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
  const selection = new vscode.Range(begin, 0, Math.max(begin, end), 0);
  await vscode.window.showTextDocument(document, {
    selection,
    preview: false,
  });
}
