// M-13 / M-14 の判定器。build.mjs と試験(test-gates.mjs / test-m13-browser.mjs)が共用する。
//
// 所有者判定(2026-08-04 #204 §6)に基づく M-14 の実判定:
// - 到達先は「実在する Code / Test / Evidence のアンカー」に限る(開ける URL を持つこと)。
//   provenance(出所)は到達先の代用にならない。
// - realized_by が指す anchor が無い・URL が無い/不正 = 壊れた参照 → FAIL。
// - 実現が意味上適用されない要素は、明示の not_applicable(理由つき)だけを認める。
//   どちらも無い「未登録」は FAIL。
// - 操作数は実際の UI の操作構造(uiStructure)から数える。負の試験は同じ計算経路に
//   「変更した画面遷移」を与えて落とす(判定器へ結果を直接渡さない)。

/** 実 UI の操作構造。index.html の画面遷移と一致させること(変えたらここも変える)。
 *  一致することは test-m14-browser.mjs が「実ブラウザの操作数」と突き合わせて確かめる。 */
export const UI_STRUCTURE = {
  drillOps: 1,     // 子要素は「内部を見る」で階層を降りてから選ぶ(親要素は 0)
  selectOps: 1,    // 図の箱を選ぶ → 詳細パネルが開く
  extraExpands: 0, // パネル内でリンクが見えるまでに要する展開の数(現 UI は 0 — 12 節は常時展開)
  linkClickOps: 1, // パネル内のリンクを開く
};

const isUrl = (s) => /^https?:\/\/\S+$/.test(s ?? "");

/** 要素の「実現・証拠」到達先を解決する。 */
export function resolveDestinations(model, e) {
  if (e.realization && e.realization.status === "not_applicable") {
    return { kind: "na", reason: e.realization.reason };
  }
  const broken = [];
  const links = [];
  for (const aid of e.realized_by ?? []) {
    const a = (model.anchors ?? []).find((x) => x.id === aid);
    if (!a) { broken.push(`anchor ${aid} が実在しない`); continue; }
    if (!isUrl(a.url)) { broken.push(`anchor ${aid} に開ける URL が無い`); continue; }
    links.push(a.url);
  }
  for (const c of model.contracts.filter((c) => c.subject === e.id)) {
    for (const ev of c.evidence ?? []) {
      if (isUrl(ev.ref)) links.push(ev.ref);
    }
  }
  if (broken.length) return { kind: "broken", detail: broken.join(" / ") };
  if (links.length) return { kind: "links", links };
  return { kind: "unregistered" };
}

/** M-14: 各要素の到達判定と最短操作数。ui に画面遷移の構造を与える(負の試験は深い構造を与える)。 */
export function computeOpsRows(models, ui = UI_STRUCTURE) {
  const rows = [];
  for (const m of models) {
    for (const e of m.elements) {
      const d = resolveDestinations(m, e);
      if (d.kind === "na") rows.push({ target: m.target, element: e.id, status: "not_applicable", ops: null, note: d.reason });
      else if (d.kind === "broken") rows.push({ target: m.target, element: e.id, status: "broken", ops: null, note: d.detail });
      else if (d.kind === "unregistered") rows.push({ target: m.target, element: e.id, status: "unregistered", ops: null, note: "実現・証拠が未登録(provenance は代用にならない)" });
      else {
        const drill = (e.parent ?? null) !== null ? ui.drillOps : 0; // 実操作: 子は先に内部へ降りる
        rows.push({ target: m.target, element: e.id, status: "reachable", ops: drill + ui.selectOps + ui.extraExpands + ui.linkClickOps, note: d.links[0] });
      }
    }
  }
  return rows;
}

/** M-14 の判定。壊れ・未登録・操作数超過が一件でもあれば例外(build を落とす)。 */
export function assertM14(rows, limit) {
  const bad = [];
  for (const r of rows) {
    if (r.status === "broken") bad.push(`壊れた参照: ${r.target}/${r.element} — ${r.note}`);
    if (r.status === "unregistered") bad.push(`未登録: ${r.target}/${r.element}`);
    if (r.status === "reachable" && r.ops > limit) bad.push(`${limit} 操作超過: ${r.target}/${r.element}(${r.ops})`);
  }
  if (bad.length) throw new Error("M-14 FAIL:\n  " + bad.join("\n  "));
  const reachable = rows.filter((r) => r.status === "reachable");
  return {
    max: Math.max(...reachable.map((r) => r.ops)),
    reachable: reachable.length,
    na: rows.filter((r) => r.status === "not_applicable").length,
  };
}

/** M-13(静的側): 生成物に実行時の外部読み取りの綴りが無いこと。実通信の検査は test-m13-browser.mjs。 */
export function checkNoRuntimeFetch(html) {
  return !/fetch\s*\(|XMLHttpRequest/.test(html);
}
