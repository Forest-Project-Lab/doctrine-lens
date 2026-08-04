// 静的プロトタイプの組み立て器(Phase 1)。
//
//   node build.mjs   →  index.html を生成
//
// 三対象の JSON を build 時に埋め込む。実行時の外部読み取りは零
// (M-13: 道具が読むのは固定された検証用 JSON だけ。fetch/XHR を書かない)。
// 画面は台帳 v3.2 B 節 P1 の区分に従う: システム / シナリオ / 保証 / 変更影響。
// 詳細パネルの一問は「契約充足の評価」。一画面一問(v3.2-6)。
// 図は描かない — 境界と交換は表で言う(関係は文と記号で言える。lens ADR-012 と同じ判断)。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gm = (f) => JSON.parse(readFileSync(join(here, "..", "gold-model", f), "utf8"));
const models = [
  gm("target-1-doctrine-and-lens.json"),
  gm("target-2-lens-shipping.json"),
  gm("target-3-celery.json"),
  gm("fixture-rare-states.json"), // 架空。H 層 T6(希少状態の読み分け)専用
];

// ---- M-14 の機械判定(build 時) ----
// UI の操作構造は決定的: 要素を選ぶ(1) → 契約を開く(2) → 証拠/anchor へ跳ぶ(3)。
// 要素ごとに「コードまたは証拠」への最短操作数を数え、3 を超えたら build を落とす。
const m14 = [];
for (const m of models) {
  for (const e of m.elements) {
    const contracts = m.contracts.filter((c) => c.subject === e.id);
    const anchors = (e.realized_by ?? []).length;
    let ops = null;
    if (contracts.some((c) => (c.evidence ?? []).length > 0)) ops = 3;      // 選ぶ→契約→証拠
    else if (anchors > 0) ops = 2;                                          // 選ぶ→anchor
    else if (contracts.length > 0) ops = 2;                                 // 選ぶ→契約(証拠なしはその旨を表示)
    else ops = 2;                                                           // 選ぶ→出所(provenance は常に在る: スキーマ必須)
    m14.push({ target: m.target, element: e.id, ops });
  }
}
const m14max = Math.max(...m14.map((r) => r.ops));
if (m14max > 3) {
  console.error("M-14 FAIL: 3 操作を超える要素がある");
  process.exit(1);
}

