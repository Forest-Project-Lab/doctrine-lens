// M-13 の実ブラウザ検査 — 「実行時の外部読み込み零」と「列挙した全操作の成立」を、
// 操作単位の assert で確かめる。
//
//   node test-m13-browser.mjs
//
// 方針(レビュー指摘 2026-08-04 §3 の反映):
// - 操作の失敗を握り潰さない(catch(() => {}) を置かない)。失敗はその場でこの検査を落とす。
// - 各対象への切替直後に、対象固有の目的文を assert する。
// - 各画面への切替直後に、画面固有の一問を assert する。
// - 要素選択直後に、詳細パネルの見出しが選択要素と一致することを assert する。
// - ドリルダウン直後に、親・現在位置(パンくず)・子要素を assert する。
// - 以上をオンラインとオフラインの両方で同一に実施する。
// - 外部リクエストは操作単位で記録し、全操作を通じて 0 件であることを assert する。
// 負: 外部資源を仕込んだ変種で、外部リクエストの試行が検出される。
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadModels, targetIndex } from "../gold-model/spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "index.html");
// 対象の一覧は registry.json が正本。ここでは持たない。
const models = loadModels("gates");

let failures = 0;
const report = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "ok   " : "NG   ") + name + (detail ? " — " + detail : ""));
};

const VIEW_QUESTION = {
  system: "何のために存在し",
  scenario: "誰が何を行い",
  assurance: "証拠付きで確認され",
  impact: "どの順番で修正",
  inspect: "受け持つ検査は通っているか",
};

const b = await chromium.launch();

/** 全操作を、操作単位の assert と外部リクエスト計数つきで実施する。失敗は throw。 */
async function sweep(url, { offline = false } = {}) {
  const ctx = await b.newContext();
  await ctx.route("**", (route) => {
    const u = route.request().url();
    if (u.startsWith("file:")) route.continue();
    else route.abort();
  });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  const externalByStep = [];
  let external = [];
  p.on("request", (r) => { if (!r.url().startsWith("file:")) external.push(r.url()); });
  p.on("pageerror", (e) => { throw new Error("pageerror: " + e.message); });
  const step = async (name, fn) => {
    external = [];
    await fn();
    externalByStep.push({ step: name, external: external.length });
    if (external.length > 0) throw new Error(`操作「${name}」で外部リクエスト: ${external[0]}`);
  };
  const expectText = async (locator, needle, what) => {
    const t = await p.locator(locator).first().textContent({ timeout: 5000 });
    if (!t || !t.includes(needle)) throw new Error(`${what}: 「${needle}」が見えない(実際: ${String(t).slice(0, 60)})`);
  };

  if (offline) await ctx.setOffline(true);
  await step("起動", async () => {
    await p.goto(url, { waitUntil: "load" });
    await expectText(".q", VIEW_QUESTION.system, "起動直後の一問");
  });

  // 各対象への切替: 対象固有の目的文が出る
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    await step(`対象切替 ${m.target}`, async () => {
      await p.selectOption("#target", targetIndex(m.target));
      const purposeHead = m.system.purpose.slice(0, 12);
      await expectText("#left", purposeHead, `対象 ${m.target} の目的`);
      const boxes = await p.locator("svg g[data-el]").count();
      const tops = m.elements.filter((e) => (e.parent ?? null) === null).length;
      if (boxes !== tops) throw new Error(`対象 ${m.target} の箱数 ${boxes} ≠ 最上位 ${tops}`);
    });
  }

  // 対象1で: 要素選択 → パネル一致、ドリル → 親・現在位置・子、復帰
  await step("対象1へ戻す", async () => {
    await p.selectOption("#target", targetIndex(models[0].target));
    await expectText("#left", models[0].system.purpose.slice(0, 12), "対象1の目的");
  });
  await step("要素選択(lens)", async () => {
    await p.locator('svg g[data-el="lens"]').click();
    await expectText("#detail h2", "doctrine-lens(帰結の画面)", "詳細パネルの見出し");
    const sections = await p.locator("#detail h3").count();
    if (sections !== 12) throw new Error(`12 節でない: ${sections}`);
  });
  await step("ドリルダウン(lens 内部)", async () => {
    await p.locator('[data-drill="lens"]').click();
    await expectText(".crumb", "doctrine-lens(帰結の画面) の内部", "現在位置(パンくず)");
    await expectText(".parentline", "親の目的", "親の目的の常示");
    for (const cid of ["lens.bridge", "lens.model", "lens.view"]) {
      if ((await p.locator(`svg g[data-el="${cid}"]`).count()) !== 1) throw new Error(`子要素 ${cid} が見えない`);
    }
  });
  await step("子要素選択(lens.model)", async () => {
    await p.locator('svg g[data-el="lens.model"]').click();
    await expectText("#detail h2", "帰結の模型", "子要素の詳細パネル");
  });
  await step("復帰(up)", async () => {
    await p.locator("#up").click();
    if ((await p.locator('svg g[data-el="maintainer"]').count()) !== 1) throw new Error("最上位へ戻っていない");
  });

  // 各画面への切替: 画面固有の一問が出る
  for (const v of ["scenario", "assurance", "impact", "inspect"]) {
    await step(`画面切替 ${v}`, async () => {
      await p.locator(`nav button[data-v="${v}"]`).click();
      await expectText(".q", VIEW_QUESTION[v], `画面 ${v} の一問`);
    });
  }
  await step("検査画面の表", async () => {
    const rows = await p.locator("#left table tr").count();
    if (rows <= 20) throw new Error(`検査表の行数が少なすぎる: ${rows}`);
  });

  await ctx.close();
  return externalByStep;
}

// ---- 正: オンライン(全操作成立+外部 0 件/操作単位) ----
try {
  const steps = await sweep("file://" + indexPath);
  report(true, `正: オンラインで全 ${steps.length} 操作が成立・各操作の外部リクエスト 0 件`);
} catch (e) {
  report(false, "正: オンラインの操作成立", e.message);
}

// ---- 正: オフライン(同一 assert) ----
try {
  const steps = await sweep("file://" + indexPath, { offline: true });
  report(true, `正: オフラインでも同一の全 ${steps.length} 操作が成立・外部 0 件`);
} catch (e) {
  report(false, "正: オフラインの操作成立", e.message);
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
  const ctx = await b.newContext();
  await ctx.route("**", (route) => route.request().url().startsWith("file:") ? route.continue() : route.abort());
  const p = await ctx.newPage();
  const external = [];
  p.on("request", (r) => { if (!r.url().startsWith("file:")) external.push(r.url()); });
  await p.goto("file://" + f, { waitUntil: "load" }).catch(() => {});
  await p.waitForTimeout(400);
  await ctx.close();
  report(external.length > 0, `負: 外部 ${name} の仕込みが検出される`, external.length === 0 ? "検出されず(飾りの門)" : "");
}

await b.close();
console.log(failures === 0 ? "\n全件通過(正 2・負 5)" : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
