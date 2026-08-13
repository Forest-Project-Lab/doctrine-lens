// 静的プロトタイプの組み立て器(Phase 1)。
//
//   node build.mjs   →  index.html を生成
//
// システム画面は構成図(所有者判断 2026-08-04 で採用。DESIGN-001)。
// 配置は意味からだけ導く(層 = Flow 方向の最長距離)。辺は正本の Flow と一対一。
// 旧地図の失敗要因(無意味な軸・同一事実の二重描画)は持ち込まない。
//
// 可読性の規律(所有者指示 2026-08-04 §4):
// - 1440×900・100% で主要情報が読める。本文の最小文字は 14px。
// - カードの常時表示は 名称・目的1文・主要 IN/OUT・保証状態の要約 まで。
// - proposed などの管理情報は上部に一度だけ。
// - 選択時は右側の詳細パネル(図を消さない・押し出さない)。12 節の固定順。
// - ドリルダウン中も親の目的・境界・現在位置を保ち、戻りで配置と選択を復元する。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeOpsRows, reachabilityVerdicts, checkNoRuntimeFetch } from "./gates.mjs";
// 生成の途中で殺されても、切れた出荷物を残さない。
import { writeAtomic, sweepStale } from "../lib/atomic-write.mjs";
import {
  loadModels, targetIds, TARGETS, MAX_OPS, STATUS_DISPLAY_ORDER,
  OVERLAY_SCHEMA_ID, OVERLAY_STATUSES, OVERLAY_EMPTY_STATUS, OVERLAY_CANDIDATE, DISPLAY,
} from "../gold-model/spec.mjs";
import { ACKNOWLEDGEMENTS } from "../gold-model/report.mjs";
import { verdict, reportPathFrom, writeReport, formatRecord, ackFor, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// 入力は引数で受ける。環境変数を生成物へ焼き込むと、同じ原資から違う物が commit
// されうる(以前は NO_STAGGER と SYSTEMMAP_WITH_OVERLAY がそうだった)。
const argv = process.argv.slice(2);
const argFlag = (n) => argv.includes(n);
const argOne = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const outPath = argOne("--out") ? resolve(argOne("--out")) : join(here, "index.html");
const shipped = join(here, "index.html");
const noStagger = argFlag("--no-stagger");
const overlayDir = argOne("--overlay-dir");
// 退避を切った変種は**負の例**であり、出荷される物ではない。commit 済みの置き場へは書かせない。
if (noStagger && outPath === shipped) {
  console.error("--no-stagger は負の例を作る。--out で別の置き場を指すこと(出荷物を書き換えない)。");
  process.exit(2);
}
// overlay 付きの build も同じである。既定の Phase 1 成果物と Phase 2 の予習データの
// 境界を混ぜない(レビュー指摘 2026-08-04 §5)。**守りが無いと、手元で一度回しただけで
// 出荷物が別物になり、CI の差分検査が後から気付くだけになる。**
if (overlayDir && outPath === shipped) {
  console.error(
    "overlay-would-overwrite-shipped: --overlay-dir を付けた build は Phase 2 の予習データを含む。" +
      "--out で別の置き場を指すこと(出荷物を書き換えない)。",
  );
  process.exit(2);
}

// 対象の一覧と並びは registry.json が正本。並びが画面の並びになる。
const models = loadModels("build");
const reportPath = reportPathFrom(argv);
const today = todayFrom(argv);
const records = [];

// ---- M-14 の機械判定(build 時) ----
// 判定器は gates.mjs。発火することは test-gates.mjs の負の試験が確かめる。
// 操作数の上限は台帳 v3.2-16(registry.json の policy.max_ops)。
//
// **対象ごとに判ずる。** 四対象を束ねて数えると、到達可能な要素が 0 件の対象が
// 隠れる(実測: celery と fixture)。束ねた最大操作数だけを見ていると緑に見える。
const m14 = computeOpsRows(models);
for (const r of reachabilityVerdicts(models, MAX_OPS)) {
  records.push(verdict({
    invariant: "M-14", checker: "build:reachability", target: r.target,
    examined: r.examined, examined_unit: "到達可能な要素", violations: r.violations,
  }));
}
const reachableAll = m14.filter((r) => r.status === "reachable");
const m14max = reachableAll.length ? Math.max(...reachableAll.map((r) => r.ops)) : null;

// ---- 実データ overlay(Phase 2 予習) ----
// 既定の Phase 1 build は overlay を読まない(Phase 1 成果物と Phase 2 予習データの境界を
// 混ぜない — レビュー指摘 2026-08-04 §5)。`--overlay-dir` を明示した build だけが読む。
//
// **索く鍵は各ファイルが自分で宣言した `target` である。** 以前は生成側の付けた名前を
// 決め打ちで開いていたので、対象を増やしても読まれない overlay が黙って出た。
// 壊れた入力は**硬く落とす**。「飛ばして続行」にすると、画面は「実測が無い」と
// 「実測を読めなかった」を同じ空白で出すことになる。
const overlayFail = (code, msg) => { console.error(`${code}: ${msg}`); process.exit(2); };

function loadOverlays(dir) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    overlayFail("overlay-dir-missing", `--overlay-dir が指す置き場が無い: ${abs}`);
  }
  const known = new Set(targetIds("build"));
  const seen = new Map();
  // 並びを固定する(同じ入力から同じ byte を出すため)。
  for (const name of readdirSync(abs).filter((n) => n.endsWith(".json")).sort()) {
    const p = join(abs, name);
    let o;
    try {
      o = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      overlayFail("overlay-corrupt", `${name} を JSON として読めない — ${e.message}`);
    }
    if (o?.schema !== OVERLAY_SCHEMA_ID) {
      overlayFail("overlay-schema-unknown", `${name} の形が ${OVERLAY_SCHEMA_ID} でない: ${o?.schema}`);
    }
    if (!o.target || !known.has(o.target)) {
      overlayFail("overlay-unknown-target", `${name} が名乗る対象 ${o.target} は画面に載る対象の一覧に無い`);
    }
    if (seen.has(o.target)) {
      overlayFail("overlay-duplicate-target", `対象 ${o.target} を ${seen.get(o.target).file} と ${name} の二つが名乗っている`);
    }
    if (!OVERLAY_STATUSES.includes(o.status)) {
      overlayFail("overlay-status-unknown", `${name} の状態 ${o.status} が語彙(${OVERLAY_STATUSES.join("/")})に無い`);
    }
    // 生成側でも同じことを検めている。**片側だけでは、もう片側の欠陥に気付けない。**
    const n = (o.entries ?? []).length;
    if ((n === 0) !== (o.status === OVERLAY_EMPTY_STATUS)) {
      overlayFail("overlay-vacuous", `${name} は状態 ${o.status} で記録 ${n} 件。記録 0 件と ${OVERLAY_EMPTY_STATUS} は一対一で対応する`);
    }
    seen.set(o.target, { file: name, data: o });
  }
  if (!seen.size) overlayFail("overlay-empty-dir", `--overlay-dir に overlay が一つも無い: ${abs}`);
  return Object.fromEntries([...seen].map(([k, v]) => [k, v.data]));
}

