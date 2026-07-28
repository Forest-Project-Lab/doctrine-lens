#!/usr/bin/env node
// preview-webview.mjs が書いた画面を実際に開き、操作して、写しを撮る。
//
// 「組み上がった」と「動いた」は別である。ここは後者を確かめる。
// 深度を降りる・上がる、ダイヤルを回す、の一通りを実際に踏む。
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const previewDir = join(projectRoot, ".preview");
const shotDir = process.argv[2] ?? join(previewDir, "shots");
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(pathToFileURL(join(previewDir, "index.html")).href);
await page.waitForSelector(".node", { timeout: 10000 });

const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shotDir, `${name}.png`) });
};

const state = async () => ({
  crumbs: (await page.locator("#crumbs").innerText()).replace(/\s+/g, " ").trim(),
  nodes: await page.locator(".node").count(),
  edges: await page.locator(".edge").count(),
  layout: await page.locator("#layout").inputValue(),
  colorBy: await page.locator("#colorBy").inputValue(),
  legend: await page.locator("#legend span").count(),
  inspector: await page.locator("#inspector").isVisible(),
  notice: (await page.locator("#notice").isVisible())
    ? (await page.locator("#notice").innerText()).replace(/\s+/g, " ").trim()
    : null,
});

const steps = [];
const record = async (label, name) => {
  await shot(name);
  steps.push({ label, ...(await state()) });
};

await record("L0 文脈の地図", "01-L0");

// 降りる（ダブルクリック）。
await page.locator('.node[data-key="lens"]').dblclick();
await record("L1 lens ドメイン内部", "02-L1");

// 色のダイヤルを回す。深度と配置が保たれることを見る。
await page.selectOption("#colorBy", "status");
await record("L1 色を status に", "03-L1-status");

// 絞りを効かせる。
await page.selectOption("#filterType", "SPEC");
await record("L1 型を SPEC に絞る", "04-L1-filter");
await page.selectOption("#filterType", "");

// さらに降りる。印を持つ仕様を選び、L3 まで行けるようにする。
await page.locator('.node[data-key="SPEC-002"]').dblclick();
await record("L2 文書の細部", "05-L2");

// L2 の焦点そのものを選ぶと L3 へ降りる（SPEC-002）。
await page.locator('.node[data-key="SPEC-002"]').dblclick();
await record("L3 コード範囲", "06-L3");

// L3 の範囲を押すと、本体へ「開け」が飛ぶ。編集器が無いので送った内容だけを見る。
await page.locator(".node").first().dblclick();
const sent = await page.evaluate(() => window.__sent ?? []);
const openRange = sent.filter((m) => m.kind === "openRange");

// 上がる（Backspace）。L3 → L2 → L1 → L0。
await page.locator("#canvas").focus();
await page.keyboard.press("Backspace");
await record("L3 から L2 へ戻る", "07-up-L2");
await page.keyboard.press("Backspace");
await record("L1 へ戻る", "08-up-L1");
await page.keyboard.press("Backspace");
await record("L0 へ戻る", "09-up-L0");

await browser.close();

console.log(JSON.stringify({ steps, openRange, errors }, null, 2));
if (errors.length > 0) {
  console.error(`\n画面で ${errors.length} 件の誤りが出た。`);
  process.exit(1);
}
