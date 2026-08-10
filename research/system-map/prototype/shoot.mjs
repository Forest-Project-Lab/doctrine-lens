// プロトタイプの静止画を撮る(所有者の UIUX 確認用)。
//
//   node shoot.mjs                →  shots/*.png
//   node shoot.mjs --print-plan   →  何を撮るつもりかを JSON で刷る(ブラウザを起こさない)
//   node shoot.mjs --prune        →  計画に無い古い png を消す(明示のときだけ)
//
// 静止画は撮った時点の木でしか正しくない(CHANGE-018 の教訓)。README に撮影時点の
// commit を刻む。
//
// **撮る枚は模型の一覧から導く。** 以前は 13 枚の名前と対象を直書きしていたので、
// 対象を増やしても撮る枚は増えず、並べ替えると `t1`/`t2`/`t3` という名前が別の対象を
// 指した —— どちらも落ちないので気付けない。名前も id から作る(位置の番号を使わない)。
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModels, targetIds } from "../gold-model/spec.mjs";
import { slugOf, assertUniqueSlugs } from "../lib/target-slug.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const shotsDir = join(here, "shots");
const argv = process.argv.slice(2);

// ---- 撮る枚を模型から導く ----
const ids = targetIds("build");
assertUniqueSlugs(ids);
const models = loadModels("build");
const modelOf = (id) => models.find((m) => m.target === id);

/** ドリルの見本にする対象と要素。子を持つ要素が在る最初の対象から採る。 */
const drill = (() => {
  for (const id of ids) {
    const m = modelOf(id);
    const parents = new Set((m.elements ?? []).map((e) => e.parent ?? null).filter(Boolean));
    const top = (m.elements ?? []).find((e) => (e.parent ?? null) === null && parents.has(e.id));
    if (top) return { target: id, element: top.id };
  }
  return null;
})();

const plan = [];
for (const id of ids) {
  const s = slugOf(id);
  plan.push({ file: `system-${s}.png`, target: id, view: "system", note: `${id} 全体 — 構成図(1440×900・100% 相当)` });
  plan.push({ file: `assurance-${s}.png`, target: id, view: "assurance", note: `${id} 保証画面 — 状態を重い順、unknown は負の出所つき` });
}
if (drill) {
  const s = slugOf(drill.target);
  plan.push({ file: `detail-${s}.png`, target: drill.target, view: "system", select: drill.element, note: `${drill.element} を選択 — 図と 12 節の詳細パネルを同時表示` });
  plan.push({ file: `panel-${s}.png`, target: drill.target, view: "system", select: drill.element, scrollDetail: true, element: "#detail", note: "詳細パネル下部 — 9〜12 節(Guarantee/Failure/Rationale/Code・Evidence の実リンク)" });
  plan.push({ file: `drill-${s}.png`, target: drill.target, view: "system", drill: drill.element, note: `${drill.element} の内部 — パンくず+親の目的常示+越境流れの集約表` });
  plan.push({ file: `scenario-${s}.png`, target: drill.target, view: "scenario", expandAll: true, note: `${drill.target} シナリオ画面(正常系+例外系)` });
}
const anyTarget = ids[0];
plan.push({ file: "impact.png", target: anyTarget, view: "impact", note: "変更影響画面 — 答えの正本は既存 Lens と明記(混ぜない)" });
plan.push({ file: "inspect.png", target: anyTarget, view: "inspect", note: "検査画面 — 判定の表と、了解の記録(この緑が検めていないこと)" });
// 実測 overlay の画面。**出荷物ではない** —— 既定の build は overlay を読まない。
if (drill) {
  const s = slugOf(drill.target);
  plan.push({
    file: `overlay-panel-${s}.png`, target: drill.target, view: "system",
    select: drill.element, scrollDetail: true, element: "#detail", overlay: true,
    note: "【出荷物ではない】--overlay-dir で組んだ変種の 12 節 — 実測の状態・rev の照合・言っていないこと(source_limits)",
  });
}

// **何を撮るつもりかは、撮る前に外から確かめられる。** ブラウザも作業木も要らない。
if (argv.includes("--print-plan")) {
  console.log(JSON.stringify({ schema: "system-map/shot-plan/1", shots: plan }, null, 2));
  process.exit(0);
}

