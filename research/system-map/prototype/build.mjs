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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeOpsRows, assertM14, checkNoRuntimeFetch } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gm = (f) => JSON.parse(readFileSync(join(here, "..", "gold-model", f), "utf8"));
const models = [
  gm("target-1-doctrine-and-lens.json"),
  gm("target-2-lens-shipping.json"),
  gm("target-3-celery.json"),
  gm("fixture-rare-states.json"), // 架空。H 層 T6(希少状態の読み分け)専用
];

// ---- M-14 の機械判定(build 時) ----
// 判定器は gates.mjs。発火することは test-gates.mjs の負の試験が確かめる。
const m14 = computeOpsRows(models);
const { max: m14max } = assertM14(m14, 3);

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
  .neg { color: #8a6d3b; }
  .legend { font-size: 14px; color: #555; margin-top: .3rem; }
  .opcount { position: fixed; right: .8rem; bottom: .8rem; background: #f4f4f4; border: 1px solid #ccc; padding: .25rem .6rem; font-size: 13px; }
  footer { padding: .6rem 1rem; border-top: 1px solid #ccc; font-size: 13px; color: #666; }
  a { color: #0b57a4; }
</style>
</head>
<body>
<div class="banner">全値は候補(<b>proposed</b>)であり正本表示ではない — この注記が全項に適用される(各項では繰り返さない)。正本は issue 204 の合意台帳と各値の出所。</div>
<header>
  <label>対象: <select id="target"></select></label>
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
let ti = 0, view = "system", focusEl = null, drill = null;
const drillStack = [];
let ops = 0;
const bump = () => { ops++; document.getElementById("ops").textContent = ops; };
document.getElementById("opreset").onclick = () => { ops = 0; document.getElementById("ops").textContent = 0; };

const tsel = document.getElementById("target");
MODELS.forEach((m, i) => tsel.add(new Option(m.target, i)));
tsel.onchange = () => { ti = +tsel.value; focusEl = null; drill = null; drillStack.length = 0; bump(); render(); };
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  view = b.dataset.v; focusEl = null; drill = null; drillStack.length = 0; bump();
  document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const M = () => MODELS[ti];
const el = (id) => M().elements.find((e) => e.id === id);
const anchor = (id) => (M().anchors ?? []).find((a) => a.id === id);
const stBadge = (s) => '<span class="st st-' + s + '">' + s + "</span>";
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
  const realizedLinks = (e.realized_by ?? []).map((aid) => {
    const a = anchor(aid);
    if (!a) return '<li class="neg">壊れた参照: ' + esc(aid) + "</li>";
    const label = esc(a.target) + "(" + esc(a.source_revision).slice(0, 12) + ")";
    return a.url ? '<li><a href="' + esc(a.url) + '" target="_blank">' + label + "</a></li>" : "<li>" + label + "(url なし)</li>";
  }).join("");
  const evidenceLinks = cs.flatMap((c) => (c.evidence ?? []).map((ev) => ({ c, ev })));
  return \`<button id="close" title="閉じる">×</button>
    <h2>\${esc(e.name)}</h2>
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
    \${e.realization ? '<p class="small">対象外: ' + esc(e.realization.reason) + "</p>" : ""}
    \${realizedLinks ? "<ul>" + realizedLinks + "</ul>" : ""}
    \${evidenceLinks.length ? evidenceLinks.map((x) => evRows([x.ev])).join("") : ""}
    \${!e.realization && !realizedLinks && !evidenceLinks.length ? none : ""}\`;
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
  const BH = 175, GXROW = 44, GYLAYER = 72, PAD = 16, LANE = 240;
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
    return \`<g data-el="\${e.id}" style="cursor:pointer">
      <rect x="\${p.x}" y="\${p.y}" width="\${BW}" height="\${BH}" fill="\${sel ? "#eaf1ff" : "#fff"}" stroke="#222" stroke-width="\${sel ? 3 : 1.5}" \${e.kind === "external_system" ? 'stroke-dasharray="6 4"' : ""}/>
      <foreignObject x="\${p.x + 8}" y="\${p.y + 6}" width="\${BW - 16}" height="\${BH - 12}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:14px; line-height:1.4; overflow:hidden; height:100%">
          <div style="font-size:16px; font-weight:700">\${esc(e.name)}</div>
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
  const edges = flows.map((f) => {
    const a = pos[f.from], b = pos[f.to];
    const key = [f.from, f.to].sort().join("|");
    const off = (pairSeen[key] = (pairSeen[key] ?? -1) + 1) * 22;
    const fb = !!f.feedback_for;
    const down = a.y < b.y, sameLayer = a.y === b.y;
    const span = Math.abs(Math.round((b.y - a.y) / (BH + GYLAYER)));
    const full = (fb ? "↩ " : "") + f.label + "(" + f.kind + ")";
    let label = full.length > 20 ? full.slice(0, 19) + "…" : full;
    let path, lx, ly, anchorAttr = 'text-anchor="middle"';
    if (sameLayer) {
      const x1 = a.x + BW, x2 = b.x, ym = a.y + BH / 2 + off;
      path = \`M \${x1} \${ym} C \${(x1 + x2) / 2} \${ym - 30}, \${(x1 + x2) / 2} \${ym - 30}, \${x2} \${ym}\`;
      lx = (x1 + x2) / 2; ly = ym - 34;
    } else if (fb || span >= 2) {
      // 右レーンで迂回し、到達先の上の隙間から入る(他の箱を横切らない)
      const x1 = a.x + BW, y1 = a.y + BH / 2 + off;
      const xl = laneX + (fb ? 26 : 0) + off;
      const yTop = b.y - 26 - off / 2;
      const xEnd = b.x + BW * 0.72 + off;
      path = \`M \${x1} \${y1} C \${xl} \${y1}, \${xl} \${y1}, \${xl} \${yTop} L \${xEnd} \${yTop} L \${xEnd} \${b.y}\`;
      label = full.length > 14 ? full.slice(0, 13) + "…" : full;
      lx = xl + 6; ly = (y1 + yTop) / 2; anchorAttr = 'text-anchor="start"';
    } else {
      // 隣接層への縦の流れ。ラベルは到達先の直前(到達先ごとに散り、衝突しない)
      const x1 = a.x + BW / 2 + off, x2 = b.x + BW / 2 + off;
      const y1 = down ? a.y + BH : a.y, y2 = down ? b.y : b.y + BH;
      const my = (y1 + y2) / 2;
      path = \`M \${x1} \${y1} C \${x1} \${my}, \${x2} \${my}, \${x2} \${y2}\`;
      lx = x2; ly = down ? y2 - 8 : y2 + 17;
    }
    return \`<path d="\${path}" fill="none" stroke="#444" stroke-width="1.4" \${fb ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#arr)"><title>\${esc(full)}</title></path>
      <text x="\${lx}" y="\${ly}" font-size="13" \${anchorAttr} fill="#333" paint-order="stroke" stroke="#fff" stroke-width="4"><title>\${esc(full)}</title>\${esc(label)}</text>\`;
  }).join("");

  return \`<svg viewBox="0 0 \${W} \${H}" width="\${W}" style="max-width:100%; height:auto; border:1px solid #ddd; background:#fff; display:block; margin:0 auto">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#444"/></marker></defs>
    \${edges}\${boxes}
  </svg>
  <div class="legend">実線枠 = 内部 / 破線枠 = 外部システム / 破線辺 ↩ = フィードバック。辺は全て正本の Flow(名前+種類つき)。層は Flow の向きから導出。</div>\`;
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
  return \`<div class="q">この画面の一問: このシステムは何のために存在し、何から構成され、外部の誰と何をやり取りするか</div>
    \${crumb}
    \${diagram(tops, flows)}
    \${flows.length === 0 ? '<p class="small">この階層の内側に閉じた流れは記録されていない(記録が無いのであって「無い」の確定ではない)。</p>' : ""}
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
  const order = ["failed", "stale", "unknown", "claimed", "planned", "verified", "not_applicable"];
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
      \${M14.rows.map((r) => \`<tr><td>\${esc(r.target)}</td><td>\${esc(r.element)}</td><td>\${r.status === "reachable" ? "到達可" : r.status === "not_applicable" ? "対象外" : esc(r.status)}</td><td class="small">\${r.ops ?? ""}\${r.status === "not_applicable" ? esc(r.note) : ""}</td></tr>\`).join("")}
    </table>
    <p class="small">操作数の定義は台帳 v3.2-16。右下の計数器は H 層試験(O 層観測)用。</p>\`;
}

function render() {
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
if (!checkNoRuntimeFetch(html)) {
  console.error("M-13 FAIL: 生成物に実行時の外部読み取り(fetch/XHR)が在る");
  process.exit(1);
}

writeFileSync(join(here, "index.html"), html);
console.log("index.html を生成した。M-14 最大操作数:", m14max, "/ M-13: 外部読み取りなし");
