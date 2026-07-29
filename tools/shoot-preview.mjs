#!/usr/bin/env node
// preview-webview.mjs が書いた画面を実際に開き、操作して、写しを撮る。
//
// 「組み上がった」と「動いた」は別である。ここは後者を確かめる。
// 深度を降りる・上がる、ダイヤルを回す、の一通りを実際に踏む。
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const previewDir = join(projectRoot, ".preview");
const shotDir = process.argv[2] ?? join(previewDir, "shots");

// 古い束に対して写しを撮らない。
//
// preview-webview.mjs が落ちても .preview/ は前回のまま残るので、この道具は
// 何事も無く走り、直す前の画面を「確かめた」ことにしてしまう。実際に起きた。
// 直した覚えのある不具合が写しに残り、誰も気づかなかった。
const freshness = (path) => {
  try {
    return statSync(join(projectRoot, path)).mtimeMs;
  } catch {
    return null;
  }
};
const preview = freshness(".preview/webview.js");
if (preview === null) {
  throw new Error(".preview/webview.js が無い。先に node tools/preview-webview.mjs を走らせること。");
}
const newest = (dir) => {
  let at = 0;
  let newestPath = "";
  for (const entry of readdirSync(join(projectRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    const [childAt, childPath] = entry.isDirectory()
      ? newest(rel)
      : [freshness(rel) ?? 0, rel];
    if (childAt > at) [at, newestPath] = [childAt, childPath];
  }
  return [at, newestPath];
};
const [srcAt, srcPath] = newest("src");
if (srcAt > preview) {
  throw new Error(
    `${srcPath} が .preview/webview.js より新しい。古い束に写しを撮ろうとしている。` +
      " 先に node tools/preview-webview.mjs を走らせること。",
  );
}

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
  // 場面そのものが告げることは別の帯に出る。片方だけ見ると、段を戻したことや
  // 辺の省略を「何も出ていない」と読み違える。
  sceneNotice: (await page.locator("#sceneNotice").isVisible())
    ? (await page.locator("#sceneNotice").innerText()).replace(/\s+/g, " ").trim()
    : null,
  legendText: (await page.locator("#legend").innerText()).replace(/\s+/g, " ").trim(),
  inspectorTitle: await page.evaluate(() => {
    const box = document.getElementById("inspector");
    if (!box || box.hidden) return null;
    return (box.querySelector("h2")?.textContent ?? "").trim();
  }),
});

const steps = [];
const failures = [];

/**
 * 一段ぶん記録し、期待した状態になっているかを検める。
 *
 * 誤りが出ないことだけを合否にすると、操作が丸ごと効かなくなっても「通った」に
 * なる。実際、写しの題と中身が食い違っていても誰も気づかなかった。
 * ここは「その操作が効いたか」を毎回検める。
 */
const record = async (label, name, expected = {}) => {
  await shot(name);
  const now = await state();
  steps.push({ label, ...now });
  for (const [key, want] of Object.entries(expected)) {
    const got = now[key];
    const ok = typeof want === "function" ? want(got) : got === want;
    if (!ok) {
      failures.push(`${label}: ${key} が ${JSON.stringify(got)}（期待: ${String(want)}）`);
    }
  }
};

const crumbEndsWith = (tail) => (value) => value.startsWith(tail);
const some = (n) => (value) => value > 0;

await record("L0 文脈の地図", "01-L0", {
  crumbs: crumbEndsWith("Context map "),
  layout: "map",
  nodes: some(),
  legendText: (v) => v.includes("Fingerprint"),
  sceneNotice: null,
});

// 降りる（ダブルクリック）。
await page.locator('.node[data-key="lens"]').first().dblclick();
await record("L1 lens ドメイン内部", "02-L1", {
  crumbs: crumbEndsWith("Context map › lens "),
  layout: "lane",
  nodes: some(),
});

// 色のダイヤルを回す。深度と配置が保たれることを見る（REQ-002）。
await page.selectOption("#colorBy", "status");
await record("L1 色を status に", "03-L1-status", {
  colorBy: "status",
  layout: "lane",
  crumbs: crumbEndsWith("Context map › lens "),
});

// 絞りを効かせる。効いたことは、節点が減ることで見る。
const beforeFilter = await state();
await page.selectOption("#filterType", "SPEC");
await record("L1 型を SPEC に絞る", "04-L1-filter", {
  nodes: (value) => value > 0 && value < beforeFilter.nodes,
  layout: "lane",
});
await page.selectOption("#filterType", "");