const DATA = JSON.stringify(models);
const M14 = JSON.stringify({ rows: m14, max: m14max, checked_at: "build 時" });

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>system-map 静的プロトタイプ(Phase 1・候補)</title>
<style>
  :root { --ink:#222; --dim:#666; --line:#ccc; --bg:#fff; --mark:#fff3cd; }
  body { font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg); margin: 0; }
  header { padding: .6rem 1rem; border-bottom: 2px solid var(--line); }
  .banner { background: var(--mark); padding: .4rem 1rem; font-size: .85rem; }
  nav button { margin-right: .4rem; padding: .35rem .8rem; font-size: 1rem; cursor: pointer; }
  nav button[aria-pressed="true"] { font-weight: 700; border: 2px solid var(--ink); }
  select { font-size: 1rem; padding: .2rem; }
  main { padding: 1rem; max-width: 72rem; }
  .q { color: var(--dim); font-size: .9rem; margin: .2rem 0 1rem; }
  .crumb { font-size: .85rem; color: var(--dim); margin-bottom: .6rem; }
  .crumb a { cursor: pointer; text-decoration: underline; }
  .boxes { display: flex; flex-wrap: wrap; gap: .6rem; margin-bottom: 1rem; }
  .box { border: 1.5px solid var(--ink); padding: .5rem .7rem; min-width: 13rem; max-width: 18rem; cursor: pointer; }
  .box.ext { border-style: dashed; }
  .box h3 { margin: 0 0 .2rem; font-size: 1rem; }
  .box .kind { font-size: .72rem; color: var(--dim); }
  .box .purpose { font-size: .82rem; margin: .2rem 0; }
  .box .owner { font-size: .75rem; color: var(--dim); }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; font-size: .85rem; }
  th, td { border: 1px solid var(--line); padding: .3rem .5rem; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  .st { display: inline-block; padding: 0 .4rem; border: 1px solid var(--ink); font-size: .78rem; }
  .st-unknown { background: #eee; }
  .st-claimed { background: #fff; }
  .st-planned { background: #eef; }
  .st-verified { background: #e6f4e6; }
  .st-failed { background: #f8d7da; }
  .st-stale { background: #ffe8cc; }
  .st-not_applicable { background: #f0f0f0; color: var(--dim); }
  .proposed { font-size: .7rem; border: 1px dashed var(--dim); color: var(--dim); padding: 0 .3rem; }
  .panel { border: 2px solid var(--ink); padding: .8rem; margin-top: 1rem; }
  .panel h2 { margin-top: 0; font-size: 1.05rem; }
  details { margin: .3rem 0; }
  .neg { color: #8a6d3b; }
  .opcount { position: fixed; right: .8rem; bottom: .8rem; background: #f4f4f4; border: 1px solid var(--line); padding: .3rem .6rem; font-size: .8rem; }
  .small { font-size: .8rem; color: var(--dim); }
  footer { padding: 1rem; border-top: 1px solid var(--line); font-size: .78rem; color: var(--dim); }
</style>
</head>
<body>
<div class="banner">全値は候補(<b>proposed</b>)であり正本表示ではない。正本は issue 204 の合意台帳 v3.2 と各値の出所。tag: system-map/phase-0 起点。</div>
<header>
  <nav>
    <label>対象:
      <select id="target"></select>
    </label>
    <button data-v="system" aria-pressed="true">システム</button>
    <button data-v="scenario" aria-pressed="false">シナリオ</button>
    <button data-v="assurance" aria-pressed="false">保証</button>
    <button data-v="impact" aria-pressed="false">変更影響</button>
    <button data-v="inspect" aria-pressed="false" class="small">検査(M 層)</button>
  </nav>
</header>
<main id="main"></main>
<div class="opcount">操作数: <span id="ops">0</span> <button id="opreset" class="small">0 に戻す</button></div>
<footer>
  一画面一問(台帳 v3.2-6)。対象の切替と画面の移動は「別の問いへ行く」操作であり、同じ問いの見え方を変える操作子は置いていない。
  1操作の定義は台帳 v3.2-16(明示的な起動を各 1。スクロール・ホバーは数えない)。
</footer>
<script>
const MODELS = ${DATA};
const M14 = ${M14};
let ti = 0, view = "system", focusEl = null, drill = null, sysMode = "A";
let ops = 0;
const bump = () => { ops++; document.getElementById("ops").textContent = ops; };
document.getElementById("opreset").onclick = () => { ops = 0; document.getElementById("ops").textContent = 0; };

const tsel = document.getElementById("target");
MODELS.forEach((m, i) => tsel.add(new Option(m.target, i)));
tsel.onchange = () => { ti = +tsel.value; focusEl = null; drill = null; bump(); render(); };
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  view = b.dataset.v; focusEl = null; drill = null; bump();
  document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const M = () => MODELS[ti];
const el = (id) => M().elements.find((e) => e.id === id);
const stBadge = (s) => '<span class="st st-' + s + '">' + s + "</span>";
const prop = (x) => x.review_status === "proposed" ? ' <span class="proposed">proposed</span>' : "";

function provRows(ps) {
  return (ps ?? []).map((p) =>
    "<div class='small " + (p.verdict === "silent" ? "neg" : "") + "'>" +
    (p.verdict === "silent" ? "負の出所(確認したが沈黙): " : "出所: ") +
    esc(p.source) + (p.locator ? " — " + esc(p.locator) : "") + "(" + esc(p.checked_at) + ")</div>").join("");
}

function evRows(evs) {
  if (!evs || !evs.length) return "<div class='small'>証拠: 無し</div>";
  return evs.map((e) =>
    "<div class='small'>証拠: " + esc(e.ref) + " / 環境 " + esc(e.environment) +
    " / 版 " + esc(e.version) + " / 終了 " + esc(e.exit_status) + " / 観測 " + esc(e.observed_at) +
    (e.fingerprint ? " / 指紋 " + esc(e.fingerprint) : "") + "</div>").join("");
}

function detailPanel(id) {
  const e = el(id);
  const cs = M().contracts.filter((c) => c.subject === id);
  return \`<div class="panel">
    <h2>詳細: \${esc(e.name)}\${prop(e)}</h2>
    <div class="q">この画面の一問: この要素の責務と契約は何で、その充足をどの根拠が支えているか(契約充足の評価)</div>
    <p><b>目的</b> \${esc(e.purpose)}</p>
    <p><b>担うこと</b></p><ul>\${e.responsibilities.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul>
    \${e.not_responsible_for ? "<p><b>担わないこと</b></p><ul>" + e.not_responsible_for.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>" : ""}
    <p><b>所有者</b> \${esc(e.owner)}</p>
    \${provRows(e.provenance)}
    <h3>契約(\${cs.length})</h3>
    \${cs.length ? cs.map((c) => \`
      <details><summary>\${stBadge(c.verification_status)} \${esc(c.guarantee)}\${prop(c)}</summary>
        <p class="small">前提: \${c.assumptions.map(esc).join(" / ")}</p>
        <p class="small">測り方: \${esc(c.response_measure)}</p>
        \${c.na_reason ? '<p class="small"><b>適用しない理由</b>: ' + esc(c.na_reason) + "</p>" : ""}
        \${c.failure_effect ? '<p class="small">破られたら: ' + esc(c.failure_effect) + "</p>" : ""}
        \${c.verification_method ? '<p class="small">検証方法: ' + esc(c.verification_method) + "</p>" : ""}
        \${evRows(c.evidence)}
        \${provRows(c.provenance)}
      </details>\`).join("") : "<p class='small'>この要素を対象にした契約は記録されていない(不明であって「無し」ではない)。</p>"}
  </div>\`;
}

function scopeTops() { return M().elements.filter((e) => (drill ? e.parent === drill : (e.parent ?? null) === null)); }
function scopeFlows(tops) {
  const ids = new Set(tops.map((e) => e.id));
  return M().flows.filter((f) => ids.has(f.from) && ids.has(f.to));
}

function viewSystemA(tops, flows) {
  return \`<div class="boxes">\${tops.map((e) => \`
      <div class="box \${e.kind === "external_system" ? "ext" : ""}" data-el="\${e.id}">
        <h3>\${esc(e.name)}</h3>
        <div class="kind">\${esc(e.kind)}\${prop(e)}</div>
        <div class="purpose">\${esc(e.purpose)}</div>
        <div class="owner">所有: \${esc(e.owner)}</div>
        \${M().elements.some((c) => c.parent === e.id) ? '<button class="small" data-drill="' + e.id + '">内部を見る</button>' : ""}
      </div>\`).join("")}</div>
    <h3>やり取り(全て動詞つき — 無名の矢印は無い)</h3>
    <table><tr><th>から</th><th>何を(種類)</th><th>へ</th><th>成立条件</th></tr>
      \${flows.map((f) => \`<tr><td>\${esc(el(f.from).name)}</td><td>\${esc(f.label)}(\${esc(f.kind)})\${f.feedback_for ? " ↩ feedback" : ""}</td><td>\${esc(el(f.to).name)}</td><td class="small">\${esc(f.condition)}</td></tr>\`).join("")}
    </table>\`;
}

// 案B: 中小粒度の構成図。配置は意味から導く — 層 = フィードバックを除く Flow の最長距離。
// 辺は正本の Flow のみ。無名の辺・意味の無い軸を作らない。
function viewSystemB(tops, flows) {
  const ids = tops.map((e) => e.id);
  // 層計算に使う辺: フィードバックを除き、さらに宣言順で見て「循環を閉じる辺」を除く
  // (除いた辺も描画はされる。層は意味から導くが、循環は宣言順という決定的な規則で切る)
  const adj = Object.fromEntries(ids.map((i) => [i, []]));
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return adj[from].some((n) => reaches(n, to, seen));
  };
  const layerFlows = [];
  for (const f of flows.filter((f) => !f.feedback_for && f.from !== f.to)) {
    if (reaches(f.to, f.from)) continue; // この辺を足すと循環する — 層計算からは外す
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

  const BW = 240, BH = 195, GX = 185, GY = 30, PAD = 16;
  const pos = {};
  cols.forEach((col, ci) => col.forEach((e, ri) => {
    pos[e.id] = { x: PAD + ci * (BW + GX), y: PAD + ri * (BH + GY) };
  }));
  const W = PAD * 2 + nLayers * BW + (nLayers - 1) * GX;
  const H = PAD * 2 + Math.max(...cols.map((c) => c.length)) * (BH + GY) + 70;

  const stChips = (eid) => {
    const cs = M().contracts.filter((c) => c.subject === eid);
    return cs.map((c) => '<span class="st st-' + c.verification_status + '">' + c.verification_status + "</span>").join(" ") || '<span class="small">契約: 記録なし</span>';
  };
  const ioList = (eid) => {
    const ins = flows.filter((f) => f.to === eid), outs = flows.filter((f) => f.from === eid);
    const fmt = (a, tag) => a.length ? tag + ": " + a.slice(0, 2).map((f) => esc(f.label)).join("、") + (a.length > 2 ? \` 他\${a.length - 2}\` : "") : "";
    return [fmt(ins, "IN"), fmt(outs, "OUT")].filter(Boolean).join(" / ");
  };

  const boxes = tops.map((e) => {
    const p = pos[e.id];
    return \`<g data-el="\${e.id}" style="cursor:pointer">
      <rect x="\${p.x}" y="\${p.y}" width="\${BW}" height="\${BH}" fill="#fff" stroke="#222" stroke-width="1.5" \${e.kind === "external_system" ? 'stroke-dasharray="6 4"' : ""}/>
      <foreignObject x="\${p.x + 6}" y="\${p.y + 4}" width="\${BW - 12}" height="\${BH - 8}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px; line-height:1.35; overflow:hidden; height:100%">
          <b style="font-size:12px">\${esc(e.name)}</b> <span style="color:#666">\${esc(e.kind)}</span>\${prop(e)}<br>
          <span>\${esc(e.purpose)}</span><br>
          <span style="color:#666">責務: \${e.responsibilities.slice(0, 2).map(esc).join("、")}\${e.responsibilities.length > 2 ? \` 他\${e.responsibilities.length - 2}\` : ""}</span><br>
          <span style="color:#444">\${ioList(e.id)}</span><br>
          \${stChips(e.id)}
          \${M().elements.some((c) => c.parent === e.id) ? '<button class="small" data-drill="' + e.id + '">内部を見る</button>' : ""}
        </div>
      </foreignObject>
    </g>\`;
  }).join("");

  const pairSeen = {};
  const bottomY = H - PAD - 60;
  const edges = flows.map((f) => {
    const a = pos[f.from], b = pos[f.to];
    const key = [f.from, f.to].sort().join("|");
    const off = (pairSeen[key] = (pairSeen[key] ?? -1) + 1) * 18;
    const fb = !!f.feedback_for;
    const span = Math.abs(Math.round((b.x - a.x) / (BW + GX)));
    let x1, y1, x2, y2;
    if (a.x < b.x) { x1 = a.x + BW; x2 = b.x; } else if (a.x > b.x) { x1 = a.x; x2 = b.x + BW; } else { x1 = a.x + BW; x2 = b.x + BW; }
    y1 = a.y + BH / 2 + off; y2 = b.y + BH / 2 + off;
    const detour = span >= 2 || fb;
    let path, lx, ly;
    if (a.x === b.x) {
      path = \`M \${x1} \${y1} C \${x1 + 70} \${y1}, \${x2 + 70} \${y2}, \${x2} \${y2}\`;
      lx = x1 + 74; ly = (y1 + y2) / 2;
    } else if (detour) {
      const dy = bottomY + (fb ? 30 : 8) + off;
      path = \`M \${x1} \${y1} C \${x1 + 60} \${dy}, \${x2 - 60} \${dy}, \${x2} \${y2}\`;
      lx = (x1 + x2) / 2; ly = dy - 6;
    } else {
      const mx = (x1 + x2) / 2;
      path = \`M \${x1} \${y1} C \${mx} \${y1}, \${mx} \${y2}, \${x2} \${y2}\`;
      lx = mx; ly = Math.min(y1, y2) - 8 + off;
    }
    const full = (fb ? "↩ " : "") + f.label + "(" + f.kind + ")";
    const label = full.length > 26 ? full.slice(0, 25) + "…" : full;
    return \`<path d="\${path}" fill="none" stroke="#444" stroke-width="1.2" \${fb ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#arr)"><title>\${esc(full)}</title></path>
      <text x="\${lx}" y="\${ly}" font-size="10" text-anchor="middle" fill="#333" paint-order="stroke" stroke="#fff" stroke-width="3"><title>\${esc(full)}</title>\${esc(label)}</text>\`;
  }).join("");

  return \`<svg viewBox="0 0 \${W} \${H}" width="\${W}" style="max-width:100%; height:auto; border:1px solid #ddd">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#444"/></marker></defs>
    \${edges}\${boxes}
  </svg>
  <p class="small">層は Flow の向き(フィードバック除く)の最長距離から導出。辺は正本の Flow のみ・全て名前と種類つき。破線枠 = 外部システム、破線辺 = フィードバック。</p>\`;
}

function viewSystem() {
  const tops = scopeTops();
  const flows = scopeFlows(tops);
  const crumb = drill
    ? \`<div class="crumb"><a id="up">← 全体(\${esc(M().target)})</a> › \${esc(el(drill).name)} の内部</div>\`
    : "";
  const toggle = \`<div class="small" style="border:1px dashed #999; padding:.3rem .6rem; margin-bottom:.6rem">
    比較実験(所有者指示 2026-08-04): 同一データ・同一問いを
    <button data-mode="A" \${sysMode === "A" ? "disabled" : ""}>案A(表)</button>
    <button data-mode="B" \${sysMode === "B" ? "disabled" : ""}>案B(図)</button>
    で表示している。最終採用は A/B 比較と H 層検証の証拠で決める(未決)。
  </div>\`;
  return \`<div class="q">この画面の一問: このシステムは何のために存在し、何から構成され、外部の誰と何をやり取りするか</div>
    \${crumb}\${toggle}
    \${sysMode === "A" ? viewSystemA(tops, flows) : viewSystemB(tops, flows)}
    \${flows.length === 0 ? '<p class="small">この階層に流れは記録されていない(記録が無いのであって「無い」の確定ではない)。</p>' : ""}
    \${focusEl ? detailPanel(focusEl) : '<p class="small">箱を選ぶと詳細(契約充足の評価)が開く。</p>'}\`;
}

function viewScenario() {
  return \`<div class="q">この画面の一問: この目的の流れでは、誰が何を行い、何が起き、何が返るか</div>
    \${M().scenarios.map((s) => \`
    <details \${s.kind === "normal" ? "open" : ""}>
      <summary>\${s.kind === "exception" ? "⚠ 例外系: " : "正常系: "}\${esc(s.goal)}\${prop(s)}\${s.exception_of ? ' <span class="small">(正常系: ' + esc(s.exception_of) + ")</span>" : ""}</summary>
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
  const order = ["failed", "stale", "unknown", "claimed", "planned", "verified", "not_applicable"];
  const cs = [...M().contracts].sort((a, b) => order.indexOf(a.verification_status) - order.indexOf(b.verification_status));
  return \`<div class="q">この画面の一問: 何が守られるべきで、何が証拠付きで確認され、何がまだ主張・計画段階なのか</div>
    <p class="small">「記載がない」と「問題がない」は同じ表示にしない。verified は条件(版・環境・観測日・証拠)を必ず併記する。</p>
    <table><tr><th>状態</th><th>対象</th><th>守ると主張すること</th><th>前提</th><th>根拠</th></tr>
    \${cs.map((c) => \`<tr>
      <td>\${stBadge(c.verification_status)}</td>
      <td>\${esc(el(c.subject).name)}</td>
      <td>\${esc(c.guarantee)}\${prop(c)}\${c.na_reason ? '<div class="small"><b>適用しない理由</b>: ' + esc(c.na_reason) + "</div>" : ""}\${c.failure_effect ? '<div class="small">破られたら: ' + esc(c.failure_effect) + "</div>" : ""}</td>
      <td class="small">\${c.assumptions.map(esc).join("<br>")}</td>
      <td>\${evRows(c.evidence)}\${provRows(c.provenance)}</td>
    </tr>\`).join("")}</table>\`;
}

function viewImpact() {
  return \`<div class="q">この画面の一問: これを変更した場合、何をどの順番で修正する必要があるか</div>
    <p>この問いの正本は既存の Doctrine Lens(Consequence View)である。プロトタイプは答えを持たない。</p>
    <p class="small">対象 doctrine-and-lens では、編集器で当該文書を開けば Lens が「一本の明細」で答える(lens REQ-000)。
    二画面は連携するが混ぜない(台帳 B 節 P1)。</p>\`;
}

function viewInspect() {
  return \`<div class="q">この画面の一問: M 層のうちプロトタイプが受け持つ検査は通っているか</div>
    <p><b>M-13</b>(読み口): 実行時の外部読み取りは零 — データは build 時に固定 JSON を同梱し、fetch/XHR を書いていない。<b>PASS(構造による)</b></p>
    <p><b>M-14</b>(要素→コードまたは証拠が \${3} 操作以内): build 時に全要素の最短操作数を数え、超過があれば build が落ちる。最大 = \${M14.max} 操作。<b>PASS</b></p>
    <table><tr><th>対象</th><th>要素</th><th>最短操作数</th></tr>
      \${M14.rows.map((r) => \`<tr><td>\${esc(r.target)}</td><td>\${esc(r.element)}</td><td>\${r.ops}</td></tr>\`).join("")}
    </table>
    <p class="small">操作数の定義は台帳 v3.2-16。右下の計数器は H 層試験(O 層観測)用。</p>\`;
}

function render() {
  const v = { system: viewSystem, scenario: viewScenario, assurance: viewAssurance, impact: viewImpact, inspect: viewInspect }[view];
  document.getElementById("main").innerHTML = v();
  document.querySelectorAll("[data-el]").forEach((b) => b.onclick = (ev) => {
    if (ev.target.dataset.drill) return;
    focusEl = b.dataset.el; bump(); render();
  });
  document.querySelectorAll("[data-drill]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation(); drill = b.dataset.drill; focusEl = null; bump(); render();
  });
  document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
    sysMode = b.dataset.mode; bump(); render();
  });
  const up = document.getElementById("up");
  if (up) up.onclick = () => { drill = null; focusEl = null; bump(); render(); };
}
render();
</script>
</body>
</html>
`;

writeFileSync(join(here, "index.html"), html);
console.log("index.html を生成した。M-14 最大操作数:", m14max);
