// doctrine:begin SPEC-005
// 追跡の突き合わせ — 範囲を文書ごとに束ね、見出しの中身を組む。
//
// ここは編集器の機能を使わない純粋な関数だけで書く（IMPL-001）。
// 指紋を突き合わせない。食い違いは上流の所見から来た集合をそのまま引く（ADR-005）。
import type { GraphNode } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";

/** 文書ごとに束ねた範囲。 */
export interface DocumentTrace {
  readonly docId: string;
  readonly ranges: readonly TraceRange[];
  /** 上流が指紋の食い違いを挙げているか。 */
  readonly stale: boolean;
}

/** 範囲の上に出す見出し一行分。編集器の型を使わない形で組む。 */
export interface RangeHeadline {
  /** 見出しを置く行。上流が返す 1 始まりの値のまま。 */
  readonly line: number;
  readonly docId: string;
  /** 文書の題。グラフに無ければ `null`。 */
  readonly title: string | null;
  /** 上流のグラフにその文書が在るか。無ければ開く操作を無効にする。 */
  readonly known: boolean;
  readonly stale: boolean;
  /** その範囲が在るファイル。作業フォルダからの相対パス。 */
  readonly path: string;
  readonly beginLine: number;
  readonly endLine: number;
}

function titleOf(node: GraphNode | undefined): string | null {
  const raw = node?.["title"];
  return typeof raw === "string" && raw ? raw : null;
}

/**
 * 範囲を文書ごとに束ねる。
 *
 * `staleIds` は上流の所見から拾った id の集合である。
 * この関数は指紋を見ない。集合に在るかどうかだけを引く。
 */
