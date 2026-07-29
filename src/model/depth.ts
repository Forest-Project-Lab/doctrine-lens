// doctrine:begin SPEC-002
// 深度ごとに、描く節点と辺を作る。
//
// ここは編集器の機能を使わない純粋な関数だけで書く（IMPL-001）。
// 乱数と時刻を使わない。同じ入力からは同じ出力を出す。
import type { Graph, GraphEdge, GraphNode, Registry } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";
import { passesFilter, type Depth, type Lens } from "./lens.js";
import { rangesForDocument } from "./trace.js";

/** いま何を見ているか。深度と対になる。 */
export interface Focus {
  /** L1 と L2 で立つ。 */
  readonly domain: string | null;
  /** L2 で立つ。 */
  readonly docId: string | null;
}

export const NO_FOCUS: Focus = { domain: null, docId: null };

/** 描く節点。ドメイン・文書・コード範囲の三つがある。 */
export interface SceneNode {
  /** L0 はドメイン名、L1 と L2 は文書の id、L3 は `パス:始まり-終わり`。 */
  readonly key: string;
  readonly label: string;
  readonly kind: "domain" | "document" | "range";
  /** 文書のとき、上流の節点そのもの。他は `null`。 */
  readonly node: GraphNode | null;
  /** コード範囲のとき、上流が返した範囲そのもの。他は `null`。 */
  readonly range: TraceRange | null;
  /** ドメインのとき、そこに属する（絞りを通った）文書の数。 */
  readonly count: number;
  /** L2 で焦点そのものかどうか。L3 では指紋が食い違っているかどうか。 */
  readonly isFocus: boolean;
}

/** コード範囲の節点の鍵。ファイルと行から一意に決める。 */
export function rangeKey(range: TraceRange): string {
  return `${range.path}:${range.begin_line}-${range.end_line}`;
}

/** 深度を戻した理由。文言は描き手が訳す（ADR-007）。 */
export type RecoveredReason = "domain-gone" | "doc-gone" | "no-ranges" | "ranges-unavailable";

/** 描く辺。 */
export interface SceneEdge {
  readonly src: string;
  readonly dst: string;
  readonly field: string;
  /** L0 で畳んだ本数。畳んでいなければ 1。 */
  readonly weight: number;
}

/** 一つの深度で描くもの一式。 */
export interface Scene {
  readonly depth: Depth;
  readonly focus: Focus;
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  /** 片端がグラフに無いために描かなかった辺の本数（SPEC-002 エラー時挙動）。 */
  readonly danglingEdges: number;
  /**
   * 焦点が消えたために深度を戻したときに立つ合図。
   *
   * 文言ではなく符号で持つ。model は編集器も言語も知らないので、
   * 訳す責任は描き手にある（ADR-007）。
   */
  readonly recovered: RecoveredReason | null;
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function sortEdges(edges: SceneEdge[]): SceneEdge[] {
  return edges.sort(
    (a, b) =>
      (a.src < b.src ? -1 : a.src > b.src ? 1 : 0) ||
      (a.dst < b.dst ? -1 : a.dst > b.dst ? 1 : 0) ||
      (a.field < b.field ? -1 : a.field > b.field ? 1 : 0),
  );
}

/** 絞りを通った文書だけを、id を鍵にして引けるようにする。 */
function visibleDocuments(
  graph: Graph,
  lens: Lens,
  registry: Registry | null,
): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (passesFilter(node, lens.filter, registry)) map.set(node.id, node);
  }
  return map;
}

/**
 * L0 — 文脈の地図。
 *
 * 節点はドメインである。ドメインの一覧は上流の節点が持つ `domain` の値から集める。
 * このドメインが独自にドメインの一覧を持たない（REQ-003）。
 *
 * 辺は両端のドメインが異なるものだけを集め、同じ両端の組を一本に畳む。
 * 「両端のドメインが異なる」は節点の `domain` を突き合わせて判じる。
 * 上流が付ける `kind` の語彙に依らせない（依らせると語彙を写すことになる）。
 */
function buildLevel0(
  visible: Map<string, GraphNode>,
  all: Map<string, GraphNode>,
  edges: readonly GraphEdge[],
): Scene {
  const counts = new Map<string, number>();
  for (const node of visible.values()) {
    counts.set(node.domain, (counts.get(node.domain) ?? 0) + 1);
  }

  const nodes: SceneNode[] = [...counts.entries()]
    .map(([domain, count]) => ({
      key: domain,
      label: domain,
      kind: "domain" as const,
      node: null,
      range: null,
      count,
      isFocus: false,
    }))
    .sort(byKey);

  const collapsed = new Map<string, SceneEdge>();
  let dangling = 0;
  for (const edge of edges) {
    // 絞りで消えた端と、そもそもグラフに無い端は区別する。
    // 数えるのはグラフに無い端（死んだ参照）だけである。
    if (!all.has(edge.src) || !all.has(edge.dst)) {
      dangling += 1;
      continue;
    }
    const src = visible.get(edge.src);
    const dst = visible.get(edge.dst);
    if (!src || !dst) continue;
    if (src.domain === dst.domain) continue;
    const key = JSON.stringify([src.domain, dst.domain]);
    const existing = collapsed.get(key);
    collapsed.set(key, {
      src: src.domain,
      dst: dst.domain,
      field: existing ? existing.field : edge.field,
      weight: (existing?.weight ?? 0) + 1,
    });
  }

  return {
    depth: 0,
    focus: NO_FOCUS,
    nodes,
    edges: sortEdges([...collapsed.values()]),
    danglingEdges: dangling,
    recovered: null,
  };
}