const overlays = overlayDir ? loadOverlays(overlayDir) : {};
if (overlayDir) {
  console.log(`Phase 2 build: overlay を同梱する(明示の指定) — 対象 ${Object.keys(overlays).join(", ")}`);
}

/** 生成時に埋める字。実行時に一覧を組み立てない(組み立てると外から数えられない)。 */
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const OPTIONS = models.map((m) => `<option value="${escHtml(m.target)}">${escHtml(m.target)}</option>`).join("");

/** 架空の対象は、画面が架空と言う。registry の `fictional` を初めて荷重にする。 */
const FICTIONAL = Object.fromEntries(
  TARGETS.filter((t) => t.fictional).map((t) => [t.id, "この対象は【架空】である。実在の成果物・実在の契約・実在の証拠を一つも指さない。希少な状態(検証予定・不合格・証拠が古い)の読み分けを練習するためだけに置いてある。**ここに出る保証・証拠・アンカーを、実在の何かの根拠として引かないこと。**"]),
);

/** 了解の記録 —— 「この緑は何を検めていないか」。画面にも出す。 */
const ACKS = ACKNOWLEDGEMENTS.map((a) => ({
  invariant: a.invariant, target: a.target, verdict: a.verdict,
  reason: a.reason, checked_at: a.checked_at, expires_at: a.expires_at,
}));

