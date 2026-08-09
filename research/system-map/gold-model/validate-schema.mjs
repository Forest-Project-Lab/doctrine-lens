// `schema.json` を**実行する**。
//
// なぜ要るか: `schema.json` は一度も実行されていなかった。`required` も `enum` も
// `minItems` も、書いてあるだけで誰も検めていない。`validate.mjs` はそれとは別の、
// より小さい部分集合を手書きしていた —— 二重定義であり、片方だけが動く。
//
// `strict: true` で回す。**未知のキーワードを黙って飛ばさない**(既定は飛ばす)。
// 飛ばすと、綴りを誤った制約が「書いてあるのに効かない」まま残る。
//
// ajv は devDependencies に置く。実行時の依存はゼロのままで、配布物にも入らない。
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMA } from "./spec.mjs";

const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

let compiled;
try {
  compiled = ajv.compile(SCHEMA);
} catch (e) {
  // スキーマ自身が壊れているのを「所見なし」にしない。
  throw new Error(`schema.json を組めない(制約の綴りを誤っている可能性): ${e.message}`);
}

/** 模型を schema.json で検める。違反の一覧を返す(空なら適合)。 */
export function schemaViolations(model) {
  const ok = compiled(model);
  if (ok) return [];
  return (compiled.errors ?? []).map((e) => ({
    code: `schema.${e.keyword}`,
    message: `${e.instancePath || "/"} ${e.message}` + (e.params && Object.keys(e.params).length ? ` (${JSON.stringify(e.params)})` : ""),
  }));
}

/** schema.json が実際に使っているキーワードの一覧(自己点検用)。 */
export function keywordsUsed(node = SCHEMA, out = new Set()) {
  if (Array.isArray(node)) { for (const x of node) keywordsUsed(x, out); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (!k.startsWith("$") && k !== "properties" && k !== "definitions") out.add(k);
      if (k === "properties" || k === "$defs") { for (const v2 of Object.values(v ?? {})) keywordsUsed(v2, out); }
      else keywordsUsed(v, out);
    }
  }
  return out;
}
