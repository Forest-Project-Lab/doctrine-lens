// doctrine:begin SPEC-006
// 文書の題名を取る。
//
// なぜ要るか: 上流 `dep-graph.py --json` が返す節点は `title` を持たない
// （id・type・domain・status・path・depends_on・impacts・canonical_for の八つだけ）。
// 題名を出せないと、画面の主文が `SPEC-003` のような id になる。それは読めない。
// 上流へは issue を立てた（Forest-Project-Lab/doctrine#149）。届いたらこの層は捨てる。
//
// **自前で frontmatter を読まない。** 上流の `_frontmatter.py` は 21KB あり、
// 引用・逃げ・行内注釈・複数行の並びを扱う。正規表現で真似れば必ず脆くなる。
// 上流のパーサをそのまま呼ぶので、書式の規則をこちらが持たない（REQ-003）。
import { join } from "node:path";

import { runJson, type RunOptions } from "./cli.js";
import { fail, ok, type Outcome } from "./model.js";

/** 一つの文書について、frontmatter から取る値。 */
export interface DocMeta {
  /** 主文に出す題名。取れなければ空。 */
  readonly title: string;
  /** 最後に更新した日。取れなければ空。 */
  readonly updated: string;
  /** 後継の id。無ければ空。 */
  readonly supersededBy: string;
}

/** 文書の id から `DocMeta` を引く表。 */
export type DocMetaIndex = ReadonlyMap<string, DocMeta>;

/**
 * 統治木の全文書の frontmatter を読み、id ごとの値を返す問い合わせ。
 *
 * 先頭で探索路から作業フォルダ（`""` と `"."`）を落とす。python は `-c` のとき
 * `sys.path[0]` に作業フォルダを入れるので、落とさないと `json` すら
 * その場所から先に読まれる（cli.ts の safeCwd と二重に塞ぐ）。
 *
 * 走査は上流の `_registry.iter_documents` に委ねたいが、その名は上流の内部であり
 * 契約ではない。ここでは `.md` を辿って `parse_file` に掛けるだけにする。
 * 「どれが文書か」の判定は持たない——`id` を持つものだけを拾う（REQ-003）。
 */
const PROBE = [
  "import sys",
  'sys.path[:] = [p for p in sys.path if p not in ("", ".")]',
  "sys.path.insert(0, sys.argv[1])",
  "import json, os",
  "import _frontmatter as fm",
  "root = sys.argv[2]",
  // 根が無ければ黙って空を返さない。呼び手が相対パスを渡すと（子プロセスの作業フォルダは
  // 私有の一時場所なので）必ず空になり、「題名が一つも無い木」と区別が付かなくなる。
  "if not os.path.isdir(root):",
  "    sys.stderr.write('docs root not found: ' + root)",
  "    raise SystemExit(2)",
  "out = {}",
  "seen = 0",
  "broken = []",
  "for base, dirs, files in os.walk(root):",
  "    dirs[:] = [d for d in dirs if not d.startswith('.')]",
  "    for name in files:",
  "        if not name.endswith('.md'):",
  "            continue",
  "        seen += 1",
  "        path = os.path.join(base, name)",
  "        try:",
  // parse_file は (frontmatter, 本文, 誤り) の三つ組を返す。二つで受けると
  // 全件が ValueError になり、握り潰せば「題名の無い木」に化ける（実際にそうなった）。
  "            meta, _body, _errors = fm.parse_file(path)",
  "        except Exception as exc:",
  "            broken.append(os.path.relpath(path, root) + ': ' + type(exc).__name__)",
  "            continue",
  "        if not isinstance(meta, dict):",
  "            continue",
  "        doc_id = meta.get('id')",
  "        if not doc_id:",
  "            continue",
  "        out[doc_id] = {",
  "            'title': meta.get('title') or '',",
  "            'updated': str(meta.get('updated') or ''),",
  "            'supersededBy': meta.get('superseded_by') or '',",
  "        }",
  // 解析そのものが全件で落ちたら、それは木の問題ではなく呼び方の問題である。
  // 黙って空を返さない（三つ組を二つで受けて全件 ValueError になったことがある）。
  //
  // 条件は「壊れた数 == 見た数」であって「表が空」ではない。二つを一つに畳むと、
  // id を持つ文書がまだ無いだけの木を、壊れていると告げることになる。
  "if seen > 0 and len(broken) == seen:",
  "    sys.stderr.write('parsed 0 of %d files; first failures: %s' % (seen, broken[:3]))",
  "    raise SystemExit(3)",
  "json.dump({'docs': out, 'seen': seen, 'broken': broken}, sys.stdout, ensure_ascii=False)",
].join("\n");

interface RawMeta {
  title?: unknown;
  updated?: unknown;
  supersededBy?: unknown;
}

/**
 * 統治木の全文書の題名を取る。
 *
 * 失敗しても取得全体を止めない。呼び手は空の表で描き、
 * 題名が取れなかったことを画面に書く（SPEC-006 エラー時挙動）。
 */
export async function fetchDocMeta(
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<DocMetaIndex>> {
  const outcome = await runJson<{ docs?: Record<string, RawMeta>; broken?: unknown }>(
    ["-c", PROBE, join(pluginRoot, "scripts"), docsRoot],
    options,
  );
  if (!outcome.ok) return outcome;
  const raw = outcome.value?.docs;
  if (!raw || typeof raw !== "object") {
    return fail<DocMetaIndex>("bad-json", 'the value has no "docs"');
  }
  const index = new Map<string, DocMeta>();
  for (const [id, meta] of Object.entries(raw)) {
    index.set(id, {
      title: typeof meta?.title === "string" ? meta.title : "",
      updated: typeof meta?.updated === "string" ? meta.updated : "",
      supersededBy: typeof meta?.supersededBy === "string" ? meta.supersededBy : "",
    });
  }
  return ok(index as DocMetaIndex);
}

/**
 * 主文に出す文字列。題名が取れていなければ id へ落とす。
 *
 * 落とすこと自体は異常ではない（上流がまだ `title` を返さないため）。
 * 落ちたことは画面の脚注が言う。
 */
export function displayTitle(id: string, meta: DocMetaIndex): string {
  return meta.get(id)?.title || id;
}
// doctrine:end SPEC-006
