// TEST-002 — 深度の行き来の受入。SPEC-002 の受入基準の七項に一対一で対応する。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ascend,
  buildScene,
  descend,
  NO_FOCUS,
  type Position,
} from "../model/depth.js";
import { DEFAULT_LENS, withDepth, type Lens } from "../model/lens.js";
import { layoutScene } from "../model/layout.js";
import { REGISTRY, twoDomainGraph } from "./fixture.js";

const graph = twoDomainGraph();
const lensAt = (depth: 0 | 1 | 2): Lens => withDepth(DEFAULT_LENS, depth);

test("1. 降りる操作だけで L0 から L2 へ着く", () => {
  let position: Position = { depth: 0, focus: NO_FOCUS };
  const scene0 = buildScene(graph, lensAt(0), position.focus, REGISTRY);

  const down1 = descend(position, "lens", scene0);
  assert.ok(down1, "L0 から lens ドメインへ降りられる");
  position = down1;
  assert.equal(position.depth, 1);
  assert.equal(position.focus.domain, "lens");

  const scene1 = buildScene(graph, lensAt(1), position.focus, REGISTRY);
  const down2 = descend(position, "SPEC-001", scene1);
  assert.ok(down2, "L1 から文書へ降りられる");
  position = down2;
  assert.equal(position.depth, 2);
  assert.equal(position.focus.docId, "SPEC-001");
});

test("2. 上がる操作の繰り返しで L0 へ戻る", () => {
  let position: Position = { depth: 2, focus: { domain: "lens", docId: "SPEC-001" } };
  position = ascend(position);
  assert.equal(position.depth, 1);
  assert.equal(position.focus.domain, "lens", "L2 から上がるとき焦点のドメインを保つ");
  assert.equal(position.focus.docId, null);

  position = ascend(position);
  assert.equal(position.depth, 0);
  assert.equal(position.focus.domain, null);

  // L0 で上がる操作をしても何も起きない。
  const same = ascend(position);
  assert.deepEqual(same, position);
});

test("3. 深度を変えても色・絞り・配置の三つが変わらない", () => {
  const before = DEFAULT_LENS;
  const after = withDepth(before, 2);
  assert.equal(after.colorBy, before.colorBy);
  assert.equal(after.layout, before.layout);
  assert.deepEqual(after.filter, before.filter);
  assert.notEqual(after.depth, before.depth);
});

test("4. L0 の節点の数がドメインの異なり数と一致する", () => {
  const scene = buildScene(graph, lensAt(0), NO_FOCUS, REGISTRY);
  const domains = new Set(graph.nodes.map((n) => n.domain));
  assert.equal(scene.nodes.length, domains.size);
  assert.deepEqual(
    scene.nodes.map((n) => n.key),
    [...domains].sort(),
  );
  assert.ok(scene.nodes.every((n) => n.kind === "domain"));
});

test("5. 同じ両端の辺が L0 で一本に畳まれ、畳んだ本数が保たれる", () => {
  const scene = buildScene(graph, lensAt(0), NO_FOCUS, REGISTRY);
  assert.equal(scene.edges.length, 1, "store から lens への二本が一本になる");
  const edge = scene.edges[0];
  assert.ok(edge);
  assert.equal(edge.src, "store");
  assert.equal(edge.dst, "lens");
  assert.equal(edge.weight, 2, "畳んだ本数を保つ");
});

test("6. 同じ入力を二度描くと座標が完全に一致する", () => {
  for (const depth of [0, 1, 2] as const) {
    const focus =
      depth === 0
        ? NO_FOCUS
        : depth === 1
          ? { domain: "lens", docId: null }
          : { domain: "lens", docId: "SPEC-001" };
    const lens = lensAt(depth);
    const sceneA = buildScene(graph, lens, focus, REGISTRY);
    const sceneB = buildScene(graph, lens, focus, REGISTRY);
    const mode = depth === 0 ? "map" : depth === 1 ? "lane" : "detail";
    const a = layoutScene(sceneA, mode, REGISTRY);
    const b = layoutScene(sceneB, mode, REGISTRY);
    assert.deepEqual(a, b, `深度 ${depth} の配置が二度とも一致する`);
    assert.ok(a.nodes.length > 0, `深度 ${depth} で節点が置かれる`);
  }
});

test("7. 焦点の文書が消えても例外を出さずそのドメインの L1 へ戻る", () => {
  const withoutSpec = {
    nodes: graph.nodes.filter((n) => n.id !== "SPEC-001"),
    edges: graph.edges.filter((e) => e.src !== "SPEC-001" && e.dst !== "SPEC-001"),
  };
  const scene = buildScene(
    withoutSpec,
    lensAt(2),
    { domain: "lens", docId: "SPEC-001" },
    REGISTRY,
  );
  assert.equal(scene.depth, 1);
  assert.equal(scene.focus.domain, "lens");
  assert.ok(scene.recovered, "戻した事実を載せる");
});

test("7b. 焦点のドメインごと消えたら L0 へ戻る", () => {
  const onlyStore = {
    nodes: graph.nodes.filter((n) => n.domain === "store"),
    edges: [],
  };
  const scene = buildScene(
    onlyStore,
    lensAt(2),
    { domain: "lens", docId: "SPEC-001" },
    REGISTRY,
  );
  assert.equal(scene.depth, 0);
  assert.ok(scene.recovered);
});

test("節点が一つも無い段へは降りない", () => {
  const scene = buildScene(graph, lensAt(0), NO_FOCUS, REGISTRY);
  const position: Position = { depth: 0, focus: NO_FOCUS };
  assert.equal(descend(position, "存在しないドメイン", scene), null);
});

test("片端がグラフに無い辺は描かず、本数を数える", () => {
  const broken = {
    nodes: graph.nodes,
    edges: [...graph.edges, { src: "SPEC-001", dst: "GHOST-999", field: "depends_on", kind: "x" }],
  };
  const l0 = buildScene(broken, lensAt(0), NO_FOCUS, REGISTRY);
  assert.equal(l0.danglingEdges, 1);
  assert.ok(l0.edges.every((e) => e.dst !== "GHOST-999"));

  const l2 = buildScene(broken, lensAt(2), { domain: "lens", docId: "SPEC-001" }, REGISTRY);
  assert.equal(l2.danglingEdges, 1);
  assert.ok(l2.nodes.every((n) => n.key !== "GHOST-999"));
});