export function groupByDocument(
  ranges: readonly TraceRange[],
  staleIds: ReadonlySet<string>,
): DocumentTrace[] {
  const byDoc = new Map<string, TraceRange[]>();
  for (const range of ranges) {
    const bucket = byDoc.get(range.id);
    if (bucket) bucket.push(range);
    else byDoc.set(range.id, [range]);
  }
  return [...byDoc.entries()]
    .map(([docId, list]) => ({
      docId,
      ranges: [...list].sort(
        (a, b) =>
          (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.begin_line - b.begin_line,
      ),
      stale: staleIds.has(docId),
    }))
    .sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
}

/** ある文書に結ばれた範囲だけを取り出す。 */
export function rangesForDocument(
  ranges: readonly TraceRange[],
  docId: string,
): TraceRange[] {
  return ranges
    .filter((r) => r.id === docId)
    .sort(
      (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.begin_line - b.begin_line,
    );
}

/** あるファイルに在る範囲だけを取り出す。 */
export function rangesForPath(
  ranges: readonly TraceRange[],
  relPath: string,
): TraceRange[] {
  const normalized = relPath.replace(/\\/g, "/");
  return ranges
    .filter((r) => r.path.replace(/\\/g, "/") === normalized)
    .sort((a, b) => a.begin_line - b.begin_line || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 一つのファイルに出す見出しを組む。
 *
 * 範囲が無いファイルには何も出さない（SPEC-005 制約）。空の配列を返す。
 */
export function headlinesForPath(
  ranges: readonly TraceRange[],
  relPath: string,
  nodesById: ReadonlyMap<string, GraphNode>,
  staleIds: ReadonlySet<string>,
): RangeHeadline[] {
  return rangesForPath(ranges, relPath).map((range) => ({
    line: range.begin_line,
    docId: range.id,
    title: titleOf(nodesById.get(range.id)),
    known: nodesById.has(range.id),
    stale: staleIds.has(range.id),
    path: range.path,
    beginLine: range.begin_line,
    endLine: range.end_line,
  }));
}

/**
 * ある行を含む範囲を探す。行は 1 から数える。
 *
 * 重なりがあるときは、始まりが最も後ろのもの（最も内側）を返す。
 * 入れ子は上流が誤りとして挙げるので、ここで解こうとはしない。
 */
/**
 * その保存で取り直すべきか。
 *
 * `relPath` は作業フォルダからの相対（`/` 区切り）。作業フォルダの外なら
 * 呼び手が `null` を渡す。
 *
 * 何でも取り直すと、無関係な一回の保存で上流の CLI が七本走る（速い拍と
 * 遅い拍の両方が走るため）。この木での実測で一回あたり数秒かかる。
 * README も設定の説明も SPEC-005 も「統治の .md か印を持つ原本のとき」と
 * 書いてあるので、そのとおりにする。
 */
export function shouldRefreshOnSave(
  relPath: string | null,
  docsRootRelative: string | null,
  ranges: readonly TraceRange[] | null,
): boolean {
  if (!relPath) return false;
  // 統治木の中の `.md`。統治木の場所は作業フォルダからの相対で受ける。
  if (docsRootRelative && relPath.toLowerCase().endsWith(".md")) {
    if (relPath === docsRootRelative || relPath.startsWith(`${docsRootRelative}/`)) return true;
  }
  // 印を持つ原本。上流が返した範囲に載っているかで判じる（印の綴りを持たない）。
  // 範囲がまだ取れていないときは取り直す。取れるまで一度も動かないより良い。
  if (ranges === null) return true;
  return ranges.some((r) => r.path === relPath);
}

/** 帯の一本。行は編集器と同じ 0 始まり。 */
export interface Band {
  readonly id: string;
  readonly begin: number;
  readonly end: number;
  /** 指紋が食い違っているか。帯の種類（色）がこれで決まる。 */
  readonly stale: boolean;
}

/** 上流が返す行は 1 始まり。編集器は 0 始まり。変換はこの一箇所だけで行う。 */
export function toEditorLine(upstreamLine: number): number {
  return Math.max(0, upstreamLine - 1);
}

/**
 * そのファイルに出す帯を組む。
 *
 * 帯の行と種類を決めるのはここだけで、編集器の型は使わない。分けてあるのは、
 * 「食い違いが帯に出る」ことを編集器を起こさずに確かめられるようにするためである
 * （TEST-005）。呼び手は返ってきた行をそのまま編集器の範囲へ写す。
 *
 * `lastLine` を超える行は末尾へ寄せる（SPEC-005 エラー時挙動）。
 */
export function bandsForPath(
  ranges: readonly TraceRange[],
  relPath: string,
  staleIds: ReadonlySet<string>,
  lastLine: number,
): Band[] {
  const limit = Math.max(0, lastLine);
  return rangesForPath(ranges, relPath).map((range) => {
    const begin = Math.min(toEditorLine(range.begin_line), limit);
    const end = Math.min(toEditorLine(range.end_line), limit);
    return { id: range.id, begin, end: Math.max(begin, end), stale: staleIds.has(range.id) };
  });
}

export function rangeAtLine(
  ranges: readonly TraceRange[],
  relPath: string,
  line: number,
): TraceRange | null {
  const candidates = rangesForPath(ranges, relPath).filter(
    (r) => line >= r.begin_line && line <= r.end_line,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.begin_line > best.begin_line ? r : best));
}

/** 覆いの要約。数字を示すだけで、不足として鳴らさない（ADR-005）。 */
export interface TraceCoverage {
  /** 範囲を持つ文書の数。 */
  readonly tracedDocuments: number;
  /** 範囲の総数。 */
  readonly totalRanges: number;
  /** 指紋が食い違っている文書の数。 */
  readonly staleDocuments: number;
  /** 範囲を持たない現行の SPEC の id。並びは整列済み。 */
  readonly untracedSpecIds: readonly string[];
}

/**
 * 覆いを数える。
 *
 * 「範囲を持たない文書」を挙げる対象は、呼び手が `candidateIds` で渡す。
 * どの型を対象にするかをこのドメインが決めない（REQ-003）。
 */
export function summarizeCoverage(
  ranges: readonly TraceRange[],
  staleIds: ReadonlySet<string>,
  candidateIds: readonly string[],
): TraceCoverage {
  const traced = new Set(ranges.map((r) => r.id));
  return {
    tracedDocuments: traced.size,
    totalRanges: ranges.length,
    staleDocuments: [...traced].filter((id) => staleIds.has(id)).length,
    untracedSpecIds: [...candidateIds].filter((id) => !traced.has(id)).sort(),
  };
}
// doctrine:end SPEC-005
