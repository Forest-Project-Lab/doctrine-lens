// 統治の実態を、**宣言済み読み口が返した値だけ**から描く(層A)。
//
//   node build-system-view.mjs [--surfaces <path>] [--out <path>] [--ledger <path>]
//
// 入力は `surfaces/surfaces.json` **ただ一つ**である。他のファイルを読まない。
// 手書きの模型(`gold-model/target-*.json` ほか)は一行も読まない —— 所有者決定 2026-08-16。
//
// ## この綴りが自分に課している規律
//
// **数は必ず `num()` を通す。** `num()` は台帳(`system-view.provenance.json`)へ
// `{value, from, section}` を記録する。門は出荷物の本文から数字を全て採り、台帳に無い数が
// 一つでも在れば落とす —— **散文へ数を焼き込む経路が構造的に閉じる。**
//
// これは設計の審査が最も多く挙げた過大主張への対処である。焼いた数(印の無いファイル 142・
// 所見 36・所見 8)は、焼いたその日のうちに 146・52・24 へ動いていた。
//
// **`surfaces.json` の散文を画面へ出さない。** 各口の `why`、最上位の `$comment`・
// `captured_from`・`same_tree_reason` は `capture.mjs` が書いた**手書きの字**である。
// 測定値の顔をして画面に出ると、手書きを排した意味が無くなる。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";
import { writeAtomic, sweepStale } from "../lib/atomic-write.mjs";
import { revState } from "../lib/rev-state.mjs";
import { stringifyStable } from "../lib/stable-json.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const one = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const surfacesPath = resolve(one("--surfaces") ?? join(here, "..", "surfaces", "surfaces.json"));
const outPath = resolve(one("--out") ?? join(here, "system-view.html"));
const ledgerPath = resolve(one("--ledger") ?? join(here, "system-view.provenance.json"));

let cap;
try { cap = JSON.parse(readFileSync(surfacesPath, "utf8")); }
catch (e) { die(`読み口の捕獲を読めない: ${surfacesPath}\n  ${e.message}\n  先に surfaces/capture.mjs を回すこと`, 2); }
if (cap.schema !== "system-map/surfaces/1") die(`想定外の schema: ${cap.schema}`, 2);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- 三つの記号。**互いに別のクラス・別の字で描く** -------------------------
//   0    口が答えて 0 件だった(測定結果)
//   —    口が答えなかった/その欄を返さない(未測定)
//   不明  口は答えたが、規則が判定を出せない(判定不能)
const MISSING = Symbol("未測定");
const UNMEASURED = `<span class="unmeasured" title="口が答えなかった、またはこの欄を返さない">—</span>`;

/** 口を引く。無ければ落とす —— 捕獲の一覧と綴りが食い違ったことを黙って通さない。 */
const surf = (id) => {
  const s = (cap.surfaces ?? []).find((x) => x.id === id);
  if (!s) die(`捕獲に口 ${id} が無い。capture.mjs の一覧と食い違っている`, 2);
  return s;
};
/** 口の欄を引く。**無いものを 0 に落とさない。** */
const val = (id, path) => {
  const s = surf(id);
  if (s.status !== "captured") return MISSING;
  let cur = s.data;
  for (const k of path.split(".")) {
    if (cur === null || cur === undefined || !Object.hasOwn(cur, k)) return MISSING;
    cur = cur[k];
  }
  return cur;
};

// ---- 数の台帳 -------------------------------------------------------------
const ledger = [];
let section = "(頭)";
/**
 * **画面に出る数は必ずここを通る。**
 * @param v 値。MISSING なら「—」を返し、数として記録しない。
 * @param from どの欄から来たか。導出なら式を書く。
 * @param derived 画面が数えた導出か
 */
function num(v, from, { derived = false } = {}) {
  if (v === MISSING || v === null || v === undefined) return UNMEASURED;
  const value = Number(v);
  if (!Number.isFinite(value)) return UNMEASURED;
  ledger.push({ value, from, derived, section });
  return `<b class="num${derived ? " derived" : ""}">${esc(String(value))}</b>${derived ? '<sup class="d" title="画面が数えた導出であり、口が返した値ではない">導</sup>' : ""}`;
}
/**
 * 和が閉じるかを検め、閉じなければ画面で言う(丸めない)。
 * **同時に台帳へ積む** —— 閉じない内訳を出荷しないことを段が判ずる(M-V3)。
 */
