// アンカーの指す先の文法。**null を返さない。** 必ず判別できる値を返す。
//
// なぜ要るか: overlay の生成器は `/src\/[\w\/.-]+\.ts/` で照合し、外れたら
// `continue` していた。三重に危ない。
//
//   1. `.ts` 以外が落ちる。この木には注釈の印を持つ `.mjs` が在り、
//      追跡索引は範囲を返しているのに overlay から消える。
//   2. **リポジトリの接頭を剥がして無視する。** 検証用スキーマは「両リポジトリに
//      似た名の文書が在るためパス単独を許さない」と明記しているのに、`doctrine:`
//      接頭のアンカーが doctrine-lens の索引と照合されうる —— 跨リポジトリの
//      偽陽性が「実測」として表示される。
//   3. 落ちたことが記録に残らない。空配列と「見つからなかった」が同じ形になる。
//
// 文法:
//   anchor_target := url | prefixed_path | prose
//   prefixed_path := prefix ":" 空白* path ( 空白* "(" 注記 ")" )?
//   path          := 相対・POSIX 正規化・".." 段を含まない
//
// 注記は最後の ")" まで取り、解釈しない。

const PREFIX = /^([A-Za-z][A-Za-z0-9._-]*)\s*:\s*(.+)$/;

/** Windows の区切りを揃える。`src/model/paths.ts` の toPosix と同じ規律。 */
const toPosix = (p) => p.split("\\").join("/");

/**
 * @returns {{kind:"url",url:string}
 *          |{kind:"path",repo:string,path:string,note:string|null}
 *          |{kind:"prose",reason:string,raw:string}
 *          |{kind:"invalid",reason:string,raw:string,repo?:string}}
 */
export function parseAnchorTarget(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { kind: "prose", reason: "空である", raw: s };
  if (/^https?:\/\/\S+$/.test(s)) return { kind: "url", url: s };

  const m = PREFIX.exec(s);
  if (!m) return { kind: "prose", reason: "リポジトリの接頭が無い", raw: s };
  // `C:/x` のような駆動器名を接頭と読み違えない。
  if (m[1].length === 1) return { kind: "prose", reason: "リポジトリの接頭が無い", raw: s };

  const repo = m[1];
  let rest = m[2].trim();

  // 末尾の注記を外す。閉じ括弧は最後のものを採る(注記の中に括弧が在ってよい)。
  let note = null;
  const open = rest.indexOf("(");
  const close = rest.lastIndexOf(")");
  if (open > 0 && close === rest.length - 1 && close > open) {
    note = rest.slice(open + 1, close);
    rest = rest.slice(0, open).trim();
  }

  if (!rest) return { kind: "invalid", reason: "接頭の後ろに経路が無い", raw: s, repo };
  const path = toPosix(rest);
  if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return { kind: "invalid", reason: "絶対経路である", raw: s, repo };
  if (path.split("/").includes("..")) return { kind: "invalid", reason: "上位へ抜ける段(..)を含む", raw: s, repo };
  // 経路の中の空白は保つ。`[\w/.-]` は空白と日本語を落とすので使わない。
  return { kind: "path", repo, path, note };
}

/**
 * 実現先として数える種別のアンカーが、文法に従っているか(M-17)。
 * URL か、リポジトリ接頭つきの相対経路だけを認める。
 */
export function anchorTargetViolations(model, realizationKinds) {
  const out = [];
  for (const a of model.anchors ?? []) {
    if (!realizationKinds.includes(a.target_kind)) continue;
    const p = parseAnchorTarget(a.target);
    if (p.kind === "url" || p.kind === "path") continue;
    out.push({
      code: p.kind === "invalid" ? "model.anchor_target_invalid" : "model.anchor_target_unprefixed",
      message: `${a.id} の指す先が文法に従わない(${p.reason}): ${JSON.stringify(a.target)}`,
    });
  }
  return out;
}
