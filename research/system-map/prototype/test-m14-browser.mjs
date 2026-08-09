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
import { verdict, reportPathFrom, writeReport, ackFor, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// 対象の一覧と、画面での指し方は registry.json / spec.mjs が正本。ここでは持たない。
const models = loadModels("gates");
const rows = computeOpsRows(models);

let failures = 0;
const failedByTarget = new Map();
const undecidedByTarget = new Map();
/**
 * 判定は三値。
 *   ok         リンクが開き、HTTP でも到達した
 *   NG         リンクが壊れている(HTTP の返す位置づけが 4xx/5xx、または操作数が食い違う)
 *   判定不能   環境が答えられなかった(伝送そのものが失敗し、HTTP の位置づけを得られない)
 *
 * 三つ目を NG に混ぜていたため、**偶発の通信失敗をリンクの破損として報告していた**。
 * 実測: 同じ木で verify 経由の一度だけ全 9 要素が「接続不能」で落ち、単体と再走行では
 * 通った(生ログ decisions/phase-2-baseline/m-layer/logs/RED-transient-network-as-fail.log)。
 * 環境の沈黙を欠陥に変換しない —— 判定不能は不合格だが、破損とは別の事実である。
 */
const report = (state, name, detail = "", target = null) => {
  if (target === null) throw new Error("report に target を渡していない: " + name);
  const line = name + (detail ? " — " + detail : "");
  if (state === "ng") { failures++; failedByTarget.set(target, [...(failedByTarget.get(target) ?? []), line]); }
  if (state === "undecided") undecidedByTarget.set(target, [...(undecidedByTarget.get(target) ?? []), line]);
  console.log(({ ok: "ok   ", ng: "NG   ", undecided: "判定不能 " }[state]) + line);
};

// 判定不能の経路を決定論的に起こす継ぎ目。到達しない代理を挟むと、伝送そのものが
// 成立しなくなる(HTTP の位置づけを一つも得られない)——偶発の通信失敗と同じ形である。
// sleep や運に頼らずに「判定不能」を再現できる。
const FORCE_OFFLINE = process.argv.includes("--force-offline");
const b = await chromium.launch();
const ctx = await b.newContext(FORCE_OFFLINE ? { proxy: { server: "http://127.0.0.1:1" } } : {});
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
  if (missing.length) { report("ng", `${r.target}/${r.element}`, "12 節に無いリンク: " + missing[0], r.target); continue; }
  const href = wantUrls[0];
  const link = p.locator(`#detail a[href="${href}"]`).first();
  const [popup] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
  clicks++;                                                             // 開く
  const opened = popup.url();
  await popup.close();
  let reachBad = null;      // 位置づけを得たうえで壊れていた
  let reachUnknown = null;  // 位置づけを得られなかった(環境)
  for (const u of wantUrls) {
    // 開いただけを成功と呼ばない。429 は「存在するが抑流」なので一度待って再試行し、
    // それでも 429 なら到達扱い(存在の否定ではない)。4xx/5xx は破損。
    // **返す位置づけを一つも得られなかったときは、破損ではなく判定不能である。**
    let res = await ctx.request.get(u).catch(() => null);
    if (res && res.status() === 429) { await new Promise((r) => setTimeout(r, 2500)); res = await ctx.request.get(u).catch(() => null); }
    const st = res ? res.status() : null;
    if (st === null) { reachUnknown = `${u} → 伝送が成立しない(HTTP の位置づけを得られない)`; break; }
    if (!(st < 400 || st === 429)) { reachBad = `${u} → ${st}`; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  // 開いた先が chrome-error なら、それも伝送の失敗であって「別の場所へ開いた」ではない。
  const openedFailed = /^chrome-error:/.test(opened);
  const okOpen = opened === href && /^https?:\/\//.test(opened);
  const okCount = clicks === r.ops && clicks <= 3;
  const detail = `実操作 ${clicks} / 計算 ${r.ops} / 到達先 ${wantUrls.length} 件` +
    (okOpen || openedFailed ? "" : " / 開いた先が不一致: " + opened) +
    (openedFailed ? " / 開けなかった(伝送の失敗): " + opened : "") +
    (reachBad ? " / 到達失敗: " + reachBad : "") +
    (reachUnknown ? " / 到達を判定できない: " + reachUnknown : "");
  // 操作数の食い違いと壊れたリンクは、環境に関わらず欠陥である。先に見る。
  if (!okCount || reachBad || (!okOpen && !openedFailed)) report("ng", `${r.target}/${r.element}`, detail, r.target);
  else if (openedFailed || reachUnknown) report("undecided", `${r.target}/${r.element}`, detail, r.target);
  else report("ok", `${r.target}/${r.element}`, detail, r.target);
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
  report(txt.includes("対象外") ? "ok" : "ng", `NA 表示: ${r.target}/${r.element}`, "", r.target);
}

await b.close();
console.log(failures === 0 ? "\n全件通過(実操作と計算の突合)" : `\n${failures} 件の失敗`);

// 対象ごとの判定の記録。実際にクリックした要素の数が「見た件数」である。
// 到達可能な要素が 0 件の対象は、ここでも VACUOUS になる(束ねて隠さない)。
const today = todayFrom(process.argv.slice(2));
const records = models.map((m) => {
  const mine = rows.filter((r) => r.target === m.target && r.status === "reachable");
  const bad = failedByTarget.get(m.target) ?? [];
  const undecided = undecidedByTarget.get(m.target) ?? [];
  // 欠陥が在れば FAIL。無くて判定不能が在れば SKIP(この走行では判定できなかった)。
  // SKIP は合格ではない —— 了解の記録が無ければ赤である。
  return verdict({
    invariant: "M-14", checker: "browser:ops-count", target: m.target,
    examined: mine.length, examined_unit: "実クリックで測った要素",
    violations: bad.map((n) => ({ code: "gate.ops_mismatch", message: n })),
    skip: bad.length === 0 && undecided.length ? `外部への伝送が成立せず、到達を判定できなかった: ${undecided.join(" / ")}` : null,
  });
});
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "browser-m14", records);
process.exit(gateExitCode(records, today.date));
