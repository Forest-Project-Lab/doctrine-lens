// ラベル衝突の検査 — 全対象・全システム画面(ドリル含む)で、SVG 内の文字同士が
// 視覚的に重ならないことを実ブラウザの実測矩形で確かめる。
//
//   node test-labels-browser.mjs
//
// 負例: SYSTEMMAP_NO_STAGGER=1 で退避を切って build した変種(Celery のレーンで
// 実際に重なる)を検出できること — 検出器が飾りでないことの証明。
// (レビュー指摘 2026-08-04 §4:「Celery 画面をラベル衝突の回帰負例として固定」)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
// 掃引する対象と、画面での指し方は registry.json / spec.mjs が正本。ここでは持たない。
import { targetIds, targetIndex } from "../gold-model/spec.mjs";
import { verdict, reportPathFrom, writeReport, ackFor, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** ドリルの重なりを見る対象。`lens` を内部に持つのはこの対象だけである。 */
const DRILL_TARGET = "doctrine-and-lens";
let failures = 0;
const failed = [];
const report = (ok, name, detail = "") => {
  if (!ok) { failures++; failed.push(name + (detail ? " — " + detail : "")); }
  console.log((ok ? "ok   " : "NG   ") + name + (detail ? " — " + detail : ""));
};

const b = await chromium.launch();

/** ページ内の svg text の実測矩形を集め、重なる組を返す(2px の許容)。 */
async function collectOverlaps(p) {
  return p.evaluate(() => {
    const rects = [...document.querySelectorAll("svg text")].map((t) => {
      const r = t.getBoundingClientRect();
      return { text: t.textContent.trim().slice(0, 24), x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
    });
    const out = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], c = rects[j];
        const w = Math.min(a.x2, c.x2) - Math.max(a.x1, c.x1);
        const h = Math.min(a.y2, c.y2) - Math.max(a.y1, c.y1);
        if (w > 2 && h > 2) out.push(a.text + " × " + c.text);
      }
    }
    return out;
  });
}

/** 指定 html の全対象+対象1ドリルで重なりを数える。 */
async function sweep(htmlPath) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("pageerror", (e) => { throw new Error("pageerror: " + e.message); });
  await p.goto("file://" + htmlPath);
  const found = [];
  // 掃引する対象は registry.json が正本。増やせばここも自動で増える。
  for (const id of targetIds("labels")) {
    await p.selectOption("#target", targetIndex(id));
    const ov = await collectOverlaps(p);
    if (ov.length) found.push(`対象 ${id}: ${ov[0]}(計 ${ov.length} 組)`);
  }
  await p.selectOption("#target", targetIndex(DRILL_TARGET));
  await p.locator('[data-drill="lens"]').click();
  const ovd = await collectOverlaps(p);
  if (ovd.length) found.push(`対象 ${DRILL_TARGET} のドリル: ${ovd[0]}(計 ${ovd.length} 組)`);
  await p.close();
  return found;
}

// ---- 正: 現物に重なりが無い ----
{
  const found = await sweep(join(here, "index.html"));
  report(found.length === 0, "正: 全対象・ドリル含めラベルの重なりなし", found[0]);
}

// ---- 負: 退避を切った変種(Celery レーンが重なる)を検出する ----
{
  const tmp = mkdtempSync(join(tmpdir(), "labels-"));
  execFileSync("node", [join(here, "build.mjs")], { cwd: here, env: { ...process.env, SYSTEMMAP_NO_STAGGER: "1" }, stdio: "pipe" });
  copyFileSync(join(here, "index.html"), join(tmp, "no-stagger.html"));
  execFileSync("node", [join(here, "build.mjs")], { cwd: here, stdio: "pipe" }); // 本番状態へ戻す
  const found = await sweep(join(tmp, "no-stagger.html"));
  report(found.length > 0, "負: 退避を切った変種の重なりが検出される(回帰負例=Celery)", found.length === 0 ? "検出されず(飾りの検出器)" : found[0]);
}

await b.close();
console.log(failures === 0 ? "\n全件通過(正 1・負 1)" : `\n${failures} 件の失敗`);

// 判定の記録。見た件数は掃引した画面の数(全対象 + ドリル 1)。
const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-L1", checker: "browser:label-no-overlap", target: "index.html",
  examined: targetIds("labels").length + 1, examined_unit: "掃引した画面",
  violations: failed.map((n) => ({ code: "gate.label_overlap", message: n })),
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "browser-labels", records);
process.exit(gateExitCode(records, today.date));
