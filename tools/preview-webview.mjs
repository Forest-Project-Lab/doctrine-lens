#!/usr/bin/env node
// webview の中身を、編集器の外（ふつうのブラウザ）で開けるようにする道具。
//
// なぜ要るか: webview の描画は編集器を起こさないと確かめられない、と思われがちだが、
// 中身は素の DOM である。器（html.ts）が出す HTML をそのまま使い、
// acquireVsCodeApi の代わりだけを差し込めば、ブラウザで開いて目で確かめられる。
// 器を写さずに本物を使うので、確かめたものと配るものが食い違わない。
//
//   使い方: node tools/preview-webview.mjs [出力先ディレクトリ]
//   既定の出力先は .preview/。開くのは .preview/index.html。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// readFileSync は統治外の宣言（trace_exempt）を読むためにも使う。
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { webviewOptions } from "../esbuild.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(process.argv[2] ?? join(projectRoot, ".preview"));
mkdirSync(outDir, { recursive: true });

// 器を本物のまま取り込む。html.ts が取り込む vscode は型だけなので、
// 束ねれば実行時の依存は残らない。
const shim = join(outDir, "html.mjs");
execFileSync(
  "npx",
  ["esbuild", join(projectRoot, "src/panel/html.ts"), "--bundle", "--format=esm",
   "--platform=node", `--outfile=${shim}`, "--log-level=warning"],
  { cwd: projectRoot, stdio: "inherit" },
);
const { renderHtml } = await import(pathToFileURL(shim).href);

// 統治木から本物のグラフと登録簿を取る。見本ではなく実物で確かめる。
const pluginRoot = execFileSync("node", ["tools/doctrine-path.mjs"], {
  cwd: projectRoot, encoding: "utf8",
}).trim();
const run = (args) =>
  JSON.parse(execFileSync("python3", args, { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 << 20 }));

const graph = run([
  join(pluginRoot, "scripts/dep-graph.py"),
  "--root", join(projectRoot, "doctrine_docs"), "--classify-edges", "--json",
]);
const registry = run([
  "-c",
  [
    "import json,sys",
    "sys.path.insert(0, sys.argv[1])",
    "import _registry as r",
    'json.dump({"types": list(r.TYPES), "currentStatuses": sorted(r.CURRENT_STATUSES),'
    + ' "allStatuses": list(r.ALL_STATUSES), "projectionTypes": list(r.PROJECTION_TYPES)}, sys.stdout)',
  ].join("\n"),
  join(pluginRoot, "scripts"),
]);

// コード範囲と、指紋の食い違いの判定。判定は監査から取る（ADR-005）。
const traceIndex = run([
  join(pluginRoot, "scripts/trace-index.py"),
  "--root", projectRoot, "--docs-root", join(projectRoot, "doctrine_docs"), "--format", "json",
]);
const exempt = (() => {
  try {
    const config = JSON.parse(
      readFileSync(join(projectRoot, "doctrine_docs/_system/.context-config.json"), "utf8"),
    );
    return Object.entries(config.trace_exempt ?? {})
      .filter(([, reason]) => typeof reason === "string" && reason.trim())
      .map(([path]) => path);
  } catch {
    return [];
  }
})();
const ranges = (traceIndex.ranges ?? []).filter(
  (r) => !exempt.some((p) => (p.endsWith("/") ? r.path.startsWith(p) : r.path === p)),
);

const audit = run([
  join(pluginRoot, "scripts/docs-audit.py"),
  "--root-from", projectRoot, "--json", "--fail-on", "never",
]);
const staleIds = [
  ...new Set(
    (audit.findings ?? [])
      .filter((f) => f.check === "trace_stale")
      .flatMap((f) => [f.doc_id, ...(f.refs ?? [])])
      .filter(Boolean),
  ),
];

