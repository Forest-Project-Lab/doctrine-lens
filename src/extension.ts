// 入口 — 起動、命令の登録、画面と面の生成（IMPL-001）。
import * as vscode from "vscode";

import { RangeDecorations } from "./codelens/decorations.js";
import { TraceLensProvider } from "./codelens/traceLens.js";
import { messages } from "./l10n.js";
import { isInside } from "./model/paths.js";
import { rangeAtLine, rangesForDocument } from "./model/trace.js";
import { LensPanel, openRange } from "./panel/lensPanel.js";
import { LensSession } from "./session.js";
import { LensStatusBar } from "./statusbar.js";

export function activate(context: vscode.ExtensionContext): void {
  const session = new LensSession(context.workspaceState);
  const lensProvider = new TraceLensProvider(session);
  const decorations = new RangeDecorations(session);
  const statusBar = new LensStatusBar(session);

  context.subscriptions.push(
    session,
    lensProvider,
    decorations,
    statusBar,
    // 見出しはどの言語のファイルにも出る。印は言語を問わない形をしている。
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, lensProvider),

    vscode.commands.registerCommand("doctrineLens.open", () => {
      LensPanel.show(context, session);
    }),

    vscode.commands.registerCommand("doctrineLens.refresh", async () => {
      LensPanel.show(context, session);
      await session.refresh(true);
    }),

    vscode.commands.registerCommand("doctrineLens.selectWorkspaceFolder", async () => {
      const candidates = session.candidates();
      if (candidates.length < 2) {
        void vscode.window.showInformationMessage(
          candidates.length === 1 ? candidates[0]!.docsRoot : messages.noTree(),
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        candidates.map((c) => ({ label: c.label, description: c.docsRoot, folder: c.folder })),
        { title: messages.pickFolderTitle() },
      );
      if (picked) await session.choose(picked.folder);
    }),

    vscode.commands.registerCommand("doctrineLens.revealActiveDocument", async () => {
      const docId = activeDocumentId(session);
      if (!docId) {
        void vscode.window.showInformationMessage(messages.notInTree());
        return;
      }
      LensPanel.show(context, session).reveal(docId);
    }),

    vscode.commands.registerCommand("doctrineLens.revealDocumentById", (docId?: string) => {
      if (!docId) return;
      LensPanel.show(context, session).reveal(docId);
    }),

    vscode.commands.registerCommand("doctrineLens.openDocumentById", async (docId?: string) => {
      if (!docId) return;
      await openDocumentById(session, docId);
    }),

    // コード → 文書。文字入力の位置を含む範囲から、その根拠の文書を開く。
    vscode.commands.registerCommand("doctrineLens.openDocumentForRange", async () => {
      const editor = vscode.window.activeTextEditor;
      const snapshot = session.snapshot;
      if (!editor || !snapshot?.ranges) {
        void vscode.window.showInformationMessage(messages.noRangesYet());
        return;
      }
      const relPath = session.toRelativePath(editor.document.uri);
      const line = editor.selection.active.line + 1;
      const range = relPath ? rangeAtLine(snapshot.ranges, relPath, line) : null;
      if (!range) {
        void vscode.window.showInformationMessage(messages.notBound());
        return;
      }
      await openDocumentById(session, range.id);
    }),

    // 文書 → コード。開いている文書に結ばれた範囲へ跳ぶ。
    vscode.commands.registerCommand("doctrineLens.jumpToImplementation", async () => {
      if (!session.snapshot?.ranges) {
        void vscode.window.showInformationMessage(messages.noRangesYet());
        return;
      }
      const docId = activeDocumentId(session);
      if (!docId) {
        void vscode.window.showInformationMessage(messages.notInTree());
        return;
      }
      await jumpToImplementation(session, docId);
    }),

    vscode.commands.registerCommand("doctrineLens.explainStale", async (docId?: string) => {
      const choice = await vscode.window.showWarningMessage(
        messages.staleWarning(docId ?? ""),
        messages.staleHowTo(),
      );
      if (choice === messages.staleHowTo()) {
        void vscode.window.showInformationMessage(messages.staleHowToDetail());
      }
    }),

    // コードが変わると指紋が動く。保存のたびに取り直す（拍の分け方は session が持つ）。
    vscode.workspace.onDidSaveTextDocument(() => session.scheduleRefresh()),
  );

  void session.refresh(true);
}

export function deactivate(): void {
  LensPanel.current?.dispose();
}

/** 文書の id から、その文書を開く。 */
async function openDocumentById(session: LensSession, docId: string): Promise<void> {
  const snapshot = session.snapshot;
  const node = snapshot?.graph.nodes.find((n) => n.id === docId);
  if (!snapshot || !node) {
    void vscode.window.showInformationMessage(messages.notInGraph(docId));
    return;
  }
  const uri = vscode.Uri.joinPath(vscode.Uri.file(snapshot.docsRoot), node.path);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
}

/** 文書に結ばれた範囲へ跳ぶ。複数あれば選ばせる（SPEC-005）。 */
async function jumpToImplementation(session: LensSession, docId: string): Promise<void> {
  const ranges = rangesForDocument(session.snapshot?.ranges ?? [], docId);
  if (ranges.length === 0) {
    void vscode.window.showInformationMessage(messages.noRangesFor(docId));
    return;
  }
  const only = ranges[0];
  if (ranges.length === 1 && only) {
    await openRange(session, only.path, only.begin_line, only.end_line);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    ranges.map((r) => ({
      label: r.path,
      description: messages.lineRange(r.begin_line, r.end_line),
      range: r,
    })),
    { title: messages.pickRangeTitle(docId), placeHolder: messages.pickRangePlaceholder() },
  );
  // 選ばずに閉じたときは何もしない（SPEC-005 エラー時挙動）。
  if (!picked) return;
  await openRange(session, picked.range.path, picked.range.begin_line, picked.range.end_line);
}

/** いま開いている文書の id。統治木の外や id が無いときは `null`。 */
function activeDocumentId(session: LensSession): string | null {
  const editor = vscode.window.activeTextEditor;
  const docsRoot = session.state.candidate?.docsRoot;
  if (!editor || !docsRoot) return null;
  if (!isInside(docsRoot, editor.document.uri.fsPath)) return null;

  // frontmatter は先頭にある。冒頭の数十行だけを見る。
  // ここで読むのは `id` の一行だけである。型・status・置き場所の判定はしない
  // （それは上流の仕事であり、写せば REQ-003 の破れになる）。
  const limit = Math.min(editor.document.lineCount, 40);
  for (let line = 0; line < limit; line += 1) {
    const text = editor.document.lineAt(line).text;
    if (line > 0 && text.trim() === "---") break;
    const match = /^id\s*:\s*(\S+)\s*$/.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}
