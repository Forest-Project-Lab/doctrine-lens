// M-13 / M-14 の判定器。build.mjs と test-gates.mjs の両方から使う。
//
// 所有者判断(2026-08-04)「M-13/M-14 の発火可能な負の試験を修正する」に基づき、
// 判定を関数へ切り出した。発火することは test-gates.mjs が負の入力で確かめる
// (発火が確認されていない門を緑と呼ばない — lens ADR-024 と同じ規律)。

/** M-14: 各要素の「コードまたは証拠」への最短操作数を UI の操作構造から数える。 */
export function computeOpsRows(models) {
  const rows = [];
  for (const m of models) {
    for (const e of m.elements) {
      const contracts = m.contracts.filter((c) => c.subject === e.id);
      let ops;
      if (contracts.some((c) => (c.evidence ?? []).length > 0)) ops = 3; // 選ぶ→契約を開く→証拠
      else if ((e.realized_by ?? []).length > 0) ops = 2;                // 選ぶ→anchor
      else if (contracts.length > 0) ops = 2;                            // 選ぶ→契約(証拠なしの明示)
      else ops = 2;                                                      // 選ぶ→出所(provenance は必須項)
      rows.push({ target: m.target, element: e.id, ops });
    }
  }
  return rows;
}

/** M-14 の判定。超過が一件でもあれば例外(build を落とす)。 */
export function assertM14(rows, limit) {
  const over = rows.filter((r) => r.ops > limit);
  if (over.length > 0) {
    throw new Error(
      `M-14 FAIL: ${limit} 操作を超える要素がある — ` +
      over.map((r) => `${r.target}/${r.element}(${r.ops})`).join(", "),
    );
  }
  return { max: Math.max(...rows.map((r) => r.ops)), count: rows.length };
}

/** M-13: 生成物に実行時の外部読み取り(fetch / XMLHttpRequest)が無いこと。 */
export function checkNoRuntimeFetch(html) {
  return !/fetch\s*\(|XMLHttpRequest/.test(html);
}
