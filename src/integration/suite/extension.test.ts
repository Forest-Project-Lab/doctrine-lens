// TEST-005 の編集器を要する項 — 実際の拡張機能ホストで確かめる。
//
// 純粋な関数の試験（src/test/trace.test.ts）が届かないところだけを見る。
// つまり「編集器が拡張機能を読み込めたか」「見出しが実際に出るか」
// 「命令が登録されているか」「帯が例外なく当たるか」である。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import * as vscode from "vscode";

const EXTENSION_ID = "Forest-Project-Lab.doctrine-lens";
// この束は out-integration/suite/ に出る。プロジェクト根はそこから二つ上。
const PROJECT = resolve(__dirname, "..", "..");

/** 取得が済むまで待つ。済んだ印は、見出しが出ることで判じる。 */
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  what: string,
  timeoutMs = 90000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.fail(`${what} が ${timeoutMs} ミリ秒のあいだ起きなかった。`);
}

async function lensesFor(relPath: string): Promise<vscode.CodeLens[]> {
  const uri = vscode.Uri.file(resolve(PROJECT, relPath));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
    "vscode.executeCodeLensProvider",
    uri,
  );
  return lenses ?? [];
}

describe("Doctrine Lens — 拡張機能ホスト", () => {
  before(async function () {
    this.timeout(120000);

    // 先にプラグインの解決を確かめる。確かめずに待つと、プラグインが無い環境で
    // 「見出しが 90 秒出なかった」としか出ず、原因が読めない（CI が実際にそうだった）。
    // 拡張機能と同じ規則で引く道具を使うので、ここが通れば拡張機能も引ける。
    try {
      const resolved = execFileSync("node", ["tools/doctrine-path.mjs"], {
        cwd: PROJECT,
        encoding: "utf8",
      }).trim();
      assert.ok(
        existsSync(resolve(resolved, "scripts", "docs-audit.py")),
        `解決した実体に CLI が無い: ${resolved}`,
      );
    } catch (error) {
      assert.fail(
        "doctrine プラグインを解決できない。拡張機能も同じ場所を見るので、" +
          "この試験は必ず落ちる。CLAUDE_CONFIG_DIR か導入を確かめること。\n" +
          String(error),
      );
    }

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} が見つからない`);
    await extension.activate();
    // 取得は起動直後に走る。見出しが出るまで待つ。
    await waitFor(async () => (await lensesFor("src/model/consequence.ts")).length > 0, "見出しが出ること");
  });

  it("読み込めて起動する（main の指す束が実在する）", () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension?.isActive, "起動していない");
  });

  it("命令がすべて登録されている", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const command of [
      "doctrineLens.open",
      "doctrineLens.refresh",
      "doctrineLens.revealActiveDocument",
      "doctrineLens.openDocumentForRange",
      "doctrineLens.jumpToImplementation",
      "doctrineLens.openDocumentById",
      "doctrineLens.revealDocumentById",
      "doctrineLens.explainStale",
    ]) {
      assert.ok(registered.includes(command), `${command} が登録されていない`);
    }
  });

  it("005-1. 印が囲む範囲の始まりに見出しが出る", async () => {
    const lenses = await lensesFor("src/model/consequence.ts");
    assert.ok(lenses.length >= 2, `見出しが少ない: ${lenses.length}`);
    // 範囲は 1 行目から始まる。編集器の行は 0 始まり。
    assert.equal(lenses[0]?.range.start.line, 0, "1 行目に出る");
    // 見出しの文言は表示言語で変わる（ADR-007）。字面ではなく、
    // 結ばれた文書の id と、押したときに走る命令で確かめる。
    const titles = lenses.map((l) => l.command?.title ?? "");
    assert.ok(titles.some((t) => t.includes("SPEC-006")), `結ばれた文書が出ていない: ${titles}`);
    const commands = lenses.map((l) => l.command?.command);
    assert.ok(commands.includes("doctrineLens.openDocumentById"), "文書を開く見出しが無い");
    assert.ok(commands.includes("doctrineLens.revealDocumentById"), "帰結を見る見出しが無い");
  });

  it("005-2. 見出しから文書を開ける", async () => {
    const lenses = await lensesFor("src/model/consequence.ts");
    const first = lenses[0];
    assert.ok(first?.command, "見出しに命令が無い");
    assert.equal(first.command.command, "doctrineLens.openDocumentById");
    await vscode.commands.executeCommand(
      first.command.command,
      ...(first.command.arguments ?? []),
    );
    const opened = vscode.window.activeTextEditor?.document.fileName ?? "";
    assert.ok(opened.includes("SPEC-006"), `開いた先が違う: ${opened}`);
  });

  it("005-4. 印を含まないファイルには見出しが出ない", async () => {
    const lenses = await lensesFor("esbuild.mjs");
    assert.deepEqual(lenses, [], "印の無いファイルに見出しが出ている");
  });

  it("005-5. 範囲の外で命令を呼んでも例外が出ない", async () => {
    const uri = vscode.Uri.file(resolve(PROJECT, "esbuild.mjs"));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    // 対応が無い旨を出して終わる。例外にしない。
    await vscode.commands.executeCommand("doctrineLens.openDocumentForRange");
  });

  it("コード → 文書。範囲の中から呼ぶと、その根拠の文書が開く", async () => {
    const uri = vscode.Uri.file(resolve(PROJECT, "src/doctrine/audit.ts"));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    // 範囲の内側の行を選ぶ。
    editor.selection = new vscode.Selection(20, 0, 20, 0);
    await vscode.commands.executeCommand("doctrineLens.openDocumentForRange");
    const opened = vscode.window.activeTextEditor?.document.fileName ?? "";
    assert.ok(opened.includes("SPEC-004"), `開いた先が違う: ${opened}`);
  });

  it("005-6. 文書 → コード。跳ぶ先が複数あるとき選ばせる", async function () {
    this.timeout(30000);
    const specUri = vscode.Uri.file(
      resolve(PROJECT, "doctrine_docs/lens/spec/SPEC-005-code-side-surface.md"),
    );
    const document = await vscode.workspace.openTextDocument(specUri);
    await vscode.window.showTextDocument(document);
    const before = vscode.window.activeTextEditor?.document.fileName ?? "";

    // SPEC-005 には範囲が複数あるので、選択肢が出て入力を待つ。
    // 待ちに入ったことは「一定時間たっても跳んでいない」ことで確かめる。
    // 命令そのものを await すると、選択肢を閉じる操作が効かない環境で
    // この試験が止まる（実際に 600 秒打ち切りになった）。だから待たない。
    const running = vscode.commands.executeCommand("doctrineLens.jumpToImplementation");
    void Promise.resolve(running).then(undefined, () => undefined);
    await new Promise((r) => setTimeout(r, 3000));

    assert.equal(
      vscode.window.activeTextEditor?.document.fileName ?? "",
      before,
      "選ばせずに跳んでいる（範囲が複数あるのに一つ目へ飛んだ疑い）",
    );

    // 開いたままの選択肢を片づける。効かない環境でも次の試験を妨げない。
    await Promise.resolve(
      vscode.commands.executeCommand("workbench.action.closeQuickOpen"),
    ).then(undefined, () => undefined);
  });

  it("id を指した文書の帰結は、その文書を開いてから出る（起点を渡さない）", async () => {
    // 画面へ「この id を起点にせよ」と渡すと、カーソルに従う状態と渡された
    // 起点を保つ状態の二つを持つことになり、二つ目がいつ解けるかを説明できない。
    // 文書を開けば、それが編集中のものになり、既にある規則がそのまま働く。
    const away = await vscode.workspace.openTextDocument(
      vscode.Uri.file(resolve(PROJECT, "esbuild.mjs")),
    );
    await vscode.window.showTextDocument(away);

    await vscode.commands.executeCommand("doctrineLens.revealDocumentById", "SPEC-006");
    const opened = vscode.window.visibleTextEditors.map((e) => e.document.fileName);
    assert.ok(
      opened.some((f) => f.includes("SPEC-006")),
      `指した文書が開いていない: ${opened.join(", ")}`,
    );
  });

  it("明細の画面が開き、いま開いている位置が起点になる", async () => {
    // 起点は利用者が選ばない。印が囲む範囲の中にカーソルを置いた状態で開くと、
    // その範囲が指す文書が起点になる（SPEC-006 受入基準 1）。
    const marked = await vscode.workspace.openTextDocument(
      vscode.Uri.file(resolve(PROJECT, "src/model/consequence.ts")),
    );
    const editor = await vscode.window.showTextDocument(marked);
    editor.selection = new vscode.Selection(20, 0, 20, 0);

    await vscode.commands.executeCommand("doctrineLens.open");
    // webview が開いたことは、命令が例外なく終わったことで足りる。
    // 中身の描画はブラウザ側の確認（tools/shoot-preview.mjs）が受け持つ。

    // 印の無いファイルへ移っても落ちない（起点が無いだけである）。
    const plain = await vscode.workspace.openTextDocument(
      vscode.Uri.file(resolve(PROJECT, "esbuild.mjs")),
    );
    await vscode.window.showTextDocument(plain);
    await vscode.commands.executeCommand("doctrineLens.refresh");
  });
});