/** L1 — 一つのドメインの内側。節点はそのドメインの文書、辺はその内側の辺。 */
function buildLevel1(
  visible: Map<string, GraphNode>,
  edges: readonly GraphEdge[],
  domain: string,
): Scene {
  const inside = new Map<string, GraphNode>();
  for (const node of visible.values()) {
    if (node.domain === domain) inside.set(node.id, node);
  }

  const nodes: SceneNode[] = [...inside.values()]
    .map((node) => ({
      key: node.id,
      label: node.id,
      kind: "document" as const,
      node,
      range: null,
      count: 0,
      isFocus: false,
    }))
    .sort(byKey);

  const kept: SceneEdge[] = [];
  for (const edge of edges) {
    if (!inside.has(edge.src) || !inside.has(edge.dst)) continue;
    kept.push({ src: edge.src, dst: edge.dst, field: edge.field, weight: 1 });
  }

  return {
    depth: 1,
    focus: { domain, docId: null },
    nodes,
    edges: sortEdges(kept),
    danglingEdges: 0,
    recovered: null,
  };
}

/** L2 — 一つの文書。焦点と、それに直に接する文書だけを描く。 */
function buildLevel2(
  allNodes: Map<string, GraphNode>,
  edges: readonly GraphEdge[],
  focusDoc: GraphNode,
): Scene {
  const touching = edges.filter((e) => e.src === focusDoc.id || e.dst === focusDoc.id);

  const neighbours = new Map<string, GraphNode>();
  neighbours.set(focusDoc.id, focusDoc);
  const kept: SceneEdge[] = [];
  let dangling = 0;
  for (const edge of touching) {
    const otherId = edge.src === focusDoc.id ? edge.dst : edge.src;
    const other = allNodes.get(otherId);
    if (!other) {
      // 片端がグラフに無い。描かず、数だけ画面へ渡す。
      dangling += 1;
      continue;
    }
    // 隣は絞りに関わらず見せる。焦点の周りが欠けると依存の形が読めなくなる。
    neighbours.set(otherId, other);
    kept.push({ src: edge.src, dst: edge.dst, field: edge.field, weight: 1 });
  }

  const nodes: SceneNode[] = [...neighbours.values()]
    .map((node) => ({
      key: node.id,
      label: node.id,
      kind: "document" as const,
      node,
      range: null,
      count: 0,
      isFocus: node.id === focusDoc.id,
    }))
    .sort(byKey);

  return {
    depth: 2,
    focus: { domain: focusDoc.domain, docId: focusDoc.id },
    nodes,
    edges: sortEdges(kept),
    danglingEdges: dangling,
    recovered: null,
  };
}

/**
 * L3 — 一つの文書に結ばれたコード範囲。
 *
 * 節点は範囲であり、辺は無い。範囲どうしの関係を上流は返さないので、
 * 無い関係を描かない。
 */
function buildLevel3(
  focusDoc: GraphNode,
  ranges: readonly TraceRange[],
  staleIds: ReadonlySet<string>,
): Scene {
  const mine = rangesForDocument(ranges, focusDoc.id);
  const stale = staleIds.has(focusDoc.id);
  const nodes: SceneNode[] = mine.map((range) => ({
    key: rangeKey(range),
    label: range.path,
    kind: "range" as const,
    node: null,
    range,
    count: range.end_line - range.begin_line + 1,
    // L3 では、指紋の食い違いをこの印で運ぶ（SPEC-003 色の節）。
    isFocus: stale,
  }));

  return {
    depth: 3,
    focus: { domain: focusDoc.domain, docId: focusDoc.id },
    nodes,
    edges: [],
    danglingEdges: 0,
    recovered: null,
  };
}

/** 場面を組むときに要る、グラフの外から来る値。 */
export interface SceneContext {
  /** 上流が返したコード範囲。取れていなければ `null`。 */
  readonly ranges: readonly TraceRange[] | null;
  /** 上流が指紋の食い違いを挙げた文書の id。 */
  readonly staleIds: ReadonlySet<string>;
}

export const EMPTY_CONTEXT: SceneContext = { ranges: null, staleIds: new Set() };

/**
 * 深度と焦点から、描くもの一式を作る。
 *
 * 焦点がグラフから消えていたら、一つ浅い段へ戻して作り直す（SPEC-002 エラー時挙動）。
 * 戻した事実は `recovered` に載せる。例外は投げない。
 */
