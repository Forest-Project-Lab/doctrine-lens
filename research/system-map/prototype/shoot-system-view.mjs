// 統治の実態の画面の静止画を、**漏れなく**撮る(所有者の確認用)。
//
//   node shoot-system-view.mjs                →  shots-system-view/*.png
//   node shoot-system-view.mjs --print-plan   →  何を撮るつもりかを刷る(ブラウザを起こさない)
//
// **撮る枚は画面から導く。** 節の一覧を綴りへ書くと、節を足したときに撮り漏れる ——
// しかも落ちないので気付けない(既存の `shoot.mjs` が同じ理由で一覧の直書きをやめた)。
// ここでは出荷物の `<h2>` を数え、**一節も落とさずに撮る**。
//
// 撮る物:
//   00-full            頁の全体(縦に長い一枚)
//   01..NN-<節>        節ごと
//   XX-details-open    開閉子を全て開いた状態(閉じたままだと中身が像に残らない)
//
// 静止画は撮った時点の木でしか正しくない。README に撮影時点の commit を刻む。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "system-view.html");
const shotsDir = join(here, "shots-system-view");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

if (!existsSync(page)) die(`出荷物が無い: ${page}\n  先に build-system-view.mjs を回すこと`, 2);

/** 節の見出しを出荷物から採る。**綴りへ書かない。** */
const html = readFileSync(page, "utf8");
const headings = [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) =>
  m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
if (headings.length < 5) die(`節が ${headings.length} 個しか採れない(下限 5)。走査が壊れている疑いがある —— 撮り漏れを「節が無かった」と読み替えない`, 2);

/** 見出しから、順序を保つ安全な名前を作る(位置の番号ではなく、見出しの先頭の番号を使う)。 */
const slug = (h, i) => {
  const head = (h.match(/^\d+/) ?? [String(i + 1)])[0].padStart(2, "0");
  const body = h.replace(/^\d+\.\s*/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 28);
  return `${head}-${body}`;
};

const plan = [
  { name: "00-full", what: "頁の全体", selector: null, open: false },
  ...headings.map((h, i) => ({ name: slug(h, i), what: h, selector: `h2:nth-of-type(${i + 1})`, open: false })),
  { name: "99-details-open", what: "開閉子を全て開いた状態(生の返り値)", selector: null, open: true },
];

if (flag("--print-plan")) {
  console.log(JSON.stringify({ page, out: shotsDir, count: plan.length, shots: plan.map((p) => ({ name: p.name, what: p.what })) }, null, 2));
  process.exit(0);
}

const { chromium } = await import("playwright");
mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
// **外部への取得を一つも許さない。** 出荷物は自己完結である —— 通信が起きたら像ではなく
// 設計の欠陥なので、静かに待たずに落とす。
const外部 = [];
p.on("request", (r) => { if (!r.url().startsWith("file:")) 外部.push(r.url()); });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

await p.goto("file://" + page, { waitUntil: "load" });

let n = 0;
for (const s of plan) {
  if (s.open) await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  else await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = false)));

  const out = join(shotsDir, `${s.name}.png`);
  if (s.selector) {
    const el = await p.$(s.selector);
    if (!el) die(`節が見つからない: ${s.selector}(${s.what})`, 2);
    // 見出しから次の見出しの手前までを一枚に収める。
    const box = await p.evaluate((sel) => {
      const h = document.querySelector(sel);
      let end = h.nextElementSibling;
      let bottom = h.getBoundingClientRect().bottom;
      while (end && end.tagName !== "H2") { bottom = end.getBoundingClientRect().bottom; end = end.nextElementSibling; }
      const r = h.getBoundingClientRect();
      return { x: Math.max(0, r.x - 8), y: r.y + window.scrollY - 8, width: Math.min(window.innerWidth, r.width + 16), height: Math.max(40, bottom - r.y + 16) };
    }, s.selector);
    await p.screenshot({ path: out, clip: { ...box, y: box.y } });
  } else {
    await p.screenshot({ path: out, fullPage: true });
  }
  n++;
  console.log(`  撮った ${s.name}.png — ${s.what}`);
}

await browser.close();

if (外部.length) die(`出荷物が外部へ取得しに行った(自己完結でない): ${外部.slice(0, 3).join(" / ")}`, 1);
if (errors.length) die(`画面が例外を出した: ${errors.slice(0, 2).join(" / ")}`, 1);

// 計画に無い古い像が残ると、所有者は消えた節の像を現行として読む。**報告して落とす。**
const orphans = readdirSync(shotsDir).filter((f) => f.endsWith(".png") && !plan.some((s) => `${s.name}.png` === f));
const rev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: here, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", here], { cwd: here, encoding: "utf8" }).trim() !== "";
writeFileSync(join(shotsDir, "README.md"),
  `# 統治の実態の画面 — 静止画\n\n`
  + `- 撮影時点の commit: \`${rev}\`${dirty ? "（**作業木が汚れている**。この像はどの commit にも対応しない）" : ""}\n`
  + `- 撮った枚数: ${n}（節 ${headings.length} 個 + 全体 + 開いた状態）\n`
  + `- **撮る枚は出荷物の \`<h2>\` から導いている。** 節を足せば自動で増える。\n\n`
  + `| 名 | 何を撮ったか |\n|---|---|\n`
  + plan.map((s) => `| \`${s.name}.png\` | ${s.what} |`).join("\n") + "\n", "utf8");

console.log(`\n${n} 枚撮った → ${shotsDir}`);
if (orphans.length) die(`計画に無い古い像が ${orphans.length} 枚残っている: ${orphans.join(", ")}`, 1);