// 表示の文字列は src/l10n.ts から実際に導く。
//
// ここに写しを置くと、l10n.ts に鍵を足したときプレビューだけが古びる
// （実際に起きた。画面が壊れて 9 件の誤りが出た）。
// l10n.ts が取り込む vscode は `l10n.t` だけなので、その一つを差し替えて束ねれば、
// 原文（英語）そのものが取り出せる。翻訳の束を読み込まないときの編集器と同じ挙動である。
const vscodeShim = join(outDir, "vscode-shim.mjs");
writeFileSync(
  vscodeShim,
  "export const l10n = { t: (s, ...a) => a.reduce((x, v, i) => x.split(`{${i}}`).join(v), s) };\n" +
    "export const env = { language: 'en' };\n",
  "utf8",
);
const l10nBundle = join(outDir, "l10n.mjs");
execFileSync(
  "npx",
  ["esbuild", join(projectRoot, "src/l10n.ts"), "--bundle", "--format=esm",
   "--platform=node", `--alias:vscode=${vscodeShim}`,
   `--outfile=${l10nBundle}`, "--log-level=warning"],
  { cwd: projectRoot, stdio: "inherit" },
);
const { viewStrings, shellStrings } = await import(pathToFileURL(l10nBundle).href);

// 「足りないもの」と題名も、本体と同じ上流の呼び方で取る。
const orphanReport = run([
  join(pluginRoot, "scripts/dep-graph.py"),
  "--root", join(projectRoot, "doctrine_docs"), "--reverse-orphans", "--json",
]);
const reverseOrphans = new Set(
  Object.values(orphanReport.result ?? {}).flatMap((b) => (Array.isArray(b) ? b : [])),
);

const titleReport = run([
  "-c",
  [
    "import sys",
    'sys.path[:] = [p for p in sys.path if p not in ("", ".")]',
    "sys.path.insert(0, sys.argv[1])",
    "import json, os",
    "import _frontmatter as fm",
    "out = {}",
    "for base, dirs, files in os.walk(sys.argv[2]):",
    "    dirs[:] = [d for d in dirs if not d.startswith('.')]",
    "    for name in files:",
    "        if not name.endswith('.md'):",
    "            continue",
    "        meta, _b, _e = fm.parse_file(os.path.join(base, name))",
    "        if isinstance(meta, dict) and meta.get('id'):",
    "            out[meta['id']] = {'title': meta.get('title') or '',",
    "                               'updated': str(meta.get('updated') or ''),",
    "                               'supersededBy': meta.get('superseded_by') or ''}",
    "json.dump(out, sys.stdout, ensure_ascii=False)",
  ].join("\n"),
  join(pluginRoot, "scripts"), join(projectRoot, "doctrine_docs"),
]);
if (Object.keys(titleReport).length === 0) {
  throw new Error("題名が一件も取れない。空の表で写しを撮ると、id だけの画面を確かめたことになる。");
}

// 明細は本体側で組む（ADR-012）。写しでも同じ関数を通す。写さない。
const modelBundle = join(outDir, "model.mjs");
writeFileSync(
  join(outDir, "model-entry.ts"),
  'export { buildConsequence } from "../src/model/consequence.js";\n' +
    'export { buildView, formatTime } from "../src/model/view.js";\n',
  "utf8",
);
execFileSync(
  "npx",
  ["esbuild", join(outDir, "model-entry.ts"), "--bundle", "--format=esm",
   "--platform=node", `--outfile=${modelBundle}`, "--log-level=warning"],
  { cwd: projectRoot, stdio: "inherit" },
);
const { buildConsequence, buildView, formatTime } = await import(pathToFileURL(modelBundle).href);

// 起点は「印が囲む範囲の中にカーソルが在る」状態を模す。実際に範囲を持つ文書を選ぶ。
const ORIGIN = process.env["PREVIEW_ORIGIN"] || ranges[0]?.id || graph.nodes[0]?.id || null;
const consequence = buildConsequence(graph, ORIGIN, {
  findings: audit.findings ?? [],
  ranges,
  reverseOrphans,
});
const view = buildView(
  consequence,
  new Map(Object.entries(titleReport)),
  viewStrings(),
  {
    openFile: ranges[0]?.path ?? "src/extension.ts",
    auditAt: audit.generated_at ? formatTime(new Date(audit.generated_at)) : "",
    titlesMissing: Object.keys(titleReport).length === 0,
  },
);

