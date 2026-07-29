// webview の器。内容セキュリティ方針を課し、外部からの読み込みを許さない（IMPL-001）。
import { randomBytes } from "node:crypto";

import type { Uri, Webview } from "vscode";

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
 * `lang` は「実際に中身が何語で出るか」に揃える。編集器の表示言語をそのまま書くと、
 * 訳を持たない言語（独語など）で中身は英語なのに `lang="de"` になる。
 * 同梱している訳は日本語だけなので、日本語かそれ以外かに丸める。
 * 訳を増やしたらこの表も増やす（ADR-007）。
 */
export function renderHtml(webview: Webview, scriptUri: Uri, language = "en"): string {
  // 帯が二つ在るのは意図である。本体からの通知（#notice）と、場面そのものが
  // 告げること（#sceneNotice。辺の省略・段の戻し）は出所が違う。一つを共有すると、
  // 本体が取得のたびに送る「消せ」で場面の通知が必ず消える。
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${n}'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");

  // 同梱している訳の集合。l10n/bundle.l10n.<lang>.json を足したらここも足す。
  const translated = ["ja"];
  const primary = language.toLowerCase().split("-")[0] ?? "";
  const lang = translated.includes(primary) ? primary : "en";
  return `<!DOCTYPE html>\n<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doctrine Lens</title>
<style nonce="${n}">${STYLE}</style>
</head>
<body>
  <header class="bar">
    <nav class="crumbs" id="crumbs"></nav>
    <div class="bar-right">
      <span class="busy" id="busy" hidden></span>
      <button type="button" id="refresh" class="ghost"></button>
    </div>
  </header>

  <section class="dials" id="dials">
    <div class="dial">
      <label for="colorBy" id="lblColorBy"></label>
      <select id="colorBy"></select>
    </div>
    <div class="dial">
      <label for="layout" id="lblLayout"></label>
      <select id="layout"></select>
    </div>
    <div class="dial">
      <label for="filterType" id="lblFilterType"></label>
      <select id="filterType"></select>
    </div>
    <div class="dial">
      <label for="filterDomain" id="lblFilterDomain"></label>
      <select id="filterDomain"></select>
    </div>
    <div class="dial check">
      <input type="checkbox" id="currentOnly">
      <label for="currentOnly" id="lblCurrentOnly"></label>
    </div>
    <div class="dial grow">
      <label for="savedLens" id="lblSavedLens"></label>
      <select id="savedLens"></select>
      <button type="button" id="saveLens" class="ghost"></button>
      <button type="button" id="deleteLens" class="ghost" disabled></button>
    </div>
  </section>

  <div class="notice" id="notice" hidden></div>
  <div class="notice" id="sceneNotice" hidden></div>

  <main class="canvas" id="canvas" tabindex="0">
    <svg id="svg" role="img"><title id="svgTitle"></title></svg>
    <p class="empty" id="empty" hidden></p>
  </main>

  <aside class="inspector" id="inspector" hidden></aside>

  <footer class="legend" id="legend"></footer>

<script nonce="${n}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

// 色は編集器の主題の変数から取る。明るい主題と暗い主題の双方で読める（IMPL-001）。
//
// 説明はここに置く。CSS の注釈として中へ書くと、そのまま webview へ配られる。
// 配るものに読み手の居ない文章を混ぜない（走査もそれを表示文字列と見なす）。
//
// `[hidden] { display: none !important; }` が要るのは、display を当てた要素でも
// hidden を効かせるためである。これが無いと、隠したはずの覆いがキャンバス全面の
// クリックを飲み込む（実際に起きた欠陥）。
//
// canvas の行を `minmax(120px, 1fr)` にしてあるのは、素の `1fr` が中身の最小の
// 高さを下回れないためである。通知が長い回に canvas の高さが 0 まで潰れ、地図が
// 一つも見えなくなる。`.notice` の `max-height` と `overflow-y` も同じ理由で要る。
// 上流の traceback が三本ぶん来ると数千字になり、body は overflow:hidden なので
// 巻く手立てが無い（実際に地図が消えた）。
//
// 下限を 0 でなく 120px にしてあるのは、幅が狭くて検分欄が下段へ回る配置でも
// 地図の面を残すためである（700x500 で canvas の高さが 0 になり、検分欄だけの
// 画面になった）。検分欄の側にも `max-height` と巻きを与えてある。
//
// `.dials` の `overflow-x` と `.legend span` の `min-width: 0`、そして
// `@media (max-width: 480px)` の折り返しは、編集器の欄を三つ四つに割った幅
// （380px 程度）で、取り直す釦や絞りの選択欄が画面の外へ出て触れなくなるのを
// 防ぐ。body は横にも巻けないので、出てしまうと触れる方法が一切残らない。
const STYLE = `
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body {
  height: 100%; margin: 0; padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
body {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto auto auto minmax(120px, 1fr) auto;
  grid-template-areas:
    "bar bar" "dials dials" "notice notice" "sceneNotice sceneNotice"
    "canvas inspector" "legend legend";
  height: 100vh; overflow: hidden;
}
.bar {
  grid-area: bar; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.bar-right { display: flex; align-items: center; gap: 8px; }
.busy { opacity: .75; font-size: .9em; }
.crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.crumbs button {
  background: none; border: none; padding: 2px 6px; cursor: pointer; border-radius: 3px;
  color: var(--vscode-textLink-foreground); font: inherit;
}
.crumbs button:hover { background: var(--vscode-toolbar-hoverBackground); }
.crumbs button[disabled] { color: var(--vscode-foreground); cursor: default; font-weight: 600; }
.crumbs .sep { opacity: .5; }
button.ghost {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 3px; padding: 3px 10px; cursor: pointer; font: inherit;
}
button.ghost:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.ghost:disabled { opacity: .5; cursor: default; }
.dials {
  grid-area: dials; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px;
  padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border);
  min-width: 0; overflow-x: auto;
}
.dial { display: flex; align-items: center; gap: 6px; }
.dial.grow { margin-left: auto; }
.dial select { min-width: 0; }
.dial label { opacity: .8; font-size: .9em; white-space: nowrap; }
.dial select {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 3px; padding: 2px 4px; font: inherit; max-width: 14rem;
}
#notice { grid-area: notice; }
#sceneNotice { grid-area: sceneNotice; }
.notice {
  padding: 8px 12px; font-size: .92em;
  max-height: 30vh; overflow-y: auto;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-inputValidation-infoBackground);
  border-left: 3px solid var(--vscode-inputValidation-infoBorder);
}
.notice.error {
  background: var(--vscode-inputValidation-errorBackground);
  border-left-color: var(--vscode-inputValidation-errorBorder);
}
.notice pre {
  margin: 6px 0 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--vscode-editor-font-family); font-size: .92em; opacity: .85;
}
.canvas { grid-area: canvas; position: relative; overflow: hidden; outline: none; }
.canvas:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
svg { width: 100%; height: 100%; display: block; cursor: grab; }
svg.dragging { cursor: grabbing; }
.empty {
  position: absolute; inset: 0; display: grid; place-content: center;
  margin: 0; opacity: .7; text-align: center; padding: 24px; white-space: pre-line;
}
.node rect { stroke-width: 1.5; }
.node text { font-size: 12px; pointer-events: none; }
.node .sub { font-size: 10px; opacity: .8; }
.node { cursor: pointer; }
.node:focus-visible rect { stroke: var(--vscode-focusBorder); stroke-width: 3; }
.node.focus rect { stroke-width: 3; }
.edge { fill: none; stroke: var(--vscode-descriptionForeground); opacity: .55; }
.edge-label { font-size: 10px; fill: var(--vscode-descriptionForeground); }
.lane-label {
  font-size: 11px; fill: var(--vscode-descriptionForeground);
  letter-spacing: .04em; text-transform: uppercase;
}
.inspector {
  grid-area: inspector; width: 320px; overflow-y: auto; padding: 12px 14px;
  border-left: 1px solid var(--vscode-panel-border);
}
.inspector h2 { margin: 0 0 4px; font-size: 1.05em; }
.inspector .path {
  font-family: var(--vscode-editor-font-family); font-size: .85em; opacity: .8;
  word-break: break-all; margin: 0 0 10px;
}
.inspector dl {
  display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px;
  margin: 0 0 12px; font-size: .9em;
}
.inspector dt { opacity: .7; }
.inspector dd { margin: 0; word-break: break-word; }
.inspector h3 {
  margin: 12px 0 4px; font-size: .8em; text-transform: uppercase;
  letter-spacing: .06em; opacity: .7;
}
.inspector ul { margin: 0; padding-left: 1.1em; font-size: .9em; }
.inspector .open-doc {
  margin-top: 12px; width: 100%;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; border-radius: 3px; padding: 5px; cursor: pointer; font: inherit;
}
.legend {
  grid-area: legend; display: flex; flex-wrap: wrap; gap: 4px 14px;
  padding: 6px 12px; border-top: 1px solid var(--vscode-panel-border);
  font-size: .85em; max-height: 5.5em; overflow-y: auto;
}
.legend span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.hint { opacity: .6; margin-left: auto; white-space: nowrap; }
@media (max-width: 480px) {
  .bar { flex-wrap: wrap; }
  .dial.grow { margin-left: 0; }
  .dials { gap: 6px 10px; }
}
@media (max-width: 720px) {
  body { grid-template-columns: 1fr; grid-template-areas:
    "bar" "dials" "notice" "sceneNotice" "canvas" "inspector" "legend"; }
  .inspector {
    width: auto; border-left: none; border-top: 1px solid var(--vscode-panel-border);
    max-height: 40vh; overflow-y: auto;
  }
}
`;
