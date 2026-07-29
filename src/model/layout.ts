// doctrine:begin SPEC-003
// 配置 — 節点の座標を決める。
//
// 決定的である。乱数と時刻を使わない。同じ入力からは同じ座標を出す
// （SPEC-002 制約・受入基準 6）。力学配置を使わないのはこのためである（ADR-002）。
import type { Registry } from "../doctrine/model.js";
import type { Scene, SceneEdge, SceneNode } from "./depth.js";
import type { LayoutMode } from "./lens.js";

export interface Placed {
  /** 論理の鍵。選択・降下の対象はこれで引く。 */
  readonly key: string;
  /**
   * 置き場所の識別。同じ節点を二箇所に置く配置があるので、鍵とは別に持つ。
   *
   * L2 の詳細では、この文書に依存している隣と、この文書が影響する隣の両方に
   * 同じ id が現れる。上流は依存と影響を別の端として持ち、混ぜてはならないと
   * 定めているので、こちらで畳んではならない（REQ-003）。二つ置いたうえで、
   * 辺をどちらの箱へ引くかをここで見分ける。
   */
  readonly slot: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一本の辺を、どの箱からどの箱へ引くか。配置が決める。 */
export interface PlacedEdge {
  readonly edge: SceneEdge;
  readonly from: Placed;
  readonly to: Placed;
}

/**
 * 列の見出し。
 *
 * `kind` が `data` のときだけ `label` に意味がある（上流が返した型の名）。
 * 他は画面の文字列であり、訳す責任は描き手にある（ADR-007）。
 * ここに表示の文字列を持たないのは、model が編集器も言語も知らないためである。
 */
export interface Lane {
  readonly kind: "data" | "incoming" | "focus" | "outgoing" | "ranges";
  /** `kind` が `data` のときの型の名。上流の値。空なら「値なし」。 */
  readonly label: string;
  readonly x: number;
  readonly w: number;
}

export interface Layout {
  readonly nodes: readonly Placed[];
  /**
   * 描く辺と、その両端の箱。
   *
   * 描き手が鍵から箱を引くと、同じ鍵の箱が二つあるとき必ず片方だけに
   * 辺が集まり、もう片方は辺を一本も持たない箱として浮く（実際に起きた）。
   * どちらへ引くかは座標を決めた側にしか分からないので、ここで返す。
   */
  readonly edges: readonly PlacedEdge[];
  readonly lanes: readonly Lane[];
  readonly width: number;
  readonly height: number;
}

const GAP = 28;
const NODE_W = 156;
const NODE_H = 46;
const LANE_TOP = 44;

const EMPTY: Layout = { nodes: [], edges: [], lanes: [], width: 0, height: 0 };

/**
 * 鍵で引くだけの単純な辺の割り当て。同じ鍵の箱が一つしかない配置で使う。
 * 両端のどちらかが置かれていない辺は落とす（描く先が無い）。
 */
function edgesByKey(edges: readonly SceneEdge[], placed: readonly Placed[]): PlacedEdge[] {
  const byKey = new Map<string, Placed>();
  for (const p of placed) if (!byKey.has(p.key)) byKey.set(p.key, p);
  const out: PlacedEdge[] = [];
  for (const edge of edges) {
    if (edge.src === edge.dst) continue;
    const from = byKey.get(edge.src);
    const to = byKey.get(edge.dst);
    if (from && to) out.push({ edge, from, to });
  }
  return out;
}

/** 地図（L0）。ドメインを矩形として格子に並べる。大きさは属する文書の数で決まる。 */
function layoutMap(nodes: readonly SceneNode[], edges: readonly SceneEdge[]): Layout {
  if (nodes.length === 0) return EMPTY;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const maxCount = Math.max(1, ...nodes.map((n) => n.count));
  const cellW = 240;
  const cellH = 160;

  const placed: Placed[] = nodes.map((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    // 面積を数に比例させると差が付きすぎる。辺を平方根で伸ばして頭打ちにする。
    const scale = 0.55 + 0.45 * Math.sqrt(node.count / maxCount);
    const w = Math.round(cellW * 0.78 * scale);
    const h = Math.round(cellH * 0.62 * scale);
    return {
      key: node.key,
      slot: node.key,
      x: col * cellW + Math.round((cellW - w) / 2),
      y: row * cellH + Math.round((cellH - h) / 2),
      w,
      h,
    };
  });

  const rows = Math.ceil(nodes.length / columns);
  return {
    nodes: placed,
    edges: edgesByKey(edges, placed),
    lanes: [],
    width: columns * cellW,
    height: rows * cellH,
  };
}

/**
 * 列の並びを決める。上流の登録簿が持つ型の登録順を先に使い、
 * 登録簿に無い型は整列した順で後ろに続ける（SPEC-003 配置）。
 */
function laneOrder(present: readonly string[], registry: Registry | null): string[] {
  const unique = [...new Set(present)];
  const known = registry?.types ?? [];
  const ordered = known.filter((t) => unique.includes(t));
  const rest = unique.filter((t) => !known.includes(t)).sort();
  return [...ordered, ...rest];
}

/** レーン（L1）。型ごとの列に並べる。 */
function layoutLane(
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  registry: Registry | null,
): Layout {
  if (nodes.length === 0) return EMPTY;
  const typeOf = (n: SceneNode): string => n.node?.type ?? "";
  const columns = laneOrder(nodes.map(typeOf), registry);

  const columnW = NODE_W + GAP;
  const rowH = NODE_H + GAP;
  const placed: Placed[] = [];
  const lanes: Lane[] = [];
  let maxRows = 0;

  columns.forEach((type, columnIndex) => {
    const inColumn = nodes.filter((n) => typeOf(n) === type);
    lanes.push({ kind: "data", label: type, x: columnIndex * columnW, w: NODE_W });
    inColumn.forEach((node, rowIndex) => {
      placed.push({
        key: node.key,
        slot: node.key,
        x: columnIndex * columnW,
        y: LANE_TOP + rowIndex * rowH,
        w: NODE_W,
        h: NODE_H,
      });
    });
    maxRows = Math.max(maxRows, inColumn.length);
  });

  return {
    nodes: placed,
    edges: edgesByKey(edges, placed),
    lanes,
    width: Math.max(columnW, columns.length * columnW),
    height: LANE_TOP + Math.max(rowH, maxRows * rowH),
  };
}

/**
 * 詳細（L2）。焦点を中央に置き、焦点を指す文書を左、焦点が指す文書を右に並べる。
 *
 * 左右の別は辺の向きだけで決める。`field` の語彙に依らせない（REQ-003）。
 *
 * 同じ文書が左右の両方に出ることがある。上流は依存（`depends_on`）と
 * 影響（`impacts`）を別の端として持ち、混ぜてはならないと定めているので、
 * 「A がこの文書に依存している」と「この文書が A に影響する」は別の事実であり、
 * こちらで一つに畳んではならない。左右に一つずつ置き、辺はそれぞれの箱へ引く。
 */
function layoutDetail(scene: Scene): Layout {
  const focusKey = scene.focus.docId;
  if (!focusKey || scene.nodes.length === 0) return EMPTY;

  const incoming: string[] = [];
  const outgoing: string[] = [];
  for (const edge of scene.edges) {
    if (edge.dst === focusKey && !incoming.includes(edge.src)) incoming.push(edge.src);
    if (edge.src === focusKey && !outgoing.includes(edge.dst)) outgoing.push(edge.dst);
  }
  incoming.sort();
  outgoing.sort();

  const columnW = NODE_W + 96;
  const rowH = NODE_H + GAP;
  const rows = Math.max(1, incoming.length, outgoing.length);
  const height = rows * rowH;

  const column = (keys: readonly string[], x: number, side: string): Placed[] =>
    keys.map((key, index) => ({
      key,
      slot: `${side}\u0000${key}`,
      x,
      // 列の高さを揃えるため、行数の少ない側を中央へ寄せる。
      // LANE_TOP を足すのは、列見出しの帯と節点が重ならないようにするため。
      y: LANE_TOP + Math.round((height - keys.length * rowH) / 2) + index * rowH,
      w: NODE_W,
      h: NODE_H,
    }));

  const focusPlaced: Placed = {
    key: focusKey,
    slot: `focus\u0000${focusKey}`,
    x: columnW,
    y: LANE_TOP + Math.round((height - NODE_H) / 2),
    w: NODE_W,
    h: NODE_H,
  };
  const left = column(incoming, 0, "in");
  const right = column(outgoing, columnW * 2, "out");
  const placed: Placed[] = [...left, focusPlaced, ...right];

  // 場面に在るのに辺を持たない節点は落とさず、下段へ置く。
  const positioned = new Set(placed.map((p) => p.key));
  const loose = scene.nodes.filter((n) => !positioned.has(n.key)).map((n) => n.key);
  loose.forEach((key, index) => {
    placed.push({
      key,
      slot: `loose\u0000${key}`,
      x: index * (NODE_W + GAP),
      y: LANE_TOP + height + GAP,
      w: NODE_W,
      h: NODE_H,
    });
  });

  // 辺を、その辺が表している側の箱へ引く。焦点へ向かう辺は左の箱から、
  // 焦点から出る辺は右の箱へ。鍵で引くと、両側に在る隣の片方が
  // 辺を一本も持たない箱として浮く（実際に起きた）。
  const leftBy = new Map(left.map((p) => [p.key, p]));
  const rightBy = new Map(right.map((p) => [p.key, p]));
  const placedEdges: PlacedEdge[] = [];
  for (const edge of scene.edges) {
    if (edge.src === edge.dst) continue;
    if (edge.dst === focusKey) {
      const from = leftBy.get(edge.src);
      if (from) placedEdges.push({ edge, from, to: focusPlaced });
    } else if (edge.src === focusKey) {
      const to = rightBy.get(edge.dst);
      if (to) placedEdges.push({ edge, from: focusPlaced, to });
    }
    // 焦点に触れない辺は L2 では描かない（隣どうしの辺は場面に含まれない）。
  }

  return {
    nodes: placed,
    edges: placedEdges,
    lanes: [
      { kind: "incoming", label: "", x: 0, w: NODE_W },
      { kind: "focus", label: "", x: columnW, w: NODE_W },
      { kind: "outgoing", label: "", x: columnW * 2, w: NODE_W },
    ],
    width: columnW * 2 + NODE_W,
    height: LANE_TOP + height + (loose.length > 0 ? GAP + NODE_H : 0),
  };
}

/**
 * 一覧（L3）。コード範囲を上から一列に並べる。
 *
 * 背の高さを行数に比例させると、数千行の範囲が画面を占める。
 * 対数で伸ばして頭打ちにし、大小の差だけが見えるようにする。
 */
function layoutList(nodes: readonly SceneNode[]): Layout {
  if (nodes.length === 0) return EMPTY;
  const width = 460;
  const minH = 48;
  // 背の差は大小が読めれば足りる。大きく取ると、大きな範囲が二つ並んだだけで
  // 画面が埋まる。
  const maxExtra = 44;
  const maxLines = Math.max(1, ...nodes.map((n) => n.count));

  let y = LANE_TOP;
  const placed: Placed[] = [];
  for (const node of nodes) {
    const share = Math.log2(Math.max(1, node.count) + 1) / Math.log2(maxLines + 1);
    const h = Math.round(minH + maxExtra * share);
    placed.push({ key: node.key, slot: node.key, x: 0, y, w: width, h });
    y += h + 12;
  }

  return {
    nodes: placed,
    // L3 はコード範囲の一覧であり、辺を持たない。
    edges: [],
    lanes: [{ kind: "ranges", label: "", x: 0, w: width }],
    width,
    height: y,
  };
}

/** 場面と方式から座標を決める。方式が効かない深度なら呼び出す側が既定へ落としてある。 */
export function layoutScene(
  scene: Scene,
  mode: LayoutMode,
  registry: Registry | null,
): Layout {
  if (mode === "lane") return layoutLane(scene.nodes, scene.edges, registry);
  if (mode === "detail") return layoutDetail(scene);
  if (mode === "list") return layoutList(scene.nodes);
  return layoutMap(scene.nodes, scene.edges);
}
// doctrine:end SPEC-003
