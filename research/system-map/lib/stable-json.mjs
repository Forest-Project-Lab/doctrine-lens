// 同じ入力からは同じ byte を出す直列化。
//
// なぜ要るか: 成果物が入力以外の物に依る限り、「同じ入力から同じ物が出る」を
// 主張できない。以前は overlay が壁時計の日付を持ち、生成物には環境変数が
// 焼き込まれていた —— 同じ原資から違う物が commit されうる状態だった。
//
// 鍵の順は「現れた順」ではなく **並べ替えた順**にする。作る側の書き方が変わっても
// 出る物が変わらないようにするためである。配列の順は意味を持つので触らない
// (呼ぶ側が並べてから渡す)。
export function stringifyStable(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
