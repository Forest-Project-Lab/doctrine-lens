// M-13 の実ブラウザ検査 — 「実行時の外部読み込み零」を実通信の記録で確かめる。
//
//   node test-m13-browser.mjs
//
// 正: 通常起動・対象切替・要素選択・詳細表示・ドリルダウンの全操作で外部リクエスト 0 件。
//     オフライン状態でも同じ操作が成立する。
// 負: 外部 script / stylesheet / img / fetch / font を仕込んだ変種で、外部リクエストの
//     試行が検出される(検出されなければこの検査は飾り)。
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "index.html");
let failures = 0;
const report = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "ok   " : "NG   ") + name + (detail ? " — " + detail : ""));
};

const b = await chromium.launch();

/** ページを開いて操作し、外部(file: 以外)リクエストを収集する。 */
async function sweep(url, { offline = false, interact = true } = {}) {
  const ctx = await b.newContext();
  await ctx.route("**", (route) => {
    const u = route.request().url();
    if (u.startsWith("file:")) route.continue();
    else route.abort(); // 外部は遮断(検出はする) — 試験を密閉に保つ
  });
  const p = await ctx.newPage();
  const external = [];
  const pageErrors = [];
  p.on("request", (r) => { if (!r.url().startsWith("file:")) external.push(r.url()); });
  p.on("pageerror", (e) => pageErrors.push(e.message));
  if (offline) await ctx.setOffline(true);
  await p.goto(url, { waitUntil: "load" }).catch((e) => pageErrors.push("goto: " + e.message));
  if (interact) {
    for (const tiv of ["0", "1", "2", "3"]) {
      await p.selectOption("#target", tiv).catch(() => {});
      await p.locator("svg g[data-el]").first().click().catch(() => {});
    }
    await p.selectOption("#target", "0").catch(() => {});
    const drill = p.locator("[data-drill]").first();
    if (await drill.count()) await drill.click().catch(() => {});
    for (const v of ["scenario", "assurance", "impact", "inspect"]) {
      await p.locator(`nav button[data-v="${v}"]`).click().catch(() => {});
    }
  }
  const boxes = await p.locator("nav button").count().catch(() => 0);
  await ctx.close();
  return { external, pageErrors, uiAlive: boxes === 5 };
}

// ---- 正: 現物・オンライン ----
{
  const r = await sweep("file://" + indexPath);
  report(r.external.length === 0, "正: 全操作で外部リクエスト 0 件", r.external.slice(0, 3).join(", "));
  report(r.pageErrors.length === 0, "正: JS エラー零", r.pageErrors[0]);
}

// ---- 正: オフライン ----
{
  const r = await sweep("file://" + indexPath, { offline: true });
  report(r.pageErrors.length === 0 && r.uiAlive, "正: オフラインでも主要操作が成立", r.pageErrors[0]);
}

// ---- 負: 外部資源を仕込んだ変種が検出される ----
const base = readFileSync(indexPath, "utf8");
const tmp = mkdtempSync(join(tmpdir(), "m13-"));
const negatives = [
  ["script", '<script src="https://example.invalid/x.js"></script>'],
  ["stylesheet", '<link rel="stylesheet" href="https://example.invalid/x.css">'],
  ["img", '<img src="https://example.invalid/x.png">'],
  ["fetch", "<script>fetch('https://example.invalid/api')</script>"],
  ["font", '<style>@font-face{font-family:X;src:url("https://example.invalid/x.woff2")}body{font-family:X,sans-serif}</style>'],
];
for (const [name, inject] of negatives) {
  const f = join(tmp, `neg-${name}.html`);
  writeFileSync(f, base.replace("</head>", inject + "</head>"));
  const r = await sweep("file://" + f, { interact: false });
  report(r.external.length > 0, `負: 外部 ${name} の仕込みが検出される`, r.external.length === 0 ? "検出されず(飾りの門)" : "");
}

await b.close();
console.log(failures === 0 ? "\n全件通過(正 3・負 5)" : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
