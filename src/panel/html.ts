// doctrine:begin IMPL-001
// webview の器。内容セキュリティ方針を課し、外部からの読み込みを許さない（IMPL-001）。
//
// **寸法・色・書体の値の正本は `DESIGN.md` である（ADR-013）。**
// ここに書いてよいのはその表に載っている値だけである。
//
//   余白 4 / 8 / 12 / 16 / 24 / 32
//   角丸 4 / 8
//   書体 20（起点）/ 15（見出し）/ 13（本文）/ 11（補助）
//   等幅 12（記号・id・位置）
//   太さ 400（読む）/ 600（告げる）
//
// 影・階調・ぼかしを一つも書かない。高さは面の段だけで表す。
// 彩度のある色は、上流が異常だと言ったものにだけ使い、記号の一文字に載せる。
import { randomBytes } from "node:crypto";

import type { Uri, Webview } from "vscode";

import type { ShellStrings } from "../l10n.js";

/**
 * 一度きりの識別子。実行を許す script をこれで限る。
 *
 * 予測できてはならないので暗号用の乱数から作る。Math.random は予測できる。
 */
function nonce(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * webview の器を組む。
 *
 * `lang` は「実際に中身が何語で出るか」に揃える。訳を持たない言語で
 * `lang="de"` になると、読み上げが誤った言語で読む。
 * 同梱している訳は日本語だけなので、日本語かそれ以外かに丸める（ADR-007）。
 *
 * 帯が本体からの通知だけになったのは、明細そのものが告げること（畳んだ件数）が
 * 脚注として本文の中に入ったためである。二つの出所を一つの帯で共有しない。
 */
export function renderHtml(
  webview: Webview,
  scriptUri: Uri,
  language = "en",
  strings: ShellStrings = { title: "", refresh: "", busy: "", follow: "" },
): string {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${n}'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  const translated = ["ja"];
  const primary = language.toLowerCase().split("-")[0] ?? "";
  const lang = translated.includes(primary) ? primary : "en";
  return `<!DOCTYPE html>\n<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(strings.title)}</title>
<style nonce="${n}">${STYLE}</style>
</head>
<body>
  <header class="bar">
    <span class="follow" id="follow">${escapeHtml(strings.follow)}</span>
    <span class="busy" id="busy" hidden>${escapeHtml(strings.busy)}</span>
    <button type="button" id="refresh" class="ghost">${escapeHtml(strings.refresh)}</button>
  </header>

  <div class="notice" id="notice" hidden></div>

  <main class="sheet" id="sheet" tabindex="-1"></main>

<script nonce="${n}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// 器の注記はここに置く。CSS の注釈として中へ書くと、そのまま webview へ配られる。
//
// `.notice` に上限と巻きが要るのは、上流の traceback が三本ぶん来ると数千字になり、
// 器が横にも縦にも巻けないためである。`.sheet` の行を `minmax(0, 1fr)` にしてあるのは、
// 素の `1fr` が中身の最小の高さを下回れず、明細の面が 0 まで潰れるためである。
// `.row` の記号は固定幅の溝に置く。これが走査性の源で、文字を読む前に
// 「後半は全部 ? だ」が縦の縞として見える。
//
// 節（`.origin` `.wave` `.cycles` `.foot`）は左右に 16 の余白を持ち、
// 読み幅で止まる。だから区切りの罫と面の左右の端が一本に揃う。
// 行の左右の余白を 0 にしてあるのはそのためで、節の余白と二重に足さない。
//
// 読み幅（`.sheet > *` の `max-width`）は一つだけである。`ch` で書くと
// その要素自身の字の大きさが基準になり、節ごとに右端がずれる（DESIGN.md 8 節）。
const STYLE = `
* { box-sizing: border-box; }
[hidden] { display: none !important; }

html, body {
  height: 100%; margin: 0; padding: 0;
  font-family: var(--vscode-font-family);
  font-size: 13px;
  line-height: 1.6;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
body {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.follow, .busy { font-size: 11px; color: var(--vscode-descriptionForeground); }
#refresh { margin-left: auto; }

button.ghost {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 4px; padding: 4px 12px;
  font: inherit; font-size: 11px; cursor: pointer;
}
button.ghost:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.ghost:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.notice {
  padding: 8px 16px; font-size: 11px;
  max-height: 30vh; overflow-y: auto;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editorWidget-background);
}
.notice.error { color: var(--vscode-charts-red); }
.notice pre {
  margin: 8px 0 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.sheet { overflow-y: auto; overflow-x: hidden; outline: none; }
.sheet > * { max-width: 640px; }

.origin {
  padding: 16px; margin: 16px;
  background: var(--vscode-editorWidget-background); border-radius: 8px;
}
.origin h1 {
  margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3;
  display: flex; gap: 8px; align-items: baseline;
}
.origin h1 .mark { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.origin.broken h1 .mark { color: var(--vscode-charts-red); }
.origin.missing h1 .mark { color: var(--vscode-charts-yellow); }
.origin.nowhere h1 .mark, .origin.review h1 .mark { color: var(--vscode-descriptionForeground); }
.origin .note { margin: 12px 0 0; color: var(--vscode-descriptionForeground); }
.origin .finding { margin: 4px 0 0; }
.origin .detail {
  margin: 4px 0 0; font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-descriptionForeground); word-break: break-all;
}
.origin .summary { margin: 12px 0 0; white-space: pre-line; }

.empty {
  padding: 16px 0; margin: 16px; white-space: pre-line;
  color: var(--vscode-descriptionForeground);
}

.wave { border-top: 1px solid var(--vscode-panel-border); padding: 16px 0 0; margin: 16px 16px 0; }
.wave h2 {
  margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.4;
  display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap;
}
.wave h2 .note, .wave h2 .count {
  font-size: 11px; font-weight: 400; color: var(--vscode-descriptionForeground);
}
.wave h2 .count { margin-left: auto; }

.row {
  display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 8px;
  padding: 8px 0; border-radius: 4px; cursor: pointer;
}
.row:hover { background: var(--vscode-list-hoverBackground); }
.row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.row .mark { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.row.broken .mark { color: var(--vscode-charts-red); }
.row.missing .mark { color: var(--vscode-charts-yellow); }
.row.nowhere .mark, .row.review .mark { color: var(--vscode-descriptionForeground); }
.row .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.row .title { font-weight: 600; }
.row .behind, .row .status { font-size: 11px; color: var(--vscode-descriptionForeground); }
.row .id {
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-descriptionForeground);
}
.row .behind { margin-left: auto; }
.row .reason, .row .succeeds { color: var(--vscode-descriptionForeground); }
.row .finding, .origin .finding, .cycles .finding {
  color: var(--vscode-descriptionForeground);
  display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline;
}
.row .finding .message, .origin .finding .message, .cycles .finding .message { flex: 1 1 auto; }
/* Monospace has one step (12px). Do not mix families: proportional 11px and
   monospace 12px are not adjacent steps. See DESIGN.md section 3 / CHANGE-019. */
.finding .severity, .finding .check, .finding .doc, .finding .refs {
  font-family: var(--vscode-editor-font-family); font-size: 12px;
}
.finding.error .severity { color: var(--vscode-charts-red); }
.finding.warn .severity { color: var(--vscode-charts-yellow); }
.finding .at {
  padding: 0; border: none; background: none; cursor: pointer; text-align: left;
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-textLink-foreground);
}
.finding .at:hover { text-decoration: underline; }
.finding .at:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.row .range {
  display: block; padding: 0; margin: 0; border: none; background: none;
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-textLink-foreground); cursor: pointer; text-align: left;
}
.row .range:hover { text-decoration: underline; }
.row .range:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

.cycles { border-top: 1px solid var(--vscode-panel-border); padding: 16px 0 0; margin: 16px 16px 0; }
.cycles .path {
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-charts-red); word-break: break-all;
}

.foot {
  border-top: 1px solid var(--vscode-panel-border);
  padding: 16px 0 0; margin: 16px 16px 24px;
  /* Supporting step. DESIGN.md section 3 gives 11px a leading of 1.5.
     The table declared a step the implementation never used (CHANGE-029). */
  font-size: 11px; line-height: 1.5; color: var(--vscode-descriptionForeground);
}
.foot p { margin: 0 0 4px; }
.foot .legend { margin: 8px 0 0; display: flex; gap: 12px; flex-wrap: wrap; }
.foot .at { margin: 4px 0 0; display: flex; gap: 12px; flex-wrap: wrap; }
.foot .at button {
  padding: 0; border: none; background: none; cursor: pointer;
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  color: var(--vscode-textLink-foreground);
}
.foot .at button:hover { text-decoration: underline; }
.foot .at button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.foot .terms { margin: 8px 0 0; }
.foot .terms dt { font-weight: 600; margin: 8px 0 0; }
.foot .terms dd { margin: 0; }
`;
// doctrine:end IMPL-001