// 本体が最初に送るものと同じ形。判断は既に済んでいて、描き手は組むだけである。
const snapshot = { kind: "view", view };

// 器が出す HTML をそのまま使い、script の在処と vscode の代わりだけを差し込む。
const html = renderHtml(
  { cspSource: "", asWebviewUri: (u) => u },
  { toString: () => "./webview.js" },
  "en",
  shellStrings(),
);
// 器が実際に打った属性から取る。CSP の 'nonce-…' 側を字面で拾うと、
// 値の字種が変わったとき（Math.random の英数字 → randomBytes の base64url）に
// 静かに切り取られ、差し込んだ style と script だけが CSP で弾かれて
// 真っ白な画面を「確かめた」ことになる。実際に起きた。
// 取った値が器の打った二箇所と食い違っていないことまでここで検める。
const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1] ?? "";
if (!nonce) throw new Error("器が出した HTML から nonce を取れない。");
const occurrences = html.split(`nonce-${nonce}`).length - 1;
if (occurrences !== 2) {
  throw new Error(
    `nonce が CSP と食い違う（'nonce-${nonce}' が ${occurrences} 箇所、2 のはず）。` +
      "差し込む style と script が弾かれ、白い画面を確かめることになる。",
  );
}

// 編集器が webview へ流し込む主題の変数を模す。これを置かないと、
// stroke に無効な値が入って辺が消えるなど、実環境と食い違った見え方になる。
const THEME = `<style nonce="${nonce}">:root{
  --vscode-font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  --vscode-font-size: 13px;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #9d9d9d;
  --vscode-editor-background: #1f1f1f;
  --vscode-editorWidget-background: #303031;
  --vscode-panel-border: #2b2b2b;
  --vscode-focusBorder: #0078d4;
  --vscode-textLink-foreground: #4daafc;
  --vscode-toolbar-hoverBackground: #5a5d5e50;
  --vscode-button-background: #0078d4;
  --vscode-button-foreground: #ffffff;
  --vscode-button-secondaryBackground: #313131;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-button-secondaryHoverBackground: #3c3c3c;
  --vscode-dropdown-background: #313131;
  --vscode-dropdown-foreground: #cccccc;
  --vscode-dropdown-border: #3c3c3c;
  --vscode-editor-font-family: "Droid Sans Mono", monospace;
  --vscode-inputValidation-infoBackground: #063b49;
  --vscode-inputValidation-infoBorder: #1a85ff;
  --vscode-inputValidation-errorBackground: #5a1d1d;
  --vscode-inputValidation-errorBorder: #be1100;
}</style>`;

const stub = `${THEME}<script nonce="${nonce}">
globalThis.acquireVsCodeApi = () => ({
  postMessage: (m) => { (window.__sent ??= []).push(m); console.log("to host:", JSON.stringify(m)); },
  getState: () => undefined,
  setState: () => {},
});
window.addEventListener("DOMContentLoaded", () => {
  // 本体が最初に送るものと同じ形を流す。
  setTimeout(() => window.postMessage(${JSON.stringify(snapshot)}, "*"), 0);
});
</script>`;

writeFileSync(join(outDir, "index.html"), html.replace("</head>", `${stub}\n</head>`), "utf8");

// webview の束は、ここで src から組み立てる。dist/ を写してはならない。
//
// 写していたときは、この道具を走らせるだけで .preview/webview.js の日付が
// 「いま」になり、中身は最後に npm run compile した時点のままだった。
// shoot-preview.mjs の鮮度の門はその日付を見るので、絶対に発火しなかった。
// つまり src を壊しても「画面の誤り 0」と読める状態が残っていた（四巡目で発覚）。
// 束ね方は esbuild.mjs から借りる。写しを持つと、また片方だけが古びる。
await build(webviewOptions(join(outDir, "webview.js")));

console.log(
  `${join(outDir, "index.html")} を書いた（起点 ${ORIGIN}・` +
    `波 ${view.waves.length}・行 ${view.waves.reduce((n, w) => n + w.rows.length, 0)}・` +
    `循環 ${view.cycles.length}・題名 ${Object.keys(titleReport).length}）。`,
);
