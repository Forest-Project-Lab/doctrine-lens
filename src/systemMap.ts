// doctrine:begin IMPL-001
// System Map(実験)— 候補モデルの静的画面を編集器内で開く。
//
// 位置づけ(2026-08-04 の所有者判断):
// - 実験として触るための同梱である。H 層(人間検証)は UNASSESSED のまま暫定で載せる。
//   最小性・archive・平時コンテキスト除外(doctrine 上流 issue 210)は別タスク。
// - 画面は research/system-map/prototype の自己完結 HTML を build 時に文字列として内蔵する。
//   実行時の取得・外部通信・書き込みは無い(読むだけの画面。M-13 の規律のまま)。
// - 明示の命令でだけ開く。既定の挙動(帰結画面・起動時活性化)は変えない。
import * as vscode from "vscode";

import { messages } from "./l10n.js";
import systemMapHtml from "../research/system-map/prototype/index.html";

/** 一度きりの識別子。実行を許す script を、内蔵したその一つに限る。 */
function nonce(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/** webview の CSP を課す。外部への経路を残さない。style は内蔵 HTML が style 属性を使うため
 *  'unsafe-inline' を許す(帰結画面の nonce 方式との差は IMPL-001 に記す)。 */
function withCsp(html: string): string {
  const n = nonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';`;
  return html
    .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace("<script>", `<script nonce="${n}">`);
}

export function registerSystemMap(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("doctrineLens.openSystemMapExperiment", () => {
    const panel = vscode.window.createWebviewPanel(
      "doctrineLens.systemMap",
      messages.systemMapTitle(),
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [] },
    );
    panel.webview.html = withCsp(systemMapHtml);
    context.subscriptions.push(panel);
  });
}
// doctrine:end IMPL-001