const closures = [];
function closure(name, parts, total) {
  const s = parts.reduce((a, b) => a + (typeof b === "number" ? b : NaN), 0);
  const ok = Number.isFinite(s) && Number.isFinite(total) && s === total;
  closures.push({ name, sum: s, total, ok });
  return { sum: s, ok };
}

// ---- 口 -------------------------------------------------------------------
const models = val("model-index", "models");
const nodes = val("dep-graph", "nodes");
const edges = val("dep-graph", "edges");
const ranges = val("trace-index", "ranges");
const tiFindings = val("trace-index", "findings");
const tc = val("docs-audit", "trace_coverage");
const totals = val("docs-audit", "totals");
const byCheck = val("docs-audit", "counts_by_check");
const checksRun = val("docs-audit", "checks_run");
const daFindings = val("docs-audit", "findings");

const arr = (x) => (Array.isArray(x) ? x : []);
const has = (x) => x !== MISSING && x !== null && x !== undefined;

// ---- 鮮度 -----------------------------------------------------------------
// **規則は書かない。宣言から導いた一箇所(`lib/rev-state.mjs`)を呼ぶ。**
// 記録時 = 出荷物に焼く rev。いま = **観測する口が無いので null**。
// したがって規則は必ず「不明」を返す。**この画面の構造では「同一」も「相違」も出ない。**
const freshness = revState({ recordedRev: cap.source_revision ?? null, currentRev: null, currentDirty: null });

const MODEL_TYPE_NODES = has(nodes) ? arr(nodes).filter((x) => x.type === "MODEL").length : MISSING;
const dirtyMouths = (cap.surfaces ?? []).filter((s) => s.source_dirty === true).length;

// ---- 生成 -----------------------------------------------------------------
const parts = [];
const P = (s) => parts.push(s);