// 作業木が汚れたまま撮ると、刻印(HEAD)と画面(未コミットの変更)が食い違う。撮影は拒否する。
// **見る範囲は research/system-map の全体である** —— 以前は prototype/ しか見ておらず、
// 模型や overlay の未コミットの変更が画面を変えても撮れてしまった。
const scope = join(here, "..");
const dirty = execSync("git status --porcelain -- . ':!prototype/shots'", { cwd: scope, encoding: "utf8" }).trim();
if (dirty) {
  console.error("作業木が汚れている(shots/ 以外)。先に commit してから撮ること:\n" + dirty);
  process.exit(1);
}
const rev = execSync("git rev-parse --short HEAD", { cwd: here, encoding: "utf8" }).trim();
const revFull = execSync("git rev-parse HEAD", { cwd: here, encoding: "utf8" }).trim();

mkdirSync(shotsDir, { recursive: true });

// 計画に無い png は、名前を変えた前の走行の置き土産である。**黙って消さない**
// (所有者へ見せる成果物なので、消すのは明示のときだけ)。
const wanted = new Set(plan.map((s) => s.file));
const orphans = readdirSync(shotsDir).filter((n) => n.endsWith(".png") && !wanted.has(n));
if (orphans.length && !argv.includes("--prune")) {
  console.error(
    `計画に無い静止画が ${orphans.length} 枚ある(前の名前で撮った物):\n  ${orphans.join("\n  ")}\n` +
      `消してよいなら --prune を付けるか、次の一行を実行すること:\n` +
      `  git rm ${orphans.map((n) => `research/system-map/prototype/shots/${n}`).join(" ")}`,
  );
  process.exit(1);
}
for (const n of orphans) rmSync(join(shotsDir, n), { force: true });

// playwright は撮るときにだけ要る。上で済む道(--print-plan・汚れ検査)を
// 取り込みの失敗で塞がない(写しの中から計画だけ読めるようにする)。
const { chromium } = await import("playwright");

const takenAt = new Date().toISOString();
const VIEWPORT = { width: 1440, height: 900 };
const url = "file://" + join(here, "index.html");

// overlay を積んだ変種は一時の置き場にだけ出す(出荷物を書き換えない)。
const variantDir = mkdtempSync(join(tmpdir(), "shoot-overlay-"));
const variantUrl = plan.some((s) => s.overlay)
  ? (() => {
    const out = join(variantDir, "index.html");
    execFileSync(process.execPath, [join(here, "build.mjs"), "--out", out, "--overlay-dir", join(here, "..", "overlay")], { cwd: here, stdio: "pipe" });
    return "file://" + out;
  })()
  : null;

const b = await chromium.launch();
const p = await b.newPage({ viewport: VIEWPORT });
await p.goto(url);

for (const s of plan) {
  // 毎回まっさらから組み直す(前の枚の選択やドリルを引きずらない)。
  await p.goto(s.overlay ? variantUrl : url);
  await p.selectOption("#target", s.target);
  await p.locator(`nav button[data-v="${s.view}"]`).click();
  if (s.select) await p.locator(`svg g[data-el="${s.select}"]`).click();
  if (s.drill) await p.locator(`[data-drill="${s.drill}"]`).click();
  if (s.expandAll) {
    for (const d of await p.locator("main details:not([open]) summary, #left details:not([open]) summary").all()) await d.click();
  }
  if (s.scrollDetail) await p.locator("#detail").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  if (s.element) await p.locator(s.element).screenshot({ path: join(shotsDir, s.file) });
  else await p.screenshot({ path: join(shotsDir, s.file), fullPage: true });
  console.log("撮影:", s.file);
}

await b.close();
rmSync(variantDir, { recursive: true, force: true });

writeFileSync(join(shotsDir, "README.md"), `# 静止画(所有者の UIUX 確認用)

撮影時点: commit \`${rev}\` / ${takenAt} / viewport ${VIEWPORT.width}×${VIEWPORT.height}・100%。
刻印は撮影処理が自動生成する(作業木が汚れていると撮影は拒否される)。
**静止画は撮った時点の木でしか正しくない。** 模型や画面を変えたら撮り直す(build.mjs → shoot.mjs)。

撮る枚は模型の一覧から導く(\`registry.json\` の役割 build)。名前は対象の id から作る ——
位置の番号を使わない(並べ替えたときに別の対象を指さないため)。

**【出荷物ではない】と付いた枚は \`--overlay-dir\` で組んだ変種の画面である。**
出荷する \`index.html\` は overlay を同梱しない(build の段は \`--overlay-dir\` を渡さない)ので、
この画面は VSIX では出ない。

issue へ貼るときは **commit を固定した URL** を使う(枝の名前は動く):

    https://raw.githubusercontent.com/Forest-Project-Lab/doctrine-lens/${revFull}/research/system-map/prototype/shots/<ファイル名>

${plan.map((s) => `- \`${s.file}\` — ${s.note}`).join("\n")}
`);
console.log(`完了。${plan.length} 枚 / 撮影時点: ${rev}`);