export function buildScene(
  graph: Graph,
  lens: Lens,
  focus: Focus,
  registry: Registry | null,
  context: SceneContext = EMPTY_CONTEXT,
): Scene {
  const visible = visibleDocuments(graph, lens, registry);
  const all = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  if (lens.depth >= 3 && focus.docId) {
    const doc = all.get(focus.docId);
    if (doc) {
      const scene = buildLevel3(doc, context.ranges ?? [], context.staleIds);
      if (scene.nodes.length > 0) return scene;
      // 範囲が一つも無い段には留まらない。L2 へ戻す（SPEC-002 エラー時挙動）。
      return {
        ...buildLevel2(all, graph.edges, doc),
        recovered: context.ranges === null ? "ranges-unavailable" : "no-ranges",
      };
    }
  }

  // 焦点のドメインの有無は `!== null` で見る。真偽で見ると、上流が
  // `domain` を空文字で返した文書（frontmatter に書き忘れた文書。上流は落とさず
  // 空で返し、監査が別に挙げる）のドメインへ降りられない。押しても何も起きず、
  // 何も言わない箱になる。直しに来た人がまさに踏む形である。
  if (lens.depth >= 2 && focus.docId) {
    const doc = all.get(focus.docId);
    if (doc) return buildLevel2(all, graph.edges, doc);
    if (focus.domain !== null && hasDomain(all, focus.domain)) {
      return { ...buildLevel1(visible, graph.edges, focus.domain), recovered: "doc-gone" };
    }
    return { ...buildLevel0(visible, all, graph.edges), recovered: "doc-gone" };
  }

  // 段を落とすのは「グラフから消えた」ときだけである。
  //
  // 絞りを通した集合（visible）で見ると、絞りでその段が空になっただけの回にも
  // 段が落ち、しかも「ドメインがグラフから消えた」という偽の説明が出る。
  // 深度のダイヤルが絞りのダイヤルに引きずられて動くので、ダイヤルの独立
  // （REQ-002・SPEC-003 受入基準 1）が破れる。しかも絞りを外しても段は戻らない。
  // 空になったことは、絞りの結果として空の段を描いて示す（受入基準 4）。
  if (lens.depth >= 1 && focus.domain !== null) {
    if (hasDomain(all, focus.domain)) return buildLevel1(visible, graph.edges, focus.domain);
    return { ...buildLevel0(visible, all, graph.edges), recovered: "domain-gone" };
  }

  return buildLevel0(visible, all, graph.edges);
}

// --- 行き来 --------------------------------------------------------------

export interface Position {
  readonly depth: Depth;
  readonly focus: Focus;
}

/**
 * 一つ深い段へ降りる。降りられなければ `null` を返す。
 *
 * 降りる操作はどの段でも一つである。段ごとに別の操作を持たせない（REQ-001）。
 */
/** そのドメインの文書がグラフに一つでも在るか（絞りは通さない）。 */
function hasDomain(all: ReadonlyMap<string, GraphNode>, domain: string): boolean {
  for (const node of all.values()) if (node.domain === domain) return true;
  return false;
}

export function descend(
  position: Position,
  key: string,
  scene: Scene,
  context: SceneContext = EMPTY_CONTEXT,
): Position | null {
  const target = scene.nodes.find((n) => n.key === key);
  if (!target) return null;
  if (position.depth === 0 && target.kind === "domain") {
    // 節点が一つも無い段へは降りない。
    if (target.count <= 0) return null;
    return { depth: 1, focus: { domain: target.key, docId: null } };
  }
  if (position.depth === 1 && target.kind === "document" && target.node) {
    return { depth: 2, focus: { domain: target.node.domain, docId: target.node.id } };
  }
  if (position.depth === 2 && target.kind === "document" && target.node) {
    if (target.node.id !== position.focus.docId) {
      // L2 で隣を選ぶと、焦点をその隣へ移す。深度は変わらない。
      return { depth: 2, focus: { domain: target.node.domain, docId: target.node.id } };
    }
    // L2 で焦点そのものを選ぶと L3 へ降りる。結ばれた範囲が無ければ降りない。
    const mine = rangesForDocument(context.ranges ?? [], target.node.id);
    if (mine.length === 0) return null;
    return { depth: 3, focus: { domain: target.node.domain, docId: target.node.id } };
  }
  // L3 の節点は範囲であり、その先の段は無い。開くのは編集器の役目である。
  return null;
}

/**
 * 一つ浅い段へ上がる。L0 では何も起きない。
 *
 * L2 から上がるとき焦点のドメインを保ち、そのドメインの L1 へ戻る。
 */
export function ascend(position: Position): Position {
  if (position.depth === 3) {
    // 焦点の文書を保ち、その文書の L2 へ戻る。
    return { depth: 2, focus: position.focus };
  }
  if (position.depth === 2) {
    return { depth: 1, focus: { domain: position.focus.domain, docId: null } };
  }
  if (position.depth === 1) {
    return { depth: 0, focus: NO_FOCUS };
  }
  return position;
}
// doctrine:end SPEC-002
