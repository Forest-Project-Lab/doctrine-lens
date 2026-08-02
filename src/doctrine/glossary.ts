// doctrine:begin SPEC-006
// 用語辞書を読む。
//
// **語彙をこちらが持たない**（REQ-003・ADR-018）。木の `GLOSSARY-001` が
// 用語辞書の正本であり、この層はその表を読んで運ぶだけである。
// 語の一覧も、辞書のファイル名も、id も、実装に書かない。
//
// 辞書の場所は `canonical_for` に `glossary` を含む節点から引く。
// 取れなくても画面を止めない——語の定義を出さないだけである。
import { join } from "node:path";

import { runJson, type RunOptions } from "./cli.js";
import type { Graph } from "./model.js";
import { fail, ok, type Outcome } from "./model.js";

/** 承認語ひとつ。 */
export interface Term {
  /** 承認語そのもの。 */
  readonly word: string;
  /** 唯一の意味。 */
  readonly meaning: string;
}

/** 承認語から意味を引く表。 */
export type Glossary = ReadonlyMap<string, string>;

/**
 * この木で用語辞書の正本になっている文書の相対パス。
 *
 * `canonical_for` に `glossary` を含む節点を探す。**ファイル名も id も持たない。**
 * 上流の `_registry` が `canonical_for` を返すので、その値だけを見る。
 */
export function glossaryPath(graph: Graph): string | null {
  for (const node of graph.nodes) {
    const claims = Array.isArray(node.canonical_for) ? node.canonical_for : [];
    if (claims.some((c) => c === "glossary")) return node.path;
  }
  return null;
}

/**
 * 辞書の本文から、承認語ごとの意味を拾う。
 *
 * **どれが承認語かは上流が判じる。** この木の辞書には表が二つ在り
 * （承認語の表と「使わない（カルク）」の表）、字面はどちらも三列である。
 * 見分ける規則は上流の `_termcheck` が持っており（見出しで判じている）、
 * こちらが同じ規則を書けば二重定義になる（REQ-003・ADR-018）。
 *
 * したがってここでするのは、**上流が承認語だと言った語について**、
 * その行の第二列（唯一の意味）を拾うことだけである。
 */
export function meaningsFor(body: string, approved: ReadonlySet<string>): Term[] {
  const out: Term[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // `| a | b | c |` は分けると ["", "a", "b", "c", ""] になる。
    if (cells.length < 4) continue;
    const word = cells[1] ?? "";
    const meaning = cells[2] ?? "";
    if (!meaning || !approved.has(word)) continue;
    out.push({ word, meaning });
  }
  return out;
}

/**
 * 統治木の用語辞書を取る。
 *
 * 上流の frontmatter パーサで本文を取り、表を読む。
 * 自前で frontmatter を解さない（REQ-003・`titles.ts` と同じ規律）。
 */
const PROBE = [
  "import sys",
  'sys.path[:] = [p for p in sys.path if p not in ("", ".")]',
  "sys.path.insert(0, sys.argv[1])",
  "import json, os",
  "import _frontmatter as fm",
  "import _termcheck as tc",
  "docs_root = sys.argv[2]",
  "path = sys.argv[3]",
  "if not os.path.isfile(path):",
  "    sys.stderr.write('glossary not found: ' + path)",
  "    raise SystemExit(2)",
  // どれが承認語かは上流に判じさせる。この木の辞書には表が二つ在り、
  // 見分ける規則は上流の _termcheck が持っている（REQ-003）。
  "g = tc.load_glossary(docs_root)",
  "if g.parse_error:",
  "    sys.stderr.write('upstream could not parse the glossary')",
  "    raise SystemExit(3)",
  "_meta, body, _errors = fm.parse_file(path)",
  "json.dump({'body': body, 'approved': sorted(g.approved_terms)}, sys.stdout, ensure_ascii=False)",
].join("\n");

export async function fetchGlossary(
  graph: Graph,
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<Glossary>> {
  const relative = glossaryPath(graph);
  if (!relative) {
    return fail<Glossary>("absent", "no document claims canonical_for: glossary");
  }
  const outcome = await runJson<{ body?: unknown; approved?: unknown }>(
    ["-c", PROBE, join(pluginRoot, "scripts"), docsRoot, join(docsRoot, relative)],
    options,
  );
  if (!outcome.ok) return outcome;
  const body = outcome.value?.body;
  const approved = outcome.value?.approved;
  if (typeof body !== "string" || !Array.isArray(approved)) {
    return fail<Glossary>("bad-json", 'the value has no "body" or "approved"');
  }
  const terms = meaningsFor(
    body,
    new Set(approved.filter((w): w is string => typeof w === "string")),
  );
  // 表が読めなかったら黙って空を返さない。読み方が変わった合図である。
  if (terms.length === 0) {
    return fail<Glossary>("bad-json", `no approved terms found in ${relative}`);
  }
  return ok(new Map(terms.map((t) => [t.word, t.meaning])) as Glossary);
}

/**
 * 画面に出た文字列の中から、辞書が定義している語だけを拾う。
 *
 * **どの語を出すかの一覧を実装が持たない。** 出た文字列と辞書を突き合わせる。
 * 長い語を先に見るので、「逆孤児」が在るときに「孤児」だけを拾わない。
 */
export function termsIn(shown: string, glossary: Glossary): Term[] {
  const found: Term[] = [];
  const taken: [number, number][] = [];
  const words = [...glossary.keys()].sort((a, b) => b.length - a.length);
  for (const word of words) {
    let at = shown.indexOf(word);
    while (at >= 0) {
      const end = at + word.length;
      // 既に長い語として拾った範囲に重なるなら、その出現は数えない。
      if (!taken.some(([s, e]) => at < e && s < end)) {
        taken.push([at, end]);
        found.push({ word, meaning: glossary.get(word) as string });
        break;
      }
      at = shown.indexOf(word, at + 1);
    }
  }
  // 並びを固定する。同じ入力から同じ出力を出す（REQ-002）。
  return found.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
}
// doctrine:end SPEC-006
