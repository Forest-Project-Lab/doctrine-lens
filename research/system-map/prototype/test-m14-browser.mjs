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
import { loadModels, targetIndex } from "../gold-model/spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// 対象の一覧と、画面での指し方は registry.json / spec.mjs が正本。ここでは持たない。
const models = loadModels("gates");
const rows = computeOpsRows(models);

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
  await p.selectOption("#target", targetIndex(r.target));
  await p.locator('nav button[data-v="system"]').click();
  let clicks = 0;
  if ((e.parent ?? null) !== null) {
    await p.locator(`[data-drill="${e.parent}"]`).click(); clicks++;   // 降りる
  }
  await p.locator(`svg g[data-el="${e.id}"]`).click(); clicks++;        // 選ぶ
  // 計算が挙げた全到達先が 12 節に見えており、一つを実際に開き、全てが HTTP で到達成功すること
  const wantUrls = r.links.map((l) => l.url);
  const seenHrefs = await p.locator("#detail a").evaluateAll((as) => as.map((a) => a.href));
  const missing = wantUrls.filter((u) => !seenHrefs.includes(u));
  if (missing.length) { report(false, `${r.target}/${r.element}`, "12 節に無いリンク: " + missing[0]); continue; }
  const href = wantUrls[0];
  const link = p.locator(`#detail a[href="${href}"]`).first();
  const [popup] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
  clicks++;                                                             // 開く
  const opened = popup.url();
  await popup.close();
  let reachBad = null;
  for (const u of wantUrls) {
    // 到達成功の検査(開いただけを成功と呼ばない)。429 は「存在するが抑流」なので一度待って再試行し、
    // それでも 429 なら到達扱い(存在の否定ではない)。404/5xx は失敗。
    let res = await ctx.request.get(u).catch(() => null);
    if (res && res.status() === 429) { await new Promise((r) => setTimeout(r, 2500)); res = await ctx.request.get(u).catch(() => null); }
    const st = res ? res.status() : null;
    const ok = st !== null && (st < 400 || st === 429);
    if (!ok) { reachBad = `${u} → ${st ?? "接続不能"}`; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  const okOpen = opened === href && /^https?:\/\//.test(opened);
  const okCount = clicks === r.ops && clicks <= 3;
  report(okOpen && okCount && !reachBad, `${r.target}/${r.element}`,
    `実操作 ${clicks} / 計算 ${r.ops} / 到達先 ${wantUrls.length} 件` +
    (okOpen ? "" : " / 開いた先が不一致: " + opened) + (reachBad ? " / 到達失敗: " + reachBad : ""));
}

// 対象外の要素は 12 節に「対象外」と理由が出ることを確認(代表 3 件)
for (const r of rows.filter((r) => r.status === "not_applicable").slice(0, 3)) {
  const m = models.find((m) => m.target === r.target);
  const e = m.elements.find((e) => e.id === r.element);
  await p.selectOption("#target", targetIndex(r.target));
  await p.locator('nav button[data-v="system"]').click();
  if ((e.parent ?? null) !== null) await p.locator(`[data-drill="${e.parent}"]`).click();
  await p.locator(`svg g[data-el="${e.id}"]`).click();
  const txt = await p.locator("#detail").textContent();
  report(txt.includes("対象外"), `NA 表示: ${r.target}/${r.element}`);
}

await b.close();
console.log(failures === 0 ? "\n全件通過(実操作と計算の突合)" : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