const DATA = JSON.stringify(models);
const M14 = JSON.stringify({ rows: m14, max: m14max });

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>system-map 静的プロトタイプ(Phase 1・候補)</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; color: #222; background: #fff; margin: 0; font-size: 15px; }
  .banner { background: #fff3cd; padding: .35rem 1rem; font-size: 14px; }
  header { display: flex; align-items: center; gap: .5rem; padding: .5rem 1rem; border-bottom: 2px solid #ccc; flex-wrap: wrap; }
  nav button { padding: .35rem .9rem; font-size: 15px; cursor: pointer; }
  nav button[aria-pressed="true"] { font-weight: 700; border: 2px solid #222; }
  select { font-size: 15px; padding: .2rem; }
  .wrap { display: flex; gap: 1rem; align-items: flex-start; padding: .8rem 1rem; }
  #left { flex: 1 1 auto; min-width: 0; }
  #detail { flex: 0 0 30rem; max-width: 30rem; border: 2px solid #222; position: sticky; top: .5rem;
            max-height: calc(100vh - 1.5rem); overflow-y: auto; padding: .7rem .9rem; background: #fff; }
  #detail h2 { margin: 0 0 .2rem; font-size: 17px; padding-right: 1.6rem; }
  #detail h3 { margin: .7rem 0 .2rem; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: .1rem; }
  #detail ul { margin: .2rem 0; padding-left: 1.2rem; }
  #detail li, #detail p, #detail td { font-size: 14px; }
  #close { position: absolute; top: .3rem; right: .4rem; font-size: 16px; cursor: pointer; border: 1px solid #999; background: #fff; }
  .q { color: #555; font-size: 14px; margin: .2rem 0 .5rem; }
  .crumb { font-size: 14px; margin-bottom: .3rem; }
  .crumb a { cursor: pointer; text-decoration: underline; }
  .parentline { font-size: 14px; color: #555; margin-bottom: .5rem; }
  table { border-collapse: collapse; width: 100%; margin: .4rem 0 .8rem; font-size: 14px; }
  th, td { border: 1px solid #ccc; padding: .3rem .5rem; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  .st { display: inline-block; padding: 0 .35rem; border: 1px solid #222; font-size: 13px; }
  .st-unknown { background: #eee; } .st-claimed { background: #fff; } .st-planned { background: #e8ecff; }
  .st-verified { background: #dff2df; } .st-failed { background: #f8d7da; } .st-stale { background: #ffe8cc; }
  .st-not_applicable { background: #f0f0f0; color: #666; }
  .small { font-size: 13px; color: #555; }
  /* 区別は**語**が担う。罫線と色は同じことを形でも示す補助にすぎない
     (色だけに頼ると単色印刷・色覚・静止画で消える)。 */
  .rv { font-size: 12px; border: 1px solid #222; padding: 0 .2rem; white-space: nowrap; }
  .rv-missing { border-style: dashed; }
  .tag { font-size: 12px; border: 1px solid #666; padding: 0 .25rem; display: inline-block; }
  .limits { border-left: 4px solid #222; padding: .3rem .5rem; margin: .35rem 0; font-size: 13px; background: #fafafa; }
  .bad { border-left: 3px solid #8a6d3b; padding-left: .4rem; }
  .fict { background: #fff3cd; border: 2px solid #8a6d3b; padding: .4rem 1rem; font-size: 14px; }
  .neg { color: #8a6d3b; }
  .ov { border-left: 3px solid #999; padding-left: .4rem; margin: .25rem 0; }
  .ov-absent, .ov-none { border-left-style: dotted; }
  .legend { font-size: 14px; color: #555; margin-top: .3rem; }
  .opcount { position: fixed; right: .8rem; bottom: .8rem; background: #f4f4f4; border: 1px solid #ccc; padding: .25rem .6rem; font-size: 13px; }
  footer { padding: .6rem 1rem; border-top: 1px solid #ccc; font-size: 13px; color: #666; }
  a { color: #0b57a4; }
</style>
</head>
<body>
<div class="banner" id="banner"></div>
<div class="fict" id="fict" hidden></div>
<header>
  <label>対象: <select id="target">${OPTIONS}</select></label>
  <nav>
    <button data-v="system" aria-pressed="true">システム</button>
    <button data-v="scenario" aria-pressed="false">シナリオ</button>
    <button data-v="assurance" aria-pressed="false">保証</button>
    <button data-v="impact" aria-pressed="false">変更影響</button>
    <button data-v="inspect" aria-pressed="false">検査(M 層)</button>
  </nav>
</header>
<div class="wrap">
  <section id="left"></section>
  <aside id="detail" hidden></aside>
</div>
<div class="opcount">操作数: <span id="ops">0</span> <button id="opreset">0 に戻す</button></div>
<footer>
  一画面一問(台帳 v3.2-6)。対象の切替と画面の移動は「別の問いへ行く」操作。1操作 = 明示的な起動を各 1(台帳 v3.2-16。スクロール・ホバーは数えない)。
</footer>
<script>
const MODELS = ${DATA};
const M14 = ${M14};
const D = ${JSON.stringify(DISPLAY)};
const CAND = ${JSON.stringify(OVERLAY_CANDIDATE)};
const FICTIONAL = ${JSON.stringify(FICTIONAL)};
const ACKS = ${JSON.stringify(ACKS)};
const OVERLAYS = ${JSON.stringify(overlays)};
const OVERLAY_READ = ${overlayDir ? "true" : "false"}; // この build が overlay を読んだか
const OVERLAY_EMPTY = ${JSON.stringify(OVERLAY_EMPTY_STATUS)};
const NO_STAGGER = ${noStagger ? "true" : "false"}; // 試験専用(重なり検出の負例)
let view = "system", focusEl = null, drill = null;
const drillStack = [];
let ops = 0;
const bump = () => { ops++; document.getElementById("ops").textContent = ops; };
document.getElementById("opreset").onclick = () => { ops = 0; document.getElementById("ops").textContent = 0; };

// 対象は **id で指す。** 一覧は生成時に埋まっている(実行時に組み立てない)。
const tsel = document.getElementById("target");
let tid = tsel.value;
tsel.onchange = () => { tid = tsel.value; focusEl = null; drill = null; drillStack.length = 0; bump(); render(); };
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  view = b.dataset.v; focusEl = null; drill = null; drillStack.length = 0; bump();
  document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 知らない id で黙って別の対象を描かない。落ちるなら大きな音で落ちる
// (ブラウザ試験は pageerror を失敗として拾う)。
const M = () => {
  const m = MODELS.find((x) => x.target === tid);
  if (!m) throw new Error("知らない対象: " + tid);
  return m;
};
const el = (id) => M().elements.find((e) => e.id === id);
const anchor = (id) => (M().anchors ?? []).find((a) => a.id === id);
// ---- 表示の語(正本は registry.json の policy.display) ----
// **引きは全て「表に無ければ未知」へ落とす。** 未知の語を既知の語へ黙って寄せると、
// 画面は機械が確かめていないことを言い出す(実測: rev_state の三値目が「同一」として出ていた)。
const look = (table, token) => {
  const d = (D[table] ?? {})[token];
  if (d) return d;
  return { ...D.unknown_token, mark: D.unknown_token.mark + ": " + String(token), __unknown: true };
};
// 状態は**語**で言う。生の字句も残す(報告と追跡のため)が、意味を運ぶのは語である。
const stBadge = (s) => {
  const d = look("verification_status", s);
  return '<span class="st st-' + esc(s) + '" title="' + esc(d.sentence ?? "") + '">［' + esc(d.mark) + "］" + esc(s) + "</span>";
};
// 候補と確認済も語で分ける。**記録が無いことも語で言う** —— 空白は「確認済」と読まれる。
const rev = (x) => {
  const s = x?.review_status;
  if (!s) return '<span class="rv rv-missing">［確認状態の記録なし］</span>';
  const d = look("review_status", s);
  return '<span class="rv rv-' + esc(s) + '" data-review="' + esc(s) + '" title="' + esc(d.sentence ?? "") + '">［' + esc(d.mark) + "］</span>";
};
const shortRev = (s) => (s ? String(s).slice(0, 7) : "記録なし");
const firstSentence = (s) => { const t = String(s ?? ""); const i = t.indexOf("。"); return i >= 0 ? t.slice(0, i + 1) : t; };

function provRows(ps) {
  return (ps ?? []).map((p) =>
    "<div class='small " + (p.verdict === "silent" ? "neg" : "") + "'>" +
    (p.verdict === "silent" ? "負の出所(確認したが沈黙): " : "出所: ") +
    esc(p.source) + (p.locator ? " — " + esc(p.locator) : "") + "(" + esc(p.checked_at) + ")</div>").join("");
}

function evRows(evs) {
  if (!evs || !evs.length) return "<div class='small'>証拠: 無し</div>";
  return evs.map((e) => {
    const ref = /^https?:/.test(e.ref) ? '<a href="' + esc(e.ref) + '" target="_blank">' + esc(e.ref) + "</a>" : esc(e.ref);
    return "<div class='small'>証拠: " + ref + " / 環境 " + esc(e.environment) +
      " / 版 " + esc(e.version) + " / 終了 " + esc(e.exit_status) + " / 観測 " + esc(e.observed_at) +
      (e.fingerprint ? " / 指紋 " + esc(e.fingerprint) : "") + "</div>";
  }).join("");
}

// 実測 overlay(Phase 2 予習)— 宣言済み CLI が build 時に返した値。proposed のモデル値と混ぜず出所を明記。
//
// **無いことを空白で言わない。** 以前は三つの別々の事実が、どれも空文字列になっていた:
//   (1) この build は overlay を読んでいない
//   (2) 読んだが、この対象の overlay が無い
//   (3) 在るが、この要素に該当する注釈対が 0 件だった
// 空白は「問題が無い」と読まれる。三つを別々の文で言う。
/** この対象の実測 overlay。読んでいない/未生成/在る の三つを呼び手が分けられる形で返す。 */
const overlayFor = () => {
  if (!OVERLAY_READ) return { state: "not-read" };
  const o = OVERLAYS[M().target];
  return o ? { state: "present", o } : { state: "absent" };
};

/**
 * 実測の頭書き。**言っていないことを、言っていることの隣に置く。**
 *
 * 以前は「実測」「事実」「指紋」だけが画面に出て、上流が自ら書いた射程の限界
 * (source_limits)はどこからも読まれていなかった。総括と作業木の状態も同じである。
 */
function overlayHeader() {
  const ov = overlayFor();
  if (ov.state === "not-read") return "";
  if (ov.state === "absent") {
    return '<div class="limits" data-ov="__absent">実測 overlay: <b>この対象は未生成である</b>' +
      "(測って何も無かったのではなく、測っていない)。</div>";
  }
  const o = ov.o;
  if (o.status === OVERLAY_EMPTY) {
    return '<div class="limits" data-ov="__empty">実測 overlay: <b>測る対象が 0 件である</b>' +
      (o.reason ? " — " + esc(o.reason) : "") + "</div>";
  }
  // 総括の語彙はアンカーの状態の部分集合である(no-candidates は上で分岐済み)。
  const roll = look("overlay_status_entry", o.status);
  const wt = (v, yes, no) => (v === true ? yes : v === false ? no : "不明");
  return '<div class="limits" data-ov-header="' + esc(o.status) + '">' +
    "<b>実測 overlay の出所</b> " + esc(o.source) + "<br>" +
    "生成した rev " + esc(shortRev(o.generated_from_rev)) +
    " / 生成した日 " + esc(o.generated_at ?? "—") +
    "(" + esc(o.generated_at_source ?? "日付の出所の記録なし") + ")<br>" +
    // **どの版の道具が測ったか**も出所である。道具が自分で名乗る(上流 0.12.0)。
    "測った道具 " + esc(o.generator ? o.generator.name + " " + o.generator.version : "道具が自分の版を名乗らなかった") + "<br>" +
    "この overlay 全体の状態 <b>［" + esc(roll.mark) + "］" + esc(o.status) + "</b>" +
    " / 作業木 " + esc(wt(o.worktree?.dirty, "汚れていた", "清かった")) +
    "・" + esc(wt(o.worktree?.shallow, "浅い複製", "完全な複製")) + "<br>" +
    "<b>この実測が言っていないこと</b> " +
    esc(o.source_limits ?? "この overlay は自らの限界を記録していない。何を言っていないかが分からないので、ここに出せることも分からない。") +
    "</div>";
}

/**
 * アンカー一件についての実測の行。
 *
 * **六状態すべてに行を出す。** 出さないと「測って何も無かった」「測っていない」
 * 「そもそも走査の射程外」が同じ空白になる。空白は「問題が無い」と読まれる。
 */
function overlayLineFor(anchorId) {
  const ov = overlayFor();
  if (ov.state !== "present") return "";
  const o = ov.o;
  if (o.status === OVERLAY_EMPTY) return "";
  const x = (o.entries ?? []).find((y) => y.anchor_id === anchorId);
  if (!x) {
    return '<div class="small ov ov-none" data-ov="__out-of-scope">［実測の対象外］' +
      "この実現先は overlay に記録が無い(上流の走査は権威 " + esc(CAND.authority) +
      " の " + esc(look("anchor_kind", CAND.target_kind).mark) + "だけを見る)。測って何も無かったのではなく、<b>測っていない</b>。</div>";
  }
  const d = look("overlay_status_entry", x.status);
  const r = look("rev_state", x.rev_state);
  const ranges = d.has_ranges === true
    ? (x.ranges_now ?? []).map((g) =>
      "<div class='small' data-range='" + esc(g.id) + "'>注釈対 " + esc(g.id) + " が " + esc(x.path) +
      " L" + g.begin_line + "–L" + g.end_line +
      "・指紋 " + esc(String(g.fingerprint).slice(0, 19)) + "…</div>").join("")
    : "";
  return '<div class="small ov ov-' + esc(x.status) + '" data-ov="' + esc(x.status) + '">' +
    "<b>［" + esc(d.mark) + "］</b>" + esc(d.sentence ?? "") +
    (x.reason ? " — " + esc(x.reason) : "") +
    "<div class='small' data-rev='" + esc(x.rev_state) + "'>記録時 rev " + esc(shortRev(x.recorded_rev)) +
    " / 観測した rev " + esc(shortRev(x.current_rev)) + " / " + esc(r.mark) + "</div>" +
    ranges + "</div>";
}

/**
 * 12 節の実現と証拠。**判定器が出した行を写す。画面は判定をやり直さない。**
 *
 * 以前はここが「アンカーが実在するか」しか見ておらず、門が実現先と認めない種別を、開けるリンク
 * として出していた —— 画面の方が門より緩かった。門が認めなかった先は字では残すが、
 * リンクにはしない(人が確かめに行けなくなるのは、別の不正直である)。
 */
function realizationBlock(e) {
  const row = (M14.rows ?? []).find((x) => x.target === M().target && x.element === e.id);
  if (!row) {
    return '<p class="small">この要素についての到達判定が生成物に無い(画面の欠落であって「到達不能」ではない)。</p>';
  }
  const d = look("reachability_status", row.status);
  const head = '<p><span class="tag" data-reach="' + esc(row.status) + '">［' + esc(d.mark) + "］</span> " +
    esc(d.sentence ?? "") + (row.note ? " — " + esc(row.note) : "") + "</p>";
  const list = (row.anchors ?? []).map(anchorLine).join("");
  return overlayHeader() + head + (list ? "<ul>" + list + "</ul>" : "");
}

function anchorLine(a) {
  const v = look("anchor_verdict", a.verdict);
  // アンカーの中身は模型が正本。判定の行は id しか持たない(同じ事実を二箇所に置かない)。
  const src = anchor(a.id);
  const kind = src?.target_kind ? look("anchor_kind", src.target_kind) : null;
  const tag = kind ? '<span class="tag">［' + esc(kind.mark) + "］</span> " : "";
  const meta = src
    ? '<div class="small">記録した rev ' + esc(shortRev(src.source_revision)) +
      " / 記録した日 " + esc(src.observed_at ?? "記録なし") +
      " / 鮮度の権威 " + esc(src.authority ?? "記録なし") +
      (src.expires_at ? " / 期限 " + esc(src.expires_at) : "") + "</div>"
    : '<div class="small">この id を持つアンカーが模型に無い(' + esc(a.id) + ")</div>";
  if (v.links === true && src?.url) {
    return '<li data-av="' + esc(a.verdict) + '">' + tag +
      '<a href="' + esc(src.url) + '" target="_blank">' + esc(src.target) + "</a>" +
      meta + overlayLineFor(a.id) + "</li>";
  }
  return '<li class="bad" data-av="' + esc(a.verdict) + '"><b>［' + esc(v.mark) + "］</b> " + esc(a.reason ?? "") +
    (src?.url ? '<div class="small">参照(実現先ではない): ' + esc(src.url) + "</div>" : "") +
    meta + overlayLineFor(a.id) + "</li>";
}

/**
 * 帯は **データから作る。**
 *
 * 文字で書いておくと、一件が確認済になった日に帯だけが嘘になり、誰も気付かない。
 * 混ざったときの文は、M-07b の検査器の文言と一致させる —— 画面と門が同じことを言う。
 */
function banner() {
  const m = M();
  const all = [m.system, ...(m.elements ?? []), ...(m.flows ?? []), ...(m.contracts ?? []), ...(m.scenarios ?? [])].filter(Boolean);
  const n = {};
  for (const x of all) { const k = x.review_status ?? "(記録なし)"; n[k] = (n[k] ?? 0) + 1; }
  const kinds = Object.keys(n);
  if (kinds.length === 1 && kinds[0] === "proposed") {
    return "この対象の全 " + all.length + " 件は" + esc(look("review_status", "proposed").mark) +
      "(proposed)であり正本表示ではない — この注記が全項に適用される。正本は issue 204 の合意台帳と各値の出所。";
  }
  return "この対象は " + kinds.map((k) => esc(look("review_status", k).mark ?? k) + " " + n[k] + " 件").join(" / ") +
    " が混在する。<b>確認済だけを写した正本表示(canonical projection)は実装されていない</b> —— " +
    "この画面は正本表示ではなく、混入の有無を機械で検めることもできていない(M-07b)。";
}

// 詳細パネル — 12 節の固定順(所有者指示 §4)
function detailPanel(id) {
  const e = el(id);
  const cs = M().contracts.filter((c) => c.subject === id);
  const flowsIn = M().flows.filter((f) => f.to === id);
  const flowsOut = M().flows.filter((f) => f.from === id);
  const fbFlows = M().flows.filter((f) => f.feedback_for && (f.from === id || f.to === id));
  const assumptions = cs.flatMap((c) => c.assumptions.map((a) => ({ a, cid: c.id })));
  const failures = cs.filter((c) => c.failure_effect);
  const flowRow = (f, dir) => \`<tr><td>\${dir}\${f.feedback_for ? " ↩" : ""}</td><td>\${esc(el(dir === "IN" ? f.from : f.to).name)}</td><td>\${esc(f.label)}(\${esc(f.kind)})</td><td class="small">\${esc(f.condition)}</td></tr>\`;
  const none = '<p class="small">記録なし</p>';
  const evidenceLinks = cs.flatMap((c) => (c.evidence ?? []).map((ev) => ({ c, ev })));
  return \`<button id="close" title="閉じる">×</button>
    <h2>\${esc(e.name)} \${rev(e)}</h2>
    <div class="q">この要素の責務と契約は何で、その充足をどの根拠が支えているか(契約充足の評価)</div>
    <h3>1. 目的</h3><p>\${esc(e.purpose)}</p>
    <h3>2. 担うこと</h3><ul>\${e.responsibilities.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
    <h3>3. 担わないこと</h3>\${e.not_responsible_for ? "<ul>" + e.not_responsible_for.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>" : none}
    <h3>4. 所有者</h3><p>\${esc(e.owner)} <span class="small">(種別: \${esc(e.kind)})</span></p>
    <h3>5. IN(受けるもの)</h3>\${flowsIn.length ? "<table><tr><th>向き</th><th>相手</th><th>何を(種類)</th><th>成立条件</th></tr>" + flowsIn.map((f) => flowRow(f, "IN")).join("") + "</table>" : none}
    <h3>6. OUT(返すもの)</h3>\${flowsOut.length ? "<table><tr><th>向き</th><th>相手</th><th>何を(種類)</th><th>成立条件</th></tr>" + flowsOut.map((f) => flowRow(f, "OUT")).join("") + "</table>" : none}
    <h3>7. Control / Assumption(前提)</h3>\${assumptions.length ? "<ul>" + assumptions.map((x) => "<li>" + esc(x.a) + ' <span class="small">(' + esc(x.cid) + ")</span></li>").join("") + "</ul>" : none}
    <h3>8. Feedback(戻り)</h3>\${fbFlows.length ? "<ul>" + fbFlows.map((f) => "<li>↩ " + esc(f.label) + ' <span class="small">— ' + esc(el(f.from).name) + " → " + esc(el(f.to).name) + "(" + esc(f.feedback_for) + " への戻り)</span></li>").join("") + "</ul>" : none}
    <h3>9. Guarantee と状態</h3>\${cs.length ? cs.map((c) => \`
      <p>\${stBadge(c.verification_status)} \${esc(c.guarantee)}</p>
      <p class="small">測り方: \${esc(c.response_measure)}</p>
      \${c.na_reason ? '<p class="small"><b>適用しない理由</b>: ' + esc(c.na_reason) + "</p>" : ""}
      \${evRows(c.evidence)}
      \${provRows(c.provenance)}\`).join("<hr>") : '<p class="small">この要素を対象にした契約は記録されていない(不明であって「無し」ではない)。</p>'}
    <h3>10. Failure effect(破られたら)</h3>\${failures.length ? "<ul>" + failures.map((c) => "<li>" + esc(c.failure_effect) + ' <span class="small">(' + esc(c.id) + ")</span></li>").join("") + "</ul>" : none}
    <h3>11. Requirement / Rationale(要求と根拠)</h3>
    \${(e.requirements ?? []).length ? "<ul>" + e.requirements.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>" : ""}
    \${provRows(e.provenance) || none}
    <h3>12. Code / Test / Evidence(実現と証拠)</h3>
    \${realizationBlock(e)}
    \${evidenceLinks.length ? evidenceLinks.map((x) => evRows([x.ev])).join("") : ""}\`;
}

// 構成図。層はフィードバックと宣言順循環切りを除いた Flow の最長距離。
function diagram(tops, flows) {
  const ids = tops.map((e) => e.id);
  const adj = Object.fromEntries(ids.map((i) => [i, []]));
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return adj[from].some((n) => reaches(n, to, seen));
  };
  const layerFlows = [];
  for (const f of flows.filter((f) => !f.feedback_for && f.from !== f.to)) {
    if (reaches(f.to, f.from)) continue;
    adj[f.from].push(f.to);
    layerFlows.push(f);
  }
  const dist = Object.fromEntries(ids.map((i) => [i, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const f of layerFlows) {
      if (dist[f.to] < dist[f.from] + 1) { dist[f.to] = dist[f.from] + 1; moved = true; }
    }
    if (!moved) break;
  }
  const nLayers = Math.max(...ids.map((i) => dist[i])) + 1;
  const cols = Array.from({ length: nLayers }, () => []);
  for (const e of tops) cols[dist[e.id]].push(e);

  // 縦積み(上→下 = Flow の向き)。1440×900 で読める大きさを保つ。
  // 箱の幅は行内の箱数に適応させ、幅方向の未使用領域を減らす。
  const maxRow = Math.max(...cols.map((c) => c.length));
  const BW = maxRow === 1 ? 460 : maxRow === 2 ? 360 : 300;
  const BH = 175, GXROW = 44, GYLAYER = 90, PAD = 16, LANE = 260;
  const rowW = maxRow * BW + (maxRow - 1) * GXROW;
  const pos = {};
  cols.forEach((col, li) => {
    const colW = col.length * BW + (col.length - 1) * GXROW;
    const x0 = PAD + (rowW - colW) / 2; // 各層を中央寄せ
    col.forEach((e, ri) => {
      pos[e.id] = { x: x0 + ri * (BW + GXROW), y: PAD + li * (BH + GYLAYER) };
    });
  });
  const W = PAD * 2 + rowW + LANE;
  const H = PAD * 2 + nLayers * BH + (nLayers - 1) * GYLAYER;

  const ioSummary = (eid) => {
    const ins = flows.filter((f) => f.to === eid), outs = flows.filter((f) => f.from === eid);
    const fmt = (a, tag) => a.length ? tag + " " + a.length + ": " + a.slice(0, 2).map((f) => esc(f.label)).join("、") + (a.length > 2 ? " 他" : "") : "";
    return [fmt(ins, "IN"), fmt(outs, "OUT")].filter(Boolean).join("<br>");
  };
  const stChips = (eid) => {
    const cs = M().contracts.filter((c) => c.subject === eid);
    return cs.length ? cs.map((c) => '<span class="st st-' + c.verification_status + '">' + c.verification_status + "</span>").join(" ")
      : '<span style="color:#666">契約: 記録なし</span>';
  };

  const boxes = tops.map((e) => {
    const p = pos[e.id];
    const sel = focusEl === e.id;
    // 種別と境界の内外は**語**で言う。線(破線枠)は同じことを形でも示す補助にすぎない。
    const k = look("element_kind", e.kind);
    return \`<g data-el="\${e.id}" style="cursor:pointer">
      <rect x="\${p.x}" y="\${p.y}" width="\${BW}" height="\${BH}" fill="\${sel ? "#eaf1ff" : "#fff"}" stroke="#222" stroke-width="\${sel ? 3 : 1.5}" \${k.outside_boundary === true ? 'stroke-dasharray="6 4"' : ""}/>
      <foreignObject x="\${p.x + 8}" y="\${p.y + 6}" width="\${BW - 16}" height="\${BH - 12}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:14px; line-height:1.4; overflow:hidden; height:100%">
          <div style="font-size:16px; font-weight:700">\${sel ? "▸選択中 " : ""}\${esc(e.name)}</div>
          <div class="tag" data-kind="\${esc(e.kind)}">［\${esc(k.mark)}\${k.outside_boundary === true ? "・境界の外" : ""}］</div> \${rev(e)}
          <div>\${esc(firstSentence(e.purpose))}</div>
          <div style="color:#444">\${ioSummary(e.id)}</div>
          <div style="margin-top:2px">\${stChips(e.id)}
          \${M().elements.some((c) => c.parent === e.id) ? ' <button data-drill="' + e.id + '" style="font-size:13px">内部を見る</button>' : ""}</div>
        </div>
      </foreignObject>
    </g>\`;
  }).join("");

  const pairSeen = {};
  const laneX = PAD + rowW + 30; // 右側の迂回レーン(フィードバック・層跨ぎ)
  // レーンのラベルは縦に並ぶため、近接すると重なる。置いた y を記録し、36px 未満なら退避する。
  // NO_STAGGER は退避を切る試験専用の旗 — 重なり検出試験(test-labels-browser)の負例が
  // 「検出器が本当に検出する」ことを確かめるために使う。本番 build では使わない。
  const laneLabelYs = [];
  const staggerOff = typeof NO_STAGGER !== "undefined" && NO_STAGGER;
  const placeLaneLabel = (ly) => {
    if (!staggerOff) {
      while (laneLabelYs.some((y) => Math.abs(y - ly) < 36)) ly -= 36;
    }
    laneLabelYs.push(ly);
    return ly;
  };
  const edges = flows.map((f) => {
    const a = pos[f.from], b = pos[f.to];
    const key = [f.from, f.to].sort().join("|");
    const off = (pairSeen[key] = (pairSeen[key] ?? -1) + 1) * 22;
    const fb = !!f.feedback_for;
    const down = a.y < b.y, sameLayer = a.y === b.y;
    const span = Math.abs(Math.round((b.y - a.y) / (BH + GYLAYER)));
    // ラベルは二行(1行目=名前、2行目=種類)で全文を出す。切り詰めない(所有者指摘: 完全可読)。
    const full = (fb ? "↩ " : "") + f.label + "(" + f.kind + ")";
    const line1 = (fb ? "↩ " : "") + f.label;
    const line2 = "(" + f.kind + ")";
    let path, lx, ly, anchorAttr = 'text-anchor="middle"';
    if (sameLayer) {
      const x1 = a.x + BW, x2 = b.x, ym = a.y + BH / 2 + off;
      path = \`M \${x1} \${ym} C \${(x1 + x2) / 2} \${ym - 30}, \${(x1 + x2) / 2} \${ym - 30}, \${x2} \${ym}\`;
      lx = (x1 + x2) / 2; ly = ym - 50;
    } else if (fb || span >= 2) {
      // 右レーンで迂回し、到達先の上の隙間から入る(他の箱を横切らない)
      const x1 = a.x + BW, y1 = a.y + BH / 2 + off;
      const xl = laneX + (fb ? 26 : 0) + off;
      const yTop = b.y - 26 - off / 2;
      const xEnd = b.x + BW * 0.72 + off;
      path = \`M \${x1} \${y1} C \${xl} \${y1}, \${xl} \${y1}, \${xl} \${yTop} L \${xEnd} \${yTop} L \${xEnd} \${b.y}\`;
      lx = xl + 6; ly = placeLaneLabel((y1 + yTop) / 2 - 8); anchorAttr = 'text-anchor="start"';
    } else {
      // 隣接層への縦の流れ。ラベルは到達先の直前(到達先ごとに散り、衝突しない)
      const x1 = a.x + BW / 2 + off, x2 = b.x + BW / 2 + off;
      const y1 = down ? a.y + BH : a.y, y2 = down ? b.y : b.y + BH;
      const my = (y1 + y2) / 2;
      path = \`M \${x1} \${y1} C \${x1} \${my}, \${x2} \${my}, \${x2} \${y2}\`;
      lx = x2; ly = down ? y2 - 24 : y2 + 17;
    }
    return \`<path d="\${path}" fill="none" stroke="#444" stroke-width="1.4" \${fb ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#arr)"><title>\${esc(full)}</title></path>
      <text x="\${lx}" y="\${ly}" font-size="13" \${anchorAttr} fill="#333" paint-order="stroke" stroke="#fff" stroke-width="4"><title>\${esc(full)}</title><tspan x="\${lx}" dy="0">\${esc(line1)}</tspan><tspan x="\${lx}" dy="15">\${esc(line2)}</tspan></text>\`;
  }).join("");

  return \`<svg viewBox="0 0 \${W} \${H}" width="\${W}" style="max-width:100%; height:auto; border:1px solid #ddd; background:#fff; display:block; margin:0 auto">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#444"/></marker></defs>
    \${edges}\${boxes}
  </svg>
  <div class="legend">各箱の角括弧が種別と境界の内外を言う(［人・境界の外］など)。破線枠は同じことを線でも示す補助である。選択中の箱は名前の前に ▸選択中 と出る。破線辺 ↩ = フィードバック。辺は全て正本の Flow(名前+種類つき)。層は Flow の向きから導出。</div>\`;
}

function scopeTops() { return M().elements.filter((e) => (drill ? e.parent === drill : (e.parent ?? null) === null)); }
function scopeFlows(tops) {
  const ids = new Set(tops.map((e) => e.id));
  return M().flows.filter((f) => ids.has(f.from) && ids.has(f.to));
}

function viewSystem() {
  const tops = scopeTops();
  const flows = scopeFlows(tops);
  const parent = drill ? el(drill) : null;
  const crumb = drill
    ? \`<div class="crumb"><a id="up">全体(\${esc(M().target)})</a> › <b>\${esc(parent.name)} の内部</b></div>
       <div class="parentline">親の目的: \${esc(firstSentence(parent.purpose))}(境界 = \${esc(parent.name)})</div>\`
    : "";
  const ids = new Set(tops.map((e) => e.id));
  const crossFlows = drill
    ? M().flows.filter((f) => ids.has(f.from) !== ids.has(f.to) && (ids.has(f.from) || ids.has(f.to)))
    : [];
  const crossTable = crossFlows.length
    ? \`<h3>境界を越える流れ(親の外部 I/O へ集約される)</h3>
      <table><tr><th>から</th><th>何を(種類)</th><th>へ</th><th>成立条件</th></tr>
      \${crossFlows.map((f) => \`<tr><td>\${esc(el(f.from).name)}</td><td>\${esc(f.label)}(\${esc(f.kind)})</td><td>\${esc(el(f.to).name)}</td><td class="small">\${esc(f.condition)}</td></tr>\`).join("")}</table>\`
    : "";
  const sys = M().system;
  // 直書きの二種別しか見ておらず、organization と device は黙って**内側**に数えられていた。
  const externals = M().elements.filter((e) => (e.parent ?? null) === null && look("element_kind", e.kind).outside_boundary === true);
  const sysHeader = drill ? "" : \`<div style="border:2px solid #222; padding:.5rem .8rem; margin-bottom:.6rem; background:#fafafa">
      <div><b>目的</b> \${esc(sys.purpose)}</div>
      <div><b>境界</b> \${esc(sys.boundary)}</div>
      <div class="small">境界の外: \${externals.map((e) => esc(e.name) + "(" + esc(look("element_kind", e.kind).mark) + ")").join("、") || "—"} / \${provRows(sys.provenance)}</div>
    </div>\`;
  return \`<div class="q">この画面の一問: このシステムは何のために存在し、何から構成され、外部の誰と何をやり取りするか</div>
    \${crumb}
    \${sysHeader}
    \${diagram(tops, flows)}
    \${flows.length === 0 ? '<p class="small">この階層の内側に閉じた流れは記録されていない(記録が無いのであって「無い」の確定ではない)。</p>' : ""}
    \${flows.length ? \`<h3>Flow 一覧(配置に依らない全件の確認用)</h3>
      <table><tr><th>ID</th><th>送信元</th><th>受信先</th><th>名前</th><th>種類</th><th>feedback_for</th></tr>
      \${flows.map((f) => \`<tr><td>\${esc(f.id)}</td><td>\${esc(el(f.from).name)}</td><td>\${esc(el(f.to).name)}</td><td>\${esc(f.label)}</td><td>\${esc(f.kind)}</td><td>\${esc(f.feedback_for ?? "—")}</td></tr>\`).join("")}</table>\` : ""}
    \${crossTable}\`;
}

function viewScenario() {
  return \`<div class="q">この画面の一問: この目的の流れでは、誰が何を行い、何が起き、何が返るか</div>
    \${M().scenarios.map((s) => \`
    <details \${s.kind === "normal" ? "open" : ""}>
      <summary>\${s.kind === "exception" ? "⚠ 例外系: " : "正常系: "}\${esc(s.goal)}\${s.exception_of ? ' <span class="small">(正常系: ' + esc(s.exception_of) + ")</span>" : ""}</summary>
      <p class="small">きっかけ: \${esc(s.trigger)} / 前提: \${(s.preconditions ?? []).map(esc).join("・") || "—"}</p>
      <table><tr><th>誰が</th><th>何を行う</th><th>誰へ</th><th>期待する結果</th></tr>
        \${s.steps.map((st) => \`<tr><td>\${esc(el(st.actor).name)}</td><td>\${esc(st.action)}</td><td>\${esc(el(st.receiver).name)}</td><td>\${esc(st.expected)}</td></tr>\`).join("")}
      </table>
      <p><b>結果</b> \${esc(s.outcome)}</p>
      \${s.loss_or_failure ? "<p class='small'>失われるもの: " + esc(s.loss_or_failure) + "</p>" : ""}
      \${provRows(s.provenance)}
    </details>\`).join("")}\`;
}

function viewAssurance() {
  const order = [${STATUS_DISPLAY_ORDER.map((s) => JSON.stringify(s)).join(", ")}];
  const cs = [...M().contracts].sort((a, b) => order.indexOf(a.verification_status) - order.indexOf(b.verification_status));
  return \`<div class="q">この画面の一問: 何が守られるべきで、何が証拠付きで確認され、何がまだ主張・計画段階なのか</div>
    <p class="small">「記載がない」と「問題がない」は同じ表示にしない。verified は条件(版・環境・観測日・証拠)を必ず併記する。</p>
    <table><tr><th>状態</th><th>対象</th><th>守ると主張すること</th><th>前提</th><th>根拠</th></tr>
    \${cs.map((c) => \`<tr>
      <td>\${stBadge(c.verification_status)}</td>
      <td>\${esc(el(c.subject).name)}</td>
      <td>\${esc(c.guarantee)}\${c.na_reason ? '<div class="small"><b>適用しない理由</b>: ' + esc(c.na_reason) + "</div>" : ""}\${c.failure_effect ? '<div class="small">破られたら: ' + esc(c.failure_effect) + "</div>" : ""}</td>
      <td class="small">\${c.assumptions.map(esc).join("<br>")}</td>
      <td>\${evRows(c.evidence)}\${provRows(c.provenance)}</td>
    </tr>\`).join("")}</table>\`;
}

function viewImpact() {
  return \`<div class="q">この画面の一問: これを変更した場合、何をどの順番で修正する必要があるか</div>
    <p>この問いの正本は既存の Doctrine Lens(Consequence View)である。プロトタイプは答えを持たない。</p>
    <p class="small">対象 doctrine-and-lens では、編集器で当該文書を開けば Lens が「一本の明細」で答える(lens REQ-000)。二画面は連携するが混ぜない(台帳 B 節 P1)。</p>\`;
}

function viewInspect() {
  return \`<div class="q">この画面の一問: M 層のうちプロトタイプが受け持つ検査は通っているか</div>
    <p><b>M-13</b>(読み口): 実行時の外部読み取りは零 — build 終端の生成物走査に加え、実ブラウザで全操作の通信を記録する検査(test-m13-browser.mjs)がある。外部資源を仕込んだ負例が落ちることも同検査が確かめる。</p>
    <p><b>M-14</b>(要素→実在する Code/Test/Evidence へ 3 操作以内): 到達先は開ける URL を持つアンカーに限る(出所は代用にならない)。壊れた参照・未登録は build が落ちる。実現が適用されない要素は明示の対象外のみ。最大 = \${M14.max} 操作。負の試験(4 操作・リンク切れ・未登録)は本番と同じ計算経路で発火を確認済み。</p>
    <table><tr><th>対象</th><th>要素</th><th>判定</th><th>操作数 / 備考</th></tr>
      \${M14.rows.map((r) => \`<tr><td>\${esc(r.target)}</td><td>\${esc(r.element)}</td><td data-reach="\${esc(r.status)}">［\${esc(look("reachability_status", r.status).mark)}］</td><td class="small">\${r.ops ?? ""}\${r.note ? (r.ops != null ? " / " : "") + esc(r.note) : ""}</td></tr>\`).join("")}
    </table>
    <p class="small">操作数の定義は台帳 v3.2-16。右下の計数器は H 層試験(O 層観測)用。</p>
    <h3>この緑が検めていないこと(了解の記録 \${ACKS.length} 件)</h3>
    <p class="small"><b>合格の桶に入るのは PASS だけである。</b>下は「見た件数が 0」「この版では判定不能」を、
      出所つきで個別に許した記録である。**この一覧の長さが、機械が何も言えていない量である。**
      期限を過ぎた了解は了解ではない —— それ自体が所見になる。</p>
    <table><tr><th>不変条件</th><th>対象</th><th>判定</th><th>何を検めていないか</th><th>再点検の期限</th></tr>
      \${ACKS.map((a) => \`<tr data-ack="\${esc(a.invariant)}"><td>\${esc(a.invariant)}</td><td>\${esc(a.target)}</td><td>\${esc(a.verdict)}</td><td class="small">\${esc(a.reason)}</td><td class="small">\${esc(a.expires_at)}(記録 \${esc(a.checked_at)})</td></tr>\`).join("")}
    </table>
    <p class="small"><b>M-07b</b>(候補が正本表示に混ざらない)は、確認済の実体が一つも無く、
      確認済だけを写した正本表示も実装されていないため、<b>まだ一度も検められていない</b>。
      この画面は正本表示ではない。</p>\`;
}

function render() {
  // 帯はデータから作る。字で書いておくと、一件が確認済になった日に帯だけが嘘になる。
  document.getElementById("banner").innerHTML = banner();
  // 架空の対象は、画面が架空と言う。**この帯が出ない架空の対象は、実在と見分けがつかない。**
  const fx = document.getElementById("fict");
  const note = FICTIONAL[M().target];
  fx.hidden = !note;
  if (note) { fx.textContent = note; fx.setAttribute("data-fictional", M().target); }
  else fx.removeAttribute("data-fictional");
  const v = { system: viewSystem, scenario: viewScenario, assurance: viewAssurance, impact: viewImpact, inspect: viewInspect }[view];
  document.getElementById("left").innerHTML = v();
  const d = document.getElementById("detail");
  if (view === "system" && focusEl) {
    d.hidden = false;
    d.innerHTML = detailPanel(focusEl);
    document.getElementById("close").onclick = () => { focusEl = null; bump(); render(); };
  } else {
    d.hidden = true;
    d.innerHTML = "";
  }
  document.querySelectorAll("[data-el]").forEach((b) => b.onclick = (ev) => {
    if (ev.target.dataset.drill) return;
    focusEl = b.dataset.el; bump(); render();
  });
  document.querySelectorAll("[data-drill]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    drillStack.push({ drill, focusEl });
    drill = b.dataset.drill; focusEl = null; bump(); render();
  });
  const up = document.getElementById("up");
  if (up) up.onclick = () => {
    const prev = drillStack.pop() ?? { drill: null, focusEl: null };
    drill = prev.drill; focusEl = prev.focusEl; bump(); render();
  };
}
render();
</script>
</body>
</html>
`;

// ---- M-13 の機械判定(build 終端) ----
// 生成物は一つなので、対象は成果物そのもの。見た件数は 1(綴りを走査した回数)。
const noFetch = checkNoRuntimeFetch(html);
records.push(verdict({
  invariant: "M-13", checker: "build:no-runtime-fetch", target: "index.html",
  examined: 1, examined_unit: "生成物",
  violations: noFetch ? [] : [{ code: "gate.runtime_fetch", message: "生成物に実行時の外部読み取り(fetch/XHR)が在る" }],
}));

for (const r of records) console.log(formatRecord(r, ackFor(r, today.date)));
if (reportPath) writeReport(reportPath, "build", records);

const code = gateExitCode(records, today.date);
if (code !== 0) {
  console.error(`\nbuild の門が通らない(終了コード ${code})。index.html は書かない。`);
  process.exit(code);
}

sweepStale(outPath);
writeAtomic(outPath, html);
console.log(`${outPath} を生成した。M-14 最大操作数:`, m14max ?? "(到達可能な要素なし)", "/ M-13: 外部読み取りなし");
