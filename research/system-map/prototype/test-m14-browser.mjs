// M-14 の実操作判定 — 全ての到達可能要素について、実ブラウザで実際に操作して
// 「コードまたは証拠のリンクが開く」までのクリック数を数え、計算値(gates.mjs)と突き合わせる。
//
//   node test-m14-browser.mjs
//
// 計算(遷移グラフ)と実操作が食い違えば、この試験が落ちる — 計算だけの緑を許さない。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { computeOpsRows } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gm = (f) => JSON.parse(readFileSync(join(here, "..", "gold-model", f), "utf8"));
const files = ["target-1-doctrine-and-lens.json", "target-2-lens-shipping.json", "target-3-celery.json", "fixture-rare-states.json"];
const models = files.map(gm);
const rows = computeOpsRows(models);
const targetIndex = Object.fromEntries(models.map((m, i) => [m.target, String(i)]));

let failures = 0;
const report = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "ok   " : "NG   ") + name + (detail ? " — " + detail : ""));
};

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto("file://" + join(here, "index.html"));

for (const r of rows.filter((r) => r.status === "reachable")) {
  const m = models.find((m) => m.target === r.target);
  const e = m.elements.find((e) => e.id === r.element);
  // 初期化(初期化操作は要素到達の操作数に数えない — 起点は「対象のシステム画面」)
  await p.selectOption("#target", targetIndex[r.target]);
  await p.locator('nav button[data-v="system"]').click();
  let clicks = 0;
  if ((e.parent ?? null) !== null) {
    await p.locator(`[data-drill="${e.parent}"]`).click(); clicks++;   // 降りる
  }
  await p.locator(`svg g[data-el="${e.id}"]`).click(); clicks++;        // 選ぶ
  const link = p.locator("#detail h3:has-text('12.') ~ ul a, #detail ul a").first();
  const visible = await link.isVisible().catch(() => false);
  if (!visible) { report(false, `${r.target}/${r.element}`, "12 節にリンクが見えない"); continue; }
  const href = await link.getAttribute("href");
  const [popup] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
  clicks++;                                                             // 開く
  const opened = popup.url();
  await popup.close();
  const okOpen = opened === href && /^https?:\/\//.test(opened);
  const okCount = clicks === r.ops && clicks <= 3;
  report(okOpen && okCount, `${r.target}/${r.element}`,
    `実操作 ${clicks} / 計算 ${r.ops}${okOpen ? "" : " / 開いた先が不一致: " + opened}`);
}

// 対象外の要素は 12 節に「対象外」と理由が出ることを確認(代表 3 件)
for (const r of rows.filter((r) => r.status === "not_applicable").slice(0, 3)) {
  const m = models.find((m) => m.target === r.target);
  const e = m.elements.find((e) => e.id === r.element);
  await p.selectOption("#target", targetIndex[r.target]);
  await p.locator('nav button[data-v="system"]').click();
  if ((e.parent ?? null) !== null) await p.locator(`[data-drill="${e.parent}"]`).click();
  await p.locator(`svg g[data-el="${e.id}"]`).click();
  const txt = await p.locator("#detail").textContent();
  report(txt.includes("対象外"), `NA 表示: ${r.target}/${r.element}`);
}

await b.close();
console.log(failures === 0 ? "\n全件通過(実操作と計算の突合)" : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
