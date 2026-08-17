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

if (flag("--print-plan")) {
  console.log(JSON.stringify({
    page, out: shotsDir,
    sections: headings.length,
    plan: ["00-full(頁の全体)", "01..NN-page(視野の高さで割った全面。取りこぼしが起きない)", "zz-details-open(開閉子を全て開いた頁の全体)"],
    section_names: headings,
  }, null, 2));
  process.exit(0);
}

const { chromium } = await import("playwright");
mkdirSync(shotsDir, { recursive: true });
for (const f of readdirSync(shotsDir)) if (f.endsWith(".png")) rmSync(join(shotsDir, f));

const W = 1100, H = 900;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
// **外部への取得を一つも許さない。** 出荷物は自己完結である。
const external = [];
p.on("request", (r) => { if (!r.url().startsWith("file:")) external.push(r.url()); });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

await p.goto("file://" + page, { waitUntil: "load" });

const shots = [];
const shoot = async (name, what, opts) => {
  await p.screenshot({ path: join(shotsDir, `${name}.png`), timeout: 120000, ...opts });
  shots.push({ name, what });
  console.log(`  撮った ${name}.png — ${what}`);
};

/** 頁の全体を、視野の高さで割って**全部**撮る。取りこぼしが原理的に起きない。 */
const tiles = async (prefix, label) => {
  const total = await p.evaluate(() => document.documentElement.scrollHeight);
  const n = Math.ceil(total / H);
  for (let i = 0; i < n; i++) {
    const y = i * H;
    await p.evaluate((v) => window.scrollTo(0, v), y);
    // どこを見ているかを像の中で分かるようにする(頁の何枚目か)。
    await shoot(`${prefix}-${String(i + 1).padStart(2, "0")}`, `${label} ${i + 1}/${n} 枚目(縦 ${y}px から)`, {});
  }
  return { total, n };
};

// 1) 閉じた状態の全体一枚
await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = false)));
await shoot("00-full", "頁の全体(開閉子は閉じたまま)", { fullPage: true, timeout: 180000 });

// 2) 閉じた状態を視野ごとに割って全部
const closed = await tiles("page", "頁");

// 3) 開閉子を全て開いた状態(生の返り値が像に残る)
await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
await p.evaluate(() => window.scrollTo(0, 0));
const opened = await tiles("open", "開閉子を開いた頁");

await browser.close();

if (external.length) die(`出荷物が外部へ取得しに行った(自己完結でない): ${external.slice(0, 3).join(" / ")}`, 1);
if (errors.length) die(`画面が例外を出した: ${errors.slice(0, 2).join(" / ")}`, 1);

const rev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: here, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", here], { cwd: here, encoding: "utf8" }).trim() !== "";
writeFileSync(join(shotsDir, "README.md"),
  `# 統治の実態の画面 — 静止画(全ページ)\n\n`
  + `- 撮影時点の commit: \`${rev}\`${dirty ? "（**作業木が汚れている**。この像はどの commit にも対応しない）" : ""}\n`
  + `- 画面の節: ${headings.length} 個\n`
  + `- **頁を視野の高さ(${H}px)で割って全部撮っている。** 取りこぼしが原理的に起きない ——\n`
  + `  閉じた状態 ${closed.n} 枚(全高 ${closed.total}px) + 開閉子を開いた状態 ${opened.n} 枚(全高 ${opened.total}px) + 全体 1 枚。\n\n`
  + `## 節の一覧(出荷物の \`<h2>\` から採った)\n\n`
  + headings.map((h, i) => `${i + 1}. ${h}`).join("\n") + "\n\n"
  + `## 撮った像\n\n| 名 | 何を撮ったか |\n|---|---|\n`
  + shots.map((s) => `| \`${s.name}.png\` | ${s.what} |`).join("\n") + "\n", "utf8");

console.log(`\n${shots.length} 枚撮った → ${shotsDir}`);
