// doctrine:begin SPEC-003
// レンズ — 色・絞り・配置・深度の四つの値の組（ADR-004 が定めた語）。
//
// 四つは互いに独立である。一つを変える関数は他の三つを写して返す（REQ-002）。
// 色の基準・絞りの条件・配置の方式のいずれについても、値の一覧をここに持たない。
// 実際の節点が持つ値と、上流の登録簿の並びから組み立てる（REQ-003）。
import type { GraphNode, Registry } from "../doctrine/model.js";

/** 深度の段。番号と意味の正本は ICD-001 にある。 */
export type Depth = 0 | 1 | 2 | 3;

/** 色の基準。値は上流の節点が持つ項の名前である。 */
export type ColorBy = "type" | "status" | "domain" | "owner";

/** 配置の方式。 */
export type LayoutMode = "map" | "lane" | "detail" | "list";

export interface Filter {
  /** 現行を示す status の節点だけを描く。判定の値は登録簿から来る。 */
  currentOnly: boolean;
  /** 空なら絞らない。 */
  domains: readonly string[];
  /** 空なら絞らない。 */
  types: readonly string[];
}

export interface Lens {
  readonly colorBy: ColorBy;
  readonly filter: Filter;
  readonly layout: LayoutMode;
  readonly depth: Depth;
}

// 覚えている方式は「レーン」にしておく。L0 ではレーンが効かないので地図へ落ち、
// L1 へ降りるとレーンが効く。深度ごとに値を書き換えずに、段ごとの既定が出る。
export const DEFAULT_LENS: Lens = {
  colorBy: "type",
  filter: { currentOnly: false, domains: [], types: [] },
  layout: "lane",
  depth: 0,
};

/** 深度ごとに使える配置の方式。表の外の組み合わせは既定へ落とす。 */
const LAYOUTS_BY_DEPTH: Readonly<Record<Depth, readonly LayoutMode[]>> = {
  0: ["map"],
  1: ["lane", "map"],
  2: ["detail"],
  3: ["list"],
};

/** 深度ごとの既定の配置。 */
const DEFAULT_LAYOUT_BY_DEPTH: Readonly<Record<Depth, LayoutMode>> = {
  0: "map",
  1: "lane",
  2: "detail",
  3: "list",
};

/**
 * その深度で実際に効く配置を返す。
 *
 * 効かない組み合わせを選んでも異常にしない。その深度の既定へ落とす
 * （SPEC-003 エラー時挙動）。
 */
export function effectiveLayout(depth: Depth, layout: LayoutMode): LayoutMode {
  const allowed = LAYOUTS_BY_DEPTH[depth];
  return allowed.includes(layout) ? layout : DEFAULT_LAYOUT_BY_DEPTH[depth];
}

/** その深度で選べる配置の一覧。画面がダイヤルの選択肢に使う。 */
export function layoutsFor(depth: Depth): readonly LayoutMode[] {
  return LAYOUTS_BY_DEPTH[depth];
}

// --- ダイヤルの独立 ------------------------------------------------------
// 四つの関数はいずれも、担当の一つだけを差し替えて残りを写す。
// この形を保つ限り、ダイヤルの独立（REQ-002）は構造として守られる。

export function withColorBy(lens: Lens, colorBy: ColorBy): Lens {
  return { ...lens, colorBy };
}

export function withFilter(lens: Lens, filter: Filter): Lens {
  return { ...lens, filter };
}

export function withLayout(lens: Lens, layout: LayoutMode): Lens {
  return { ...lens, layout };
}

export function withDepth(lens: Lens, depth: Depth): Lens {
  return { ...lens, depth };
}

// --- 絞り ----------------------------------------------------------------

/**
 * 節点が絞りを通るか。
 *
 * 「現行を示す値」の判定は登録簿から来る値で行う。語彙をここに持たない。
 * 登録簿が読めないときは現行の絞りを効かせない（絞れないことを、
 * 全てを落とすことで表してはならない）。
 */
export function passesFilter(
  node: GraphNode,
  filter: Filter,
  registry: Registry | null,
): boolean {
  if (filter.currentOnly && registry && !registry.currentStatuses.includes(node.status)) {
    return false;
  }
  if (filter.domains.length > 0 && !filter.domains.includes(node.domain)) return false;
  if (filter.types.length > 0 && !filter.types.includes(node.type)) return false;
  return true;
}

// --- 色 ------------------------------------------------------------------

/**
 * 固定の並び。値の数がこれを超えたら巡回して配る。
 * 明るい主題と暗い主題の双方で読める色相を選んである。
 */
const PALETTE = [
  "#3c78b4", "#3f8f5f", "#a8642a", "#7a5aa8", "#2f8f8f",
  "#a04a72", "#7d7a2e", "#4a6fa5", "#5f8f3f", "#8f5230",
] as const;

/** 値を持たない節点に配る色。 */
export const NO_VALUE_COLOR = "#8a8f94";

/** 節点から色の基準の値を取り出す。無ければ空文字。 */
export function colorKeyOf(node: GraphNode, colorBy: ColorBy): string {
  const raw = node[colorBy];
  return typeof raw === "string" ? raw : "";
}

/**
 * 上流の登録簿が、その基準について持つ並び。持たなければ空。
 * `owner` と `domain` は登録簿の管轄外なので空を返す。
 */
function registryOrderFor(colorBy: ColorBy, registry: Registry | null): readonly string[] {
  if (!registry) return [];
  if (colorBy === "type") return registry.types;
  if (colorBy === "status") return registry.allStatuses;
  return [];
}

/**
 * 色の割り当てを作る。
 *
 * 並びは、登録簿が持つ並びを先に、登録簿に無い値を整列した順で後ろに続ける。
 * こうすると、文書が一つ増えて未知の値が現れても、既に色が付いていた値の色が
 * 変わらない（SPEC-003 受入基準 2）。
 */
export function buildColorScale(
  nodes: readonly GraphNode[],
  colorBy: ColorBy,
  registry: Registry | null,
): Map<string, string> {
  const present = new Set<string>();
  for (const node of nodes) {
    const key = colorKeyOf(node, colorBy);
    if (key) present.add(key);
  }
  const known = registryOrderFor(colorBy, registry);
  const ordered: string[] = [];
  for (const value of known) {
    if (present.has(value)) ordered.push(value);
  }
  const rest = [...present].filter((v) => !known.includes(v)).sort();
  ordered.push(...rest);

  const scale = new Map<string, string>();
  ordered.forEach((value, index) => {
    scale.set(value, PALETTE[index % PALETTE.length] as string);
  });
  return scale;
}

/** 色を引く。値を持たない節点には決まった色を返す。 */
export function colorOf(
  node: GraphNode,
  colorBy: ColorBy,
  scale: ReadonlyMap<string, string>,
): string {
  const key = colorKeyOf(node, colorBy);
  if (!key) return NO_VALUE_COLOR;
  return scale.get(key) ?? NO_VALUE_COLOR;
}
// doctrine:end SPEC-003
