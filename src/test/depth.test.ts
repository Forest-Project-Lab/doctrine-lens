// TEST-002 — 深度の行き来の受入。SPEC-002 の受入基準の七項に一対一で対応する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { node, REGISTRY, twoDomainGraph } from "./fixture.js";

const PROJECT = resolve(__dirname, "..", "..");

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
  // 理由まで見る。真偽だけを見ると、取り違えた理由が読み手へ出ていても気づけない。
  assert.equal(scene.recovered, "doc-gone", "戻した理由を正しく載せる");
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
  assert.equal(scene.recovered, "doc-gone");
});

test("7c. 深度 1 で焦点のドメインだけが消えたら L0 へ戻し、その理由を載せる", () => {
  // 7b は深度 2 の経路（doc-gone）を通る。深度 1 で焦点のドメインが消える
  // 経路（domain-gone）は別物で、こちらを踏む試験が無かった。
  const onlyStore = {
    nodes: graph.nodes.filter((n) => n.domain === "store"),
    edges: [],
  };
  const scene = buildScene(onlyStore, lensAt(1), { domain: "lens", docId: null }, REGISTRY);
  assert.equal(scene.depth, 0);
  assert.equal(scene.recovered, "domain-gone", "ドメインが消えた理由を出す");
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

// --- L2 の詳細配置 — 辺の引き先 ------------------------------------------
//
// 上流は依存（depends_on）と影響（impacts）を別の端として持ち、混ぜてはならない。
// そのため同じ隣が左右の両方に出ることがある。出したうえで辺を引かないと、
// 辺を持たない箱が浮き、地図が検査盤と食い違う（実際に起きた）。

test("L2 の詳細で、置いた箱はすべて自分の辺を持つ", () => {
  // SPEC-001 に対して、IMPL-001 が両方の端で結ばれている形を作る。
  const graph = {
    nodes: [
      node("SPEC-001", "SPEC", "lens", "current", { impacts: ["IMPL-001"] }),
      node("IMPL-001", "IMPL", "lens", "current", { depends_on: ["SPEC-001"] }),
      node("REQ-001", "REQ", "lens", "current", { impacts: ["SPEC-001"] }),
    ],
    edges: [
      // IMPL-001 はこの仕様に依存している（左へ）。
      { src: "IMPL-001", dst: "SPEC-001", field: "depends_on", kind: "intra_domain" },
      // そしてこの仕様は IMPL-001 に影響する（右へ）。別の事実である。
      { src: "SPEC-001", dst: "IMPL-001", field: "impacts", kind: "intra_domain" },
      { src: "REQ-001", dst: "SPEC-001", field: "impacts", kind: "intra_domain" },
    ],
  };
  const lens = withDepth(DEFAULT_LENS, 2);
  const scene = buildScene(graph, lens, { domain: "lens", docId: "SPEC-001" }, REGISTRY);
  const layout = layoutScene(scene, "detail", REGISTRY);

  // 同じ鍵の箱が二つ在ること自体は正しい（別の事実を二つ出している）。
  const impl = layout.nodes.filter((p) => p.key === "IMPL-001");
  assert.equal(impl.length, 2, "依存と影響の両方で結ばれた隣は左右に一つずつ出る");
  assert.notEqual(impl[0]?.slot, impl[1]?.slot, "置き場所の識別が重ならない");
  assert.notEqual(impl[0]?.x, impl[1]?.x, "左右に分かれている");

  // 辺を持つべき箱が、実際に辺を持っていること。
  const touched = new Set<string>();
  for (const placed of layout.edges) {
    touched.add(placed.from.slot);
    touched.add(placed.to.slot);
  }
  const orphan = layout.nodes
    .filter((p) => !touched.has(p.slot))
    .map((p) => `${p.key}@${p.x}`);
  assert.deepEqual(orphan, [], `辺を一本も持たない箱がある: ${orphan.join(", ")}`);

  // 引き先が取り違えられていないこと。焦点へ向かう辺は左から、出る辺は右へ。
  const focusX = layout.nodes.find((p) => p.key === "SPEC-001")?.x ?? 0;
  for (const { edge, from, to } of layout.edges) {
    if (edge.dst === "SPEC-001") {
      assert.ok(from.x < focusX, `${edge.src} からの辺が左の箱から出ていない`);
    } else {
      assert.ok(to.x > focusX, `${edge.dst} への辺が右の箱へ入っていない`);
    }
  }
});

test("辺の引き先は配置が返し、描き手が鍵から引き直さない", () => {
  // 鍵で引き直すと、同じ鍵の箱が二つある配置で必ず片方だけに辺が集まる。
  const source = readFileSync(join(PROJECT, "src", "webview", "main.ts"), "utf8");
  assert.ok(
    /for \(const \{ edge, from, to \} of layout\.edges\)/.test(source),
    "描き手が layout.edges を使っていない",
  );
  assert.ok(
    !/placedByKey/.test(source),
    "描き手が鍵から箱を引き直している（辺の取り違えが戻っている）",
  );
});

test("L0 とレーンの配置も、置いた箱の辺を落とさない", () => {
  const graph = twoDomainGraph();
  for (const [depth, mode, focus] of [
    [0, "map", NO_FOCUS],
    [1, "lane", { domain: "lens", docId: null }],
  ] as const) {
    const scene = buildScene(graph, withDepth(DEFAULT_LENS, depth), focus, REGISTRY);
    const layout = layoutScene(scene, mode, REGISTRY);
    const keys = new Set(layout.nodes.map((p) => p.key));
    const drawable = scene.edges.filter(
      (e) => e.src !== e.dst && keys.has(e.src) && keys.has(e.dst),
    );
    assert.equal(
      layout.edges.length,
      drawable.length,
      `${mode}: 描けるはずの辺が落ちている`,
    );
  }
});

test("domain を書き忘れた文書のドメインにも降りられる", () => {
  // 上流は domain を書き忘れた文書を落とさず、空文字で返す（監査が別に挙げる）。
  // 空を「無い」として扱うと、L0 に題の無い箱が出たあと押しても何も起きず、
  // 何も言わない。直しに来た人がまさに踏む形である。
  const graph = {
    nodes: [
      node("SPEC-100", "SPEC", "", "current"),
      node("SPEC-200", "SPEC", "alpha", "current"),
    ],
    edges: [],
  };
  const l0 = buildScene(graph, DEFAULT_LENS, NO_FOCUS, REGISTRY);
  assert.deepEqual(
    l0.nodes.map((n) => n.key).sort(),
    ["", "alpha"],
    "空のドメインも L0 の箱として出る",
  );

  const position = descend({ depth: 0, focus: NO_FOCUS }, "", l0);
  assert.deepEqual(position, { depth: 1, focus: { domain: "", docId: null } }, "降りられる");

  const l1 = buildScene(graph, withDepth(DEFAULT_LENS, 1), position!.focus, REGISTRY);
  assert.equal(l1.depth, 1, "段が立つ（黙って L0 へ落ちない）");
  assert.deepEqual(l1.nodes.map((n) => n.key), ["SPEC-100"], "その文書が出る");
});
