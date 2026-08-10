// 実在の記録へ patch を当てて、負の入力を作る。**記録を二度書かない。**
//
// なぜ要るか: 負例のために模型や overlay をもう一つ書くと、正本が二つになる。
// 片方だけ直した日に、負例は「もう存在しない形」を守り続ける —— 落ちないので
// 気付けない。だから負例は「実在の物 + 差分」で書く。
//
// **指す先が解けなければ例外で止まる。** 黙って飛ばすと、当たっていない patch が
// 「負例は通った」として数えられる。それは門が発火したことの証明にならない。

/**
 * 指す先を解く。`/elements/@id=lens/owner` のように、添字の代わりに
 * `@<欄>=<値>` で指せる。**添字で指すと、並べ替えた日に別の物を潰す。**
 */
export function locate(root, path) {
  const parts = path.split("/").filter(Boolean);
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = resolveKey(node, parts[i], path);
    node = node[key];
    if (node === undefined) throw new Error(`指す先が解けない: ${path}(${parts[i]} で止まった)`);
  }
  const last = parts[parts.length - 1];
  return { parent: node, key: last === "-" ? "-" : resolveKey(node, last, path, true) };
}

export function resolveKey(node, part, path, allowMissing = false) {
  if (part.startsWith("@")) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new Error(`指す先の形が違う: ${part}`);
    const field = part.slice(1, eq);
    const want = part.slice(eq + 1);
    if (!Array.isArray(node)) throw new Error(`${part} は配列にしか使えない: ${path}`);
    const i = node.findIndex((x) => String(x?.[field]) === want);
    if (i < 0) throw new Error(`指す先が解けない: ${path}(${field}=${want} が無い)`);
    return i;
  }
  if (Array.isArray(node)) {
    const i = Number(part);
    if (!Number.isInteger(i) || i < 0 || i >= node.length) throw new Error(`指す先が解けない: ${path}(添字 ${part})`);
    return i;
  }
  if (!allowMissing && !(part in node)) throw new Error(`指す先が解けない: ${path}(${part} が無い)`);
  return part;
}

/** 写しへ差分を当てて返す。元の物には触れない。 */
export function applyPatch(doc, patch) {
  const out = JSON.parse(JSON.stringify(doc));
  for (const op of patch) {
    const { parent, key } = locate(out, op.path);
    if (op.op === "remove") {
      if (Array.isArray(parent)) parent.splice(key, 1);
      else {
        if (!(key in parent)) throw new Error(`消す先が無い: ${op.path}`);
        delete parent[key];
      }
    } else if (op.op === "replace") {
      if (!Array.isArray(parent) && !(key in parent)) throw new Error(`置く先が無い: ${op.path}`);
      parent[key] = op.value;
    } else if (op.op === "add") {
      if (key === "-") { if (!Array.isArray(parent)) throw new Error(`足す先が配列でない: ${op.path}`); parent.push(op.value); }
      else parent[key] = op.value;
    } else throw new Error(`知らない操作: ${op.op}`);
  }
  return out;
}
