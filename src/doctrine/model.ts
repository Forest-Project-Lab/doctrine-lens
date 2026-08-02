// doctrine:begin SPEC-001
// 上流 doctrine が出す JSON の形をそのまま写した型。
//
// ここに書いてよいのは「項の名前」だけである。型コードの一覧・status の語彙・
// 置き場所の対応表を書いてはならない（REQ-003）。それらは上流の登録簿にあり、
// registry.ts がその場で読む。
//
// 索引子つきの署名を持たせるのは、上流が項を増やしても落とさず素通しするため
// である（SPEC-001 受入基準 3）。

/** `dep-graph.py --classify-edges --json` が返す節点。 */
export interface GraphNode {
  id: string;
  path: string;
  type: string;
  domain: string;
  status: string;
  depends_on: string[];
  impacts: string[];
  canonical_for: string[];
  /** 上流が増やした未知の項。読まないが落とさない。 */
  [extra: string]: unknown;
}

/** `dep-graph.py --classify-edges --json` が返す辺。 */
export interface GraphEdge {
  src: string;
  dst: string;
  /** `depends_on` か `impacts`。上流が名づける。 */
  field: string;
  /** 同じドメイン内か、ドメインを越えるか。上流が判定する。 */
  kind: string;
  [extra: string]: unknown;
}

/** 取得したグラフの全体。 */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 上流の登録簿の写し。値はすべて上流から来る。
 * このドメインはどの値も自前で持たない。
 */
export interface Registry {
  /** 型コードを登録順に並べたもの。レーンの列の並びに使う。 */
    types: string[];
  /** 現行を示す status の値。「現行のみ」の絞りに使う。 */
  currentStatuses: string[];
  /** status の語彙の全体。絞りの選択肢に使う。 */
  allStatuses: string[];
  /** 投影の型。地図の上で区別して示す。 */
  projectionTypes: string[];
}

/** 取得の失敗を、投げずに値として返すための形。 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: FailureReason; readonly detail: string };

/**
 * 失敗の種類。画面はこの値で案内を出し分ける。
 * `absent` は異常ではない（統治木もプラグインも無いのは正常な状態である）。
 */
export type FailureReason =
  | "absent"
  /** 設定そのものが受け付けられない。取り直しても直らない（利用者が直す）。 */
  | "bad-setting"
  | "spawn-failed"
  | "exit-nonzero"
  | "bad-json"
  | "timeout";

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function fail<T>(reason: FailureReason, detail: string): Outcome<T> {
  return { ok: false, reason, detail };
}
// doctrine:end SPEC-001

/** 一つの文書について、frontmatter から取る値。上流の節点がそのまま持つ。 */
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
 * 主文に出す文字列。題名が取れていなければ id へ落とす。
 *
 * 落ちたことは画面の脚注が言う。
 */
export function displayTitle(id: string, meta: DocMetaIndex): string {
  return meta.get(id)?.title?.trim() || id;
}
