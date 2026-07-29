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