P(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>統治の実態 — 宣言済み読み口が返した値だけ</title>
<style>
:root{--fg:#111;--bg:#fff;--dim:#666;--line:#ddd;--bad:#8a1f11;--hi:#fff8e1}
*{box-sizing:border-box}
body{margin:0 auto;padding:2rem 1.25rem 6rem;max-width:64rem;font:15px/1.75 system-ui,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:1.45rem;line-height:1.5;margin:0 0 .75rem}
h2{font-size:1.1rem;margin:2.5rem 0 .5rem;padding-top:.75rem;border-top:2px solid var(--fg)}
h3{font-size:.98rem;margin:1.25rem 0 .25rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;word-break:break-all}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}
th,td{border:1px solid var(--line);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:#f6f6f6;font-weight:600}
.num{font-variant-numeric:tabular-nums;font-weight:700}
.derived{border-bottom:2px dotted var(--dim)}
sup.d{font-size:.68em;color:var(--dim)}
.unmeasured{color:var(--dim);font-weight:700}
.undecided{color:#7a5c00;font-weight:700;background:#fff3cd;padding:0 .25em}
.bad{color:var(--bad);font-weight:600}
.note{color:var(--dim);font-size:.87em}
.lead{background:var(--hi);border:1px solid #e0c98a;padding:.85rem 1rem;margin:1rem 0}
.gapnum b{font-size:1.5rem}
.wrap{overflow-x:auto}
details{border:1px solid var(--line);padding:.4rem .6rem;margin:.4rem 0}
summary{cursor:default;font-weight:600}
ul{margin:.5rem 0;padding-left:1.4rem}
li{margin:.35rem 0}
pre{white-space:pre-wrap;word-break:break-all;font-size:.78em;background:#fafafa;padding:.5rem;margin:.4rem 0}
</style>
</head>
<body>`);

// ---------- 頭 ----------
section = "0 問い";
P(`<h1>この統治木で、機械が測れたのはどこまでで、その外側はどれだけ在るか。</h1>
<div class="lead">
<p><b>この画面は System Map ではない。</b> System Map は MODEL 型の文書として木の中に在る物であり、
この木にそれは ${num(has(models) ? arr(models).length : MISSING, "model-index/1 の models[] の長さ")} 件である。
ここに在るのは、四つの読み口が build 時に返した値をそのまま並べた一枚である。</p>
<p>手書きの模型の内容は一文字も含まない（不変条件 M-V1 が機械で検める）。</p>
${dirtyMouths > 0
    ? `<p class="bad">この頁の数は、どの commit にも対応しない作業木の値である ——
       ${num(dirtyMouths, "surfaces[].source_dirty === true の件数", { derived: true })} つの口が「未コミットの変更あり」と名乗った。
       刻んだ <code>${esc(String(cap.source_revision ?? "").slice(0, 12) || "(揃わず)")}</code> は、測った対象そのものを指していない。</p>`
    : `<p>四つの口はいずれも「未コミットの変更なし」と名乗った。</p>`}
</div>`);

// ---------- 節 1: 欠落 ----------
section = "1 測れていないもの";
const unmarked = has(tc) ? tc.unmarked_files : MISSING;
const prunedSum = has(tc) ? Object.values(tc.pruned_dirs ?? {}).reduce((a, b) => a + b, 0) : MISSING;
const rangeIds = has(ranges) ? new Set(arr(ranges).map((r) => r.id)) : null;
const noEdgeNodes = has(nodes) && has(edges)
  ? arr(nodes).filter((x) => !arr(edges).some((e) => e.src === x.id || e.dst === x.id)).length
  : MISSING;

P(`<h2>1. 木の側に無いもの</h2>
<p>達成の数より先に、同じ大きさで置く。<b>この行は一つも消えない。</b></p>
<table>
<tr><th>何が</th><th>いくつ</th><th>この数が意味すること</th></tr>
<tr><td>意味モデル</td><td class="gapnum">${num(has(models) ? arr(models).length : MISSING, "model-index/1 の models[] の長さ")}</td>
  <td><code>model-index/1</code> が列挙した、id を持つ MODEL 文書の数。<br>
  <span class="note">id を持たない MODEL 文書は上流が標準エラーへ出して飛ばす。この数は「id を持つ MODEL の数」である。</span></td></tr>
<tr><td>MODEL 型の節点</td><td class="gapnum">${num(MODEL_TYPE_NODES, "dep-graph/1 の nodes[] のうち type === \"MODEL\" の件数", { derived: true })}</td>
  <td><b>別の口が別に返した数である。上の行と足さない。</b></td></tr>
<tr><td>走査が届いたが印の無いファイル</td><td class="gapnum">${num(unmarked, "docs-audit/1 の trace_coverage.unmarked_files")}</td>
  <td>仕様とコードを結ぶ手掛かりが無いファイル。</td></tr>
<tr><td>走査が届かなかった枝</td><td class="gapnum">${num(prunedSum, "docs-audit/1 の trace_coverage.pruned_dirs の値の和", { derived: true })}</td>
  <td>刈られたディレクトリの配下は<b>見ていない</b>。${has(tc) ? Object.entries(tc.pruned_dirs ?? {}).map(([k, v]) => `<code>${esc(k)}</code> ${num(v, `docs-audit/1 の trace_coverage.pruned_dirs.${k}`)}`).join(" / ") : UNMEASURED}</td></tr>
<tr><td>辺を一本も持たない文書</td><td class="gapnum">${num(noEdgeNodes, "dep-graph/1 の nodes[] のうち edges[] に src でも dst でも現れない件数", { derived: true })}</td>
  <td>依存の網から孤立している。</td></tr>
<tr><td>コードの範囲が返った id</td><td class="gapnum">${num(rangeIds ? rangeIds.size : MISSING, "trace-index/1 の ranges[].id の相異なる数", { derived: true })}</td>
  <td>節点 ${num(has(nodes) ? arr(nodes).length : MISSING, "dep-graph/1 の nodes[] の長さ")} 件のうち、コードへの印が在るのはこれだけである。</td></tr>
</table>
<p class="note">これらは<b>木の側に無い物</b>である。この画面が描かないと決めた物（最終節）とは別である。</p>`);

// ---------- 節 2: 意味モデルの帯 ----------
section = "2 意味モデル";
P(`<h2>2. 意味モデル</h2>`);
if (surf("model-index").status !== "captured") {
  P(`<div class="lead"><p><b>意味モデル ${UNMEASURED}</b> —— <code>model-index/1</code> を呼べなかった（${esc(surf("model-index").reason)}）。
  <b>件数を言えない。</b> <code>0</code> 件と読み替えない。</p></div>`);
} else if (arr(models).length === 0) {
  P(`<div class="lead">
<p class="gapnum"><b>意味モデル ${num(0, "model-index/1 の models[] の長さ")} 件</b></p>
<p><code>model-index/1</code> は走り、空の一覧を返した。別の口も同じ方向を指す ——
<code>dep-graph/1</code> が返した ${num(has(nodes) ? arr(nodes).length : MISSING, "dep-graph/1 の nodes[] の長さ")} 節点の <code>type</code> を数えると、
MODEL 型は ${num(MODEL_TYPE_NODES, "dep-graph/1 の nodes[] のうち type === \"MODEL\" の件数", { derived: true })} 件である。
<b>二つの口が別々に返した二つの 0 であり、一つを二回数えた物ではない。足さない。</b></p>
<p><b>この木は「誰が誰を指すか」を統治しており、「何を意味するか」を一件も統治していない。</b>
要素も、流れも、契約も、シナリオも、この木には無い。図を描かなかったのではない —— <b>描く材料が無い。</b></p>
<p><b>0 は状態であって功績ではない。この数を、画面の正直さの証として読まない。</b></p>
</div>`);
} else {
  P(`<table><tr><th>id</th><th>題</th><th>対象</th><th>状態</th><th>更新</th><th>投影</th></tr>
${arr(models).map((m) => `<tr><td><code>${esc(m.id)}</code></td><td>${esc(m.title)}</td><td>${esc(m.target ?? "")}</td><td>${esc(m.status)}</td><td>${esc(m.updated)}</td><td><code>${esc(m.projection_path)}</code></td></tr>`).join("")}
</table>`);
}

// ---------- 節 3: 走査の閉包 ----------
section = "3 走査が届いた範囲";
P(`<h2>3. 走査が届いた範囲の内訳</h2>`);
if (!has(tc)) {
  P(`<p><b>${UNMEASURED}</b> この版の <code>docs-audit/1</code> は走査の被覆を返さない。</p>`);
} else {
  const exc = Object.values(tc.excluded ?? {}).reduce((a, b) => a + b, 0);
  const c = closure("走査の内訳が reached_files に閉じる", [tc.annotated_files, tc.unmarked_files, tc.exempt_files, exc], tc.reached_files);
  P(`<p>上流の保存則は <code>reached = annotated + unmarked + exempt + Σexcluded</code>。
<b><code>excluded</code> は「未到達」ではない</b> —— 触れたうえで規則により外した物である。届かなかったのは刈った枝だけである。</p>
<table>
<tr><td>印が在る</td><td>${num(tc.annotated_files, "docs-audit/1 の trace_coverage.annotated_files")}</td></tr>
<tr><td>印が無い</td><td>${num(tc.unmarked_files, "docs-audit/1 の trace_coverage.unmarked_files")}</td></tr>
<tr><td>免除</td><td>${num(tc.exempt_files, "docs-audit/1 の trace_coverage.exempt_files")}</td></tr>
<tr><td>規則で外した</td><td>${num(exc, "docs-audit/1 の trace_coverage.excluded の値の和", { derived: true })}</td></tr>
<tr><th>合計</th><th>${num(c.sum, "上の四つの和", { derived: true })} / 口が名乗る <code>reached_files</code> は ${num(tc.reached_files, "docs-audit/1 の trace_coverage.reached_files")}
  —— ${c.ok ? "閉じている" : '<span class="bad">閉じていない。内訳は口の名乗る総数と合わない</span>'}</th></tr>
</table>
<h3>除外の内訳（0 の鍵も消さない）</h3>
<table><tr>${Object.keys(tc.excluded ?? {}).map((k) => `<th><code>${esc(k)}</code></th>`).join("")}</tr>
<tr>${Object.entries(tc.excluded ?? {}).map(([k, v]) => `<td>${num(v, `docs-audit/1 の trace_coverage.excluded.${k}`)}</td>`).join("")}</tr></table>
<p class="note">完全性の旗: <code>truncated</code> = ${esc(String(tc.truncated))}${tc.truncated ? " —— <b class='bad'>途中で打ち切られている。上の数はいずれも部分計数である</b>" : ""} /
<code>gitignore</code> = ${esc(String(tc.gitignore))}</p>`);
  if (tc.spec_coverage) {
    P(`<h3>実装の指紋節の宣言</h3>
<table><tr>${Object.keys(tc.spec_coverage).map((k) => `<th><code>${esc(k)}</code></th>`).join("")}</tr>
<tr>${Object.entries(tc.spec_coverage).map(([k, v]) => `<td>${num(v, `docs-audit/1 の trace_coverage.spec_coverage.${k}`)}</td>`).join("")}</tr></table>
<p class="note"><b><code>traced</code> は「実装の指紋」節を宣言している数であって、コードへ届いたことの実測ではない。</b>
辺と同じく、これは宣言である。百分率にも進捗棒にもしない。</p>`);
  }
}

// ---------- 節 4: 指紋の採れた範囲 ----------
section = "4 指紋の採れた範囲";
P(`<h2>4. 機械が指紋まで採れた付着</h2>`);
if (!has(ranges)) P(`<p><b>${UNMEASURED}</b> この口が返らなかった。</p>`);
else if (arr(ranges).length === 0) P(`<p>範囲 ${num(0, "trace-index/1 の ranges[] の長さ")} 件 —— 口は答えた。この木に指紋の採れた範囲は一つも無い。</p>`);
else {
  const g = new Map();
  for (const r of arr(ranges)) { if (!g.has(r.id)) g.set(r.id, []); g.get(r.id).push(r); }
  const cl = closure("id ごとの範囲数が ranges に閉じる", [...g.values()].map((v) => v.length), arr(ranges).length);
  P(`<p>範囲 ${num(arr(ranges).length, "trace-index/1 の ranges[] の長さ")} 件が
${num(g.size, "trace-index/1 の ranges[].id の相異なる数", { derived: true })} 個の id に付いている。
群ごとの件数の和は ${num(cl.sum, "id ごとの範囲数の和", { derived: true })} —— ${cl.ok ? "閉じている" : '<span class="bad">閉じていない</span>'}。</p>
<p class="note"><b>指紋は同一性しか言わない。</b> その印が意味の上で正しい場所に打たれているかは、四つの口のどれも判定しない。
この節は「在った」を示すのであって「正しい」を示さない。</p>
<div class="wrap">${[...g.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([id, rs]) => `
<h3>${esc(id)} <span class="note">範囲 ${num(rs.length, `trace-index/1 の ranges[] のうち id === "${id}" の件数`, { derived: true })}</span></h3>
<table><tr><th>経路</th><th>行</th><th>指紋（全文）</th></tr>
${rs.map((r) => `<tr><td><code>${esc(r.path)}</code></td><td style="white-space:nowrap">${num(r.begin_line, `trace-index/1 の ranges[] の begin_line`)}–${num(r.end_line, `trace-index/1 の ranges[] の end_line`)}</td><td><code>${esc(r.fingerprint)}</code></td></tr>`).join("")}
</table>`).join("")}</div>
<p class="note">経路と行は<b>文字</b>である。押しても何も開かない —— この画面は外部へ一切通信せず、偽の到達路を作らない。</p>`);
}

// ---------- 節 5: 依存の網 ----------
section = "5 依存の網";
P(`<h2>5. 文書どうしの依存</h2>`);
if (!has(edges) || !has(nodes)) P(`<p><b>${UNMEASURED}</b> この口が返らなかった。</p>`);
else {
  const kinds = new Map();
  for (const e of arr(edges)) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const fields = new Map();
  for (const e of arr(edges)) fields.set(e.field, (fields.get(e.field) ?? 0) + 1);
  const kc = closure("種別ごとの辺数が edges に閉じる", [...kinds.values()], arr(edges).length);
  const mirrored = arr(edges).filter((e) => e.mirrored === true).length;
  const crossing = arr(edges).filter((e) => e.kind !== "intra_domain");
  P(`<p>節点 ${num(arr(nodes).length, "dep-graph/1 の nodes[] の長さ")} / 辺 ${num(arr(edges).length, "dep-graph/1 の edges[] の長さ")}。</p>
<table><tr><th>観測された辺の種別</th><th>件数</th></tr>
${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${num(v, `dep-graph/1 の edges[] のうち kind === "${k}" の件数`, { derived: true })}</td></tr>`).join("")}
<tr><th>和</th><th>${num(kc.sum, "種別ごとの件数の和", { derived: true })} —— ${kc.ok ? "辺の総数に閉じている" : '<span class="bad">閉じていない</span>'}</th></tr>
</table>
<p class="note"><b>ここに出るのは、この木で実際に観測された種別だけである。</b>
この口は種別の語彙の一覧を返さない —— 出なかった語が在るかどうかを、この画面は知らない。
道具の綴りにしか無い語を「0 件」として並べることはしない。</p>
<p>両側が宣言している辺は ${num(mirrored, "dep-graph/1 の edges[] のうち mirrored === true の件数", { derived: true })} 本、
残りは片側の申告である。<b>この辺は宣言であって、依存が実際に成り立つことの検証ではない。</b></p>
${crossing.length ? `<h3>領域を跨いだ辺（全文）</h3>
<table><tr><th>元</th><th>先</th><th>欄</th><th>種別</th></tr>
${crossing.map((e) => `<tr><td><code>${esc(e.src)}</code></td><td><code>${esc(e.dst)}</code></td><td><code>${esc(e.field)}</code></td><td><code>${esc(e.kind)}</code></td></tr>`).join("")}</table>`
      : `<p>領域を跨いだ辺は ${num(0, "dep-graph/1 の edges[] のうち kind !== \"intra_domain\" の件数", { derived: true })} 本 —— 分類して 0 件だった。</p>`}`);
}

// ---------- 節 6: 所見 ----------
section = "6 所見";
P(`<h2>6. 所見</h2>`);
if (has(totals)) {
  P(`<table><tr>${Object.keys(totals).map((k) => `<th><code>${esc(k)}</code></th>`).join("")}</tr>
<tr>${Object.entries(totals).map(([k, v]) => `<td>${num(v, `docs-audit/1 の totals.${k}`)}</td>`).join("")}</tr></table>
<p class="note"><b>0 の欄は「その重さの所見を 0 件返した」であって「健全である」ではない。</b>
色でも記号でも合格として描かない。<code>advisory</code> は「機械が判定を差し控えた」であって「問題なし」ではない。</p>`);
}
if (has(byCheck) && Object.keys(byCheck).length) {
  const bc = closure("検査ごとの件数が findings に閉じる", Object.values(byCheck), has(daFindings) ? arr(daFindings).length : NaN);
  P(`<table><tr><th>所見を返した検査</th><th>件数</th></tr>
${Object.entries(byCheck).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${num(v, `docs-audit/1 の counts_by_check.${k}`)}</td></tr>`).join("")}
<tr><th>和</th><th>${num(bc.sum, "counts_by_check の値の和", { derived: true })} / <code>findings[]</code> は ${num(has(daFindings) ? arr(daFindings).length : MISSING, "docs-audit/1 の findings[] の長さ")}
  —— ${bc.ok ? "閉じている" : '<span class="bad">閉じていない</span>'}</th></tr></table>
<p class="note"><b>件数だけである。中身は誰も読んでいない。</b></p>`);
}
if (has(tiFindings)) {
  const codes = new Map();
  for (const f of arr(tiFindings)) codes.set(f.code, (codes.get(f.code) ?? 0) + 1);
  P(`<h3>注釈の走査が挙げた所見</h3>
<table><tr><th>符号</th><th>件数</th></tr>
${codes.size ? [...codes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${num(v, `trace-index/1 の findings[] のうち code === "${k}" の件数`, { derived: true })}</td></tr>`).join("")
      : `<tr><td colspan="2">${num(0, "trace-index/1 の findings[] の長さ")} 件</td></tr>`}
</table>
<p class="note">この口は<b>重さを返さない</b> —— 検出に徹し、判定はしない（上流 ADR-156）。
上の監査の所見と<b>同じ物を別の口から数えている場合がある。足さないこと。</b></p>`);
  // **自己測定の環。** 所見が自分の調査の生成物を指しているなら、そう言う。
  const selfPaths = arr(tiFindings).filter((f) => String(f.path ?? "").startsWith("research/system-map/")).length;
  if (arr(tiFindings).length > 0) {
    P(`<p class="note">このうち ${num(selfPaths, "trace-index/1 の findings[] のうち path が research/system-map/ で始まる件数", { derived: true })} 件は、
<b>この調査自身が木へ置いた物</b>を指している。<b>この画面は、自分が測っている木を、自分の存在によって動かしている。</b></p>`);
  }
}

// ---------- 節 7: 検査の名簿 ----------
section = "7 検査の名簿";
P(`<h2>7. 検査の名簿</h2>`);
if (!has(checksRun)) P(`<p><b>${UNMEASURED}</b> この版は検査の名を一つも名乗らなかった。<b>「検査を走らせていない」とは書けない</b> —— それはこの口から言えない。</p>`);
else {
  const fired = has(byCheck) ? Object.keys(byCheck).length : MISSING;
  P(`<p>この版の道具が名乗る検査は ${num(arr(checksRun).length, "docs-audit/1 の checks_run[] の長さ")} 種。うち所見を返したのは ${num(fired, "docs-audit/1 の counts_by_check の鍵の数", { derived: true })} 種。</p>
<p class="note"><b>この数は「走った」の証跡ではない。</b> 上流はこの一覧を静的な定数として無条件に出力する ——
走査が一つもファイルへ届かなかった走行でも同じ数が出る。
<b>残りの検査について、この画面は「走った」とも「走らなかった」とも言えない。</b></p>
<div class="wrap"><p><code>${arr(checksRun).map(esc).join("</code> <code>")}</code></p></div>`);
}

// ---------- 節 8: 口の点呼 ----------
section = "8 口の点呼";
P(`<h2>8. 口の点呼</h2>
<p>四口が名乗った版は ${cap.same_tree ? `一つ —— <code>${esc(String(cap.source_revision).slice(0, 12))}</code>。
<b>これは四つの独立した証拠ではない。同じ build で同じ観測を四回写した物である。</b>`
  : `揃わなかった。`}</p>
<div class="wrap"><table>
<tr><th>読み口</th><th>返したか</th><th>道具と版</th><th>測った木の版</th><th>未コミットの変更</th><th>返した配列</th></tr>
${(cap.surfaces ?? []).map((s) => `<tr>
<td><code>${esc(s.schema_expected)}</code></td>
<td>${s.status === "captured" ? "返した" : `<b class="bad">測れなかった</b><div class="note">${esc(s.reason)}</div>`}</td>
<td>${s.generator ? esc(s.generator.name) + " " + esc(s.generator.version) : UNMEASURED}</td>
<td><code>${s.source_revision === undefined || s.source_revision === null ? UNMEASURED : esc(String(s.source_revision).slice(0, 12))}</code></td>
<td>${s.source_dirty === undefined || s.source_dirty === null ? UNMEASURED : s.source_dirty ? '<b class="bad">あり</b>' : "無し"}</td>
<td class="note">${Object.entries(s.data ?? {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${esc(k)} ${num(v.length, `${s.schema_expected} の ${k}[] の長さ`)}`).join(" / ") || UNMEASURED}</td>
</tr>`).join("")}
</table></div>
<h3>鮮度</h3>
<p>規則が返した値: <span class="undecided">${esc(freshness === "unknown" ? "不明" : freshness)}</span></p>
<p class="note">鮮度の規則（上流 ICD-002・ADR-172 決定3）は「記録時」と「いま」の<b>二回の観測</b>を比べる。
この頁は静的で、build のとき一度しか測らない —— <b>記録時＝出荷物に焼いた版、いま＝観測する口が無いので未取得。</b>
規則はこの入力に対して「不明」を返す。<b>この画面の構造では「同一」も「相違」も出ない。</b>
規則は <code>lib/rev-state.mjs</code> の一箇所だけが持ち、この画面はその返り値を印字するだけである。</p>`);

// ---------- 節 9: 生の返り値 ----------
section = "9 生の返り値";
P(`<h2>9. 四口の生の返り値</h2>
<p class="note"><b>ここで上の要約とこの JSON が一致することは、証拠ではない。</b> 内部の整合であって、木との突き合わせではない。</p>`);
/**
 * 生の返り値から、**木の事実でない物**を落とす。
 *   root     絶対経路を含む口が在る。機械をまたいで共有する頁に他人の置き場を刻まない
 *   session  走行の環境の id であって、測った木の性質ではない
 * **数と測定値は一つも落とさない。**
 */
const scrub = (d) => {
  if (!d || typeof d !== "object") return d;
  const { root, session, ...rest } = d;
  return rest;
};
// **全文は載せない。** 載せると頁が 157,500px になり、問題が数字ではなく量に埋もれる
// (実測: 撮影が 176 枚に割れた)。切り詰めたことは隠さず書き、全文の在り処を名指す。
const EXCERPT_LINES = 40;
for (const s of cap.surfaces ?? []) {
  const clean = s.status === "captured" ? scrub(s.data) : { status: s.status, reason: s.reason };
  const lines = JSON.stringify(clean, null, 1).split("\n");
  const shown = lines.slice(0, EXCERPT_LINES).join("\n");
  const cut = lines.length - EXCERPT_LINES;
  P(`<details><summary><code>${esc(s.schema_expected)}</code></summary>
<pre>${esc(shown)}</pre>
${cut > 0
    ? `<p class="note"><b>切り詰めた。</b> 残り ${num(cut, `${s.schema_expected} の返り値の行数 − 載せた ${EXCERPT_LINES} 行`, { derived: true })} 行は載せていない。
       <b>全文はこの木の <code>research/system-map/surfaces/surfaces.json</code> に在る</b>(この画面と同じ捕獲である)。</p>`
    : `<p class="note">全文である(${num(lines.length, `${s.schema_expected} の返り値の行数`, { derived: true })} 行)。</p>`}
</details>`);
}

// ---------- 節 10: 描かないこと ----------
section = "10 描かないこと";
P(`<h2>10. この画面が描かないこと</h2>
<ul>
<li><b>［画面］</b> <code>gold-model/</code> の手書きの模型を一行も読んでいない。混ざっていないことは機械が検める。</li>
<li><b>［木］</b> 意味モデルは ${num(has(models) ? arr(models).length : MISSING, "model-index/1 の models[] の長さ")} 件。口は走り、その数を返した。<b>そして、そのままである。</b></li>
<li><b>［画面］</b> 辺は front-matter の<b>宣言</b>である。実際にそう依存していることを、この画面も上流の道具も検めていない。</li>
<li><b>［画面］</b> 指紋は「印が在る」ことと「その時点の同一性」以上を言わない。そのコードが仕様を満たすことは測っていない。</li>
<li><b>［画面］</b> 「検査が走った」と言わない。名簿の大きさしか分からない（第 7 節）。</li>
<li><b>［画面］</b> <code>excluded</code> を「未到達」と言わない。届いた上で分類された物である（第 3 節）。</li>
<li><b>［画面］</b> 辺の種別を「語彙」と言わない。口は観測された種別しか返さない（第 5 節）。</li>
<li><b>［画面］</b> 所見の中身を読んでいない。件数を数えただけである（第 6 節）。</li>
<li><b>［画面］</b> 鮮度は構造上「不明」である。この頁は build 時の一点の像であり、履歴も傾向も増減も描かない。<b>開いた時点の木を、この画面は測っていない。</b></li>
<li><b>［画面］</b> 人による評価（H 層）は行っていない。${UNMEASURED}（0 ではない）。</li>
<li><b>［画面］</b> 次に何をすべきかを言わない。四つの口はいずれも優先度・期限・改善案を返さない。</li>
<li><b>［画面］</b> <b>この画面は「System Map が完成した」ことを一切示さない。</b> 第 1 節の数が減ることが仕事であり、いまその欄には上に書いた数が在る。</li>
</ul>
<p class="note">上の数はすべて、この build のときに捕えた読み口の返り値から導いている。
<b>綴りの中に測定値を書いていない</b> —— 書けば、書いたその日のうちに古びる。
<sup class="d">導</sup> の付いた数は、口が返した値ではなく画面が数えた導出である。</p>`);

P(`</body>\n</html>`);

const html = parts.join("\n");
sweepStale(outPath);
writeAtomic(outPath, html);
sweepStale(ledgerPath);
writeAtomic(ledgerPath, stringifyStable({
  schema: "system-map/number-ledger/1",
  source_revision: cap.source_revision ?? null,
  numbers: ledger,
}) + "\n");

// **閉じない内訳を黙って出荷しない。** 画面は「閉じていない」と描くが、段も判ずる。
const broken = closures.filter((c) => !c.ok);
for (const c of closures) console.log(`  ${c.ok ? "閉じた  " : "★閉じない"} ${c.name}: 和 ${c.sum} / 総数 ${c.total}`);
const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-V3", checker: "build:closures-hold", target: "index.html",
  examined: closures.length, examined_unit: "内訳の閉包",
  violations: broken.map((c) => ({ code: "screen.closure_broken", message: `${c.name}: 和 ${c.sum} が総数 ${c.total} に閉じない` })),
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "system-view", records);

console.log(`画面を書いた: ${outPath}`);
console.log(`  数の台帳: ${ledger.length} 件(うち導出 ${ledger.filter((l) => l.derived).length} 件) → ${ledgerPath}`);
console.log(`  鮮度: ${freshness}(この画面の構造では常にこれである)`);
process.exit(gateExitCode(records, today.date));