// さらに降りる。印を持つ仕様を選び、L3 まで行けるようにする。
await page.locator('.node[data-key="SPEC-002"]').first().dblclick();
await record("L2 文書の細部", "05-L2", {
  crumbs: crumbEndsWith("Context map › lens › SPEC-002 "),
  layout: "detail",
  inspector: true,
  // 検分欄は焦点の文書を出す（別の節点を出していたら気づけるように）。
  inspectorTitle: "SPEC-002",
  legendText: (v) => v.length > 0,
});

// L2 の焦点そのものを選ぶと L3 へ降りる（SPEC-002）。
await page.locator('.node[data-key="SPEC-002"]').first().dblclick();
await record("L3 コード範囲", "06-L3", {
  crumbs: crumbEndsWith("Context map › lens › SPEC-002 › "),
  layout: "list",
  nodes: some(),
  // 凡例は指紋の判定を必ず言う（何も言わない回があってはならない）。
  legendText: (v) => v.includes("Fingerprint"),
  sceneNotice: null,
});

// L3 の範囲を押すと、本体へ「開け」が飛ぶ。編集器が無いので送った内容を検める。
//
// 「飛んだこと」だけを見ていた頃は、begin と end を入れ替えても緑だった。
// 送った値そのものを、画面に出ている範囲の札と突き合わせる。
// SVG の g 要素は innerText を持たない。中の text から組み立てる。
const firstLabel = await page.evaluate(() => {
  const g = document.querySelector(".node");
  return [...(g?.querySelectorAll("text") ?? [])].map((t) => t.textContent ?? "").join(" ").trim();
});
await page.locator(".node").first().dblclick();
const sent = await page.evaluate(() => window.__sent ?? []);
const openRange = sent.filter((m) => m.kind === "openRange");
if (openRange.length === 0) {
  failures.push("L3 の範囲を押しても本体へ openRange が飛ばない");
} else {
  const [m] = openRange;
  // 札は「パス」「始まり–終わり · N lines」の二行である。
  const [shownPath, shownLines] = firstLabel.split(" ");
  if (m.path !== shownPath) {
    failures.push(`openRange の path が画面と違う: ${m.path} ≠ ${shownPath}`);
  }
  const [begin, end] = (shownLines ?? "").split("–").map((n) => Number.parseInt(n, 10));
  if (Number.isFinite(begin) && m.beginLine !== begin) {
    failures.push(`openRange の beginLine が画面と違う: ${m.beginLine} ≠ ${begin}`);
  }
  if (Number.isFinite(end) && m.endLine !== end) {
    failures.push(`openRange の endLine が画面と違う: ${m.endLine} ≠ ${end}`);
  }
  if (m.beginLine > m.endLine) {
    failures.push(`openRange の始まりが終わりより後ろ: ${m.beginLine} > ${m.endLine}`);
  }
}

// 上がる（Backspace）。L3 → L2 → L1 → L0。
// 焦点をわざと canvas の外へ置いてから打つ。降りた直後に焦点が地図から
// 外れていても上がれることまで見る（外れると案内どおりに動かない欠陥があった）。
await page.locator("#colorBy").focus();
await page.locator("body").click({ position: { x: 5, y: 400 } });
await page.keyboard.press("Backspace");
await record("L3 から L2 へ戻る", "07-up-L2", {
  crumbs: crumbEndsWith("Context map › lens › SPEC-002 "),
  layout: "detail",
});
await page.keyboard.press("Backspace");
await record("L1 へ戻る", "08-up-L1", {
  crumbs: crumbEndsWith("Context map › lens "),
  layout: "lane",
});
await page.keyboard.press("Backspace");
await record("L0 へ戻る", "09-up-L0", {
  crumbs: crumbEndsWith("Context map "),
  layout: "map",
});

await browser.close();

console.log(JSON.stringify({ steps, openRange, errors, failures }, null, 2));
if (errors.length > 0) {
  console.error(`\n画面で ${errors.length} 件の誤りが出た。`);
}
if (failures.length > 0) {
  console.error(`\n期待どおりに動かなかった操作が ${failures.length} 件:`);
  for (const line of failures) console.error(`  - ${line}`);
}
if (errors.length > 0 || failures.length > 0) process.exit(1);
