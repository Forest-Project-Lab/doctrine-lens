#!/usr/bin/env node
// preview-webview.mjs が書いた画面を実際に開き、操作して、写しを撮る。
//
// 「組み上がった」と「動いた」は別である。ここは後者を確かめる。
// 明細を読み、行を押し、狭い幅まで詰めて、面から出るものが無いかを見る
// （SPEC-006 受入基準 10・11）。
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
    const [childAt, childPath] = entry.isDirectory() ? newest(rel) : [freshness(rel) ?? 0, rel];
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
const page = await browser.newPage({ viewport: { width: 720, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(pathToFileURL(join(previewDir, "index.html")).href);
await page.waitForSelector(".row", { timeout: 10000 });

const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
};

const text = async (selector) =>
  (await page.locator(selector).count()) > 0
    ? (await page.locator(selector).first().innerText()).replace(/\s+/g, " ").trim()
    : null;

const state = async () => ({
  originTitle: await text(".origin h1"),
  originDetail: await text(".origin .detail"),
  summary: await text(".origin .summary"),
  waves: await page.locator(".wave").count(),
  waveHeading: await text(".wave h2"),
  rows: await page.locator(".row").count(),
  ranges: await page.locator(".row .range").count(),
  footnotes: await page.locator(".foot p").count(),
  legend: await page.locator(".foot .legend span").count(),
  svg: await page.locator("svg").count(),
  // 記号は左端の固定幅の溝に出る。字を集めれば、五つの語彙の外が入っていないか見える。
  marks: await page.evaluate(() =>
    [...new Set([...document.querySelectorAll(".row .mark")].map((n) => n.textContent))].sort(),
  ),
  // 本体へ送った合図。押しても何も起きない状態を残さないことを見る。
  sent: await page.evaluate(() => (window.__sent ?? []).map((m) => m.kind)),
  // 横に溢れていないか。面そのものと、中の子を両方見る。
  overflow: await page.evaluate(() => {
    const out = [];
    for (const node of document.querySelectorAll("body, .sheet, .row, .origin, .foot, .bar")) {
      if (node.scrollWidth > node.clientWidth + 1) {
        out.push(`${node.className || node.tagName}: ${node.scrollWidth}>${node.clientWidth}`);
      }
    }
    return out;
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
    const ok = typeof want === "function" ? want(got) : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      failures.push(`${label}: ${key} が ${JSON.stringify(got)}（期待: ${String(want)}）`);
    }
  }
  return now;
};

const some = () => (value) => value > 0;
const MARKS = new Set(["×", "+", "?", "!", "~"]);

// --- 一枚目。ふつうの幅で明細を読む。 ---------------------------------------

const first = await record("明細（720px）", "01-list", {
  waves: some(),
  rows: some(),
  footnotes: some(),
  legend: 5,
  svg: 0,
  overflow: [],
  marks: (v) => v.length > 0 && v.every((m) => MARKS.has(m)),
  sent: (v) => v.includes("ready"),
});

// 主文が題名であって id ではないこと（利用者が最初に言った不満そのもの）。
if (!first.originTitle || /^[A-Z]+-\d+$/.test(first.originTitle)) {
  failures.push(`起点の主文が題名になっていない: ${JSON.stringify(first.originTitle)}`);
}
if (!first.originDetail || !/^[A-Z]+-\d+ · /.test(first.originDetail)) {
  failures.push(`副文に id・パスが出ていない: ${JSON.stringify(first.originDetail)}`);
}
// 波の見出しは名前ではなく文である。
if (!first.waveHeading || first.waveHeading.length < 4) {
  failures.push(`波の見出しが文になっていない: ${JSON.stringify(first.waveHeading)}`);
}
// 要約は「良い状態」も数で言う。
if (!first.summary || !/\d/.test(first.summary)) {
  failures.push(`要約に数が出ていない: ${JSON.stringify(first.summary)}`);
}

// --- 行を押す。文書が開く合図が本体へ届くこと。 -----------------------------

await page.locator(".row").first().click();
await record("行を押した", "02-open-document", {
  sent: (v) => v.includes("openDocument"),
});

// コード範囲がある行なら、その札も押す。明細は file:line で着地する。
if (first.ranges > 0) {
  await page.locator(".row .range").first().click();
  await record("範囲の札を押した", "03-open-range", {
    sent: (v) => v.includes("openRange"),
  });
} else {
  failures.push("コード範囲の札が一つも無い（明細が file:line で着地していない）");
}

// 鍵盤だけでも行を開けること。
await page.locator(".row").first().focus();
await page.keyboard.press("Enter");
await record("鍵盤で開いた", "04-keyboard", {
  sent: (v) => v.filter((k) => k === "openDocument").length >= 2,
});

// 取り直しの釦。
await page.locator("#refresh").click();
await record("取り直しを押した", "05-refresh", {
  sent: (v) => v.includes("refresh"),
});

// --- 幅を詰める。280px でも面から出ない（受入基準 11）。---------------------

for (const width of [480, 280]) {
  await page.setViewportSize({ width, height: 900 });
  await record(`幅 ${width}px`, `06-width-${width}`, {
    rows: some(),
    overflow: [],
    svg: 0,
  });
}

// --- 通知。上流の長い traceback が器を壊さないこと。 ------------------------

await page.setViewportSize({ width: 280, height: 900 });
await page.evaluate(() => {
  window.postMessage(
    {
      kind: "notice",
      tone: "error",
      text: "The doctrine CLI failed.",
      detail: `Traceback (most recent call last):\n${"  File \"/very/long/path/that/does/not/wrap/scripts/dep-graph.py\", line 412, in main\n".repeat(20)}`,
    },
    "*",
  );
});
await record("長い通知（280px）", "07-notice", { overflow: [] });

await browser.close();

for (const step of steps) {
  console.log(
    `${step.label}: 波 ${step.waves}・行 ${step.rows}・範囲 ${step.ranges}・` +
      `記号 ${step.marks.join("")}・svg ${step.svg}`,
  );
}
if (errors.length > 0) {
  console.error(`\n画面の誤り ${errors.length} 件:`);
  for (const line of errors.slice(0, 10)) console.error(`  - ${line}`);
}
if (failures.length > 0) {
  console.error(`\n期待と違う状態 ${failures.length} 件:`);
  for (const line of failures) console.error(`  - ${line}`);
}
if (errors.length > 0 || failures.length > 0) process.exit(1);
console.log(`\n写しを ${shotDir} に書いた。誤り 0・食い違い 0。`);
