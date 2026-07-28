// 試験用の見本のグラフ。上流の JSON の形をそのまま模す。
//
// ここには型コードと status の語彙が字面で現れる。それでよい。
// 禁じているのは実装が語彙を持つことであり、試験が見本を組むことではない
// （REQ-003 の走査は src/test を対象から外す）。
import type { Graph, GraphNode, Registry } from "../doctrine/model.js";

export function node(
  id: string,
  type: string,
  domain: string,
  status: string,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    path: `${domain}/${id}.md`,
    type,
    domain,
    status,
    depends_on: [],
    impacts: [],
    canonical_for: [],
    ...extra,
  };
}

export const REGISTRY: Registry = {
  types: ["ICD", "REQ", "SPEC", "ADR", "IMPL", "TEST"],
  currentStatuses: ["accepted", "current"],
  allStatuses: ["proposed", "accepted", "current", "deprecated", "superseded", "archived"],
  projectionTypes: ["OVERVIEW", "CTXMAP"],
};

/**
 * 二つのドメインを持つ見本。
 *
 * lens: ICD-001, REQ-001, SPEC-001, IMPL-001（IMPL-001 は現行でない）
 * store: ICD-002, SPEC-002
 * ドメインを越える辺は store の二つの文書から lens の ICD-001 へ二本。
 * L0 ではこの二本が一本に畳まれる。
 */
export function twoDomainGraph(): Graph {
  const nodes: GraphNode[] = [
    node("ICD-001", "ICD", "lens", "current"),
    node("REQ-001", "REQ", "lens", "current", { impacts: ["SPEC-001"] }),
    node("SPEC-001", "SPEC", "lens", "current", { depends_on: ["REQ-001"] }),
    node("IMPL-001", "IMPL", "lens", "deprecated", { depends_on: ["SPEC-001"] }),
    node("ICD-002", "ICD", "store", "current"),
    node("SPEC-002", "SPEC", "store", "current", { depends_on: ["ICD-001"] }),
  ];
  const edges = [
    { src: "SPEC-001", dst: "REQ-001", field: "depends_on", kind: "intra_domain" },
    { src: "REQ-001", dst: "SPEC-001", field: "impacts", kind: "intra_domain" },
    { src: "IMPL-001", dst: "SPEC-001", field: "depends_on", kind: "intra_domain" },
    // ドメインを越える二本。両端の組が同じなので L0 では一本に畳まれる。
    { src: "SPEC-002", dst: "ICD-001", field: "depends_on", kind: "cross_domain" },
    { src: "ICD-002", dst: "ICD-001", field: "depends_on", kind: "cross_domain" },
  ];
  return { nodes, edges };
}
