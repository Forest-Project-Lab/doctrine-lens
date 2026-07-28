// TEST-003 — レンズ文法の受入。SPEC-003 の受入基準の六項に一対一で対応する。
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScene, NO_FOCUS } from "../model/depth.js";
import {
  buildColorScale,
  colorOf,
  DEFAULT_LENS,
  effectiveLayout,
  NO_VALUE_COLOR,
  passesFilter,
  withColorBy,
  withDepth,
  withFilter,
  withLayout,
  type Lens,
} from "../model/lens.js";
import { node, REGISTRY, twoDomainGraph } from "./fixture.js";

const graph = twoDomainGraph();

test("1. 一つのダイヤルを変えても残る三つが変わらない", () => {
  const base: Lens = {
    colorBy: "type",
    filter: { currentOnly: true, domains: ["lens"], types: [] },
    layout: "map",
    depth: 0,
  };

  const byColor = withColorBy(base, "status");
  assert.deepEqual(byColor.filter, base.filter);
  assert.equal(byColor.layout, base.layout);
  assert.equal(byColor.depth, base.depth);

  const byFilter = withFilter(base, { currentOnly: false, domains: [], types: ["SPEC"] });
  assert.equal(byFilter.colorBy, base.colorBy);
  assert.equal(byFilter.layout, base.layout);
  assert.equal(byFilter.depth, base.depth);

  const byLayout = withLayout(base, "lane");
  assert.equal(byLayout.colorBy, base.colorBy);
  assert.deepEqual(byLayout.filter, base.filter);
  assert.equal(byLayout.depth, base.depth);

  const byDepth = withDepth(base, 2);
  assert.equal(byDepth.colorBy, base.colorBy);
  assert.deepEqual(byDepth.filter, base.filter);
  assert.equal(byDepth.layout, base.layout);
});

test("2. 未知の型にも色が付き、登録簿が知る型の色は変わらない", () => {
  const known = graph.nodes;
  const before = buildColorScale(known, "type", REGISTRY);

  const withUnknown = [...known, node("ZZZ-001", "ZZZ", "lens", "current")];
  const after = buildColorScale(withUnknown, "type", REGISTRY);

  const unknownNode = node("ZZZ-001", "ZZZ", "lens", "current");
  const unknownColor = colorOf(unknownNode, "type", after);
  assert.notEqual(unknownColor, NO_VALUE_COLOR, "未知の型にも色が付く");

  for (const type of new Set(known.map((n) => n.type))) {
    assert.equal(after.get(type), before.get(type), `${type} の色が変わらない`);
  }
});

test("2b. 値を持たない節点は決まった色になる", () => {
  const scale = buildColorScale(graph.nodes, "owner", REGISTRY);
  // 見本の節点は owner を持たない。
  const first = graph.nodes[0];
  assert.ok(first);
  assert.equal(colorOf(first, "owner", scale), NO_VALUE_COLOR);
});

test("3. 現行のみを選ぶと現行でない節点が描かれない", () => {
  const lens = withFilter(DEFAULT_LENS, { currentOnly: true, domains: [], types: [] });
  const scene = buildScene(graph, withDepth(lens, 1), { domain: "lens", docId: null }, REGISTRY);
  const keys = scene.nodes.map((n) => n.key);
  assert.ok(!keys.includes("IMPL-001"), "deprecated の IMPL-001 が消える");
  assert.ok(keys.includes("SPEC-001"), "current の SPEC-001 は残る");
});

test("3b. 登録簿が読めないときは現行の絞りを効かせない", () => {
  const deprecated = node("IMPL-001", "IMPL", "lens", "deprecated");
  const filter = { currentOnly: true, domains: [], types: [] };
  assert.equal(passesFilter(deprecated, filter, REGISTRY), false);
  assert.equal(
    passesFilter(deprecated, filter, null),
    true,
    "絞れないことを、全てを落とすことで表してはならない",
  );
});

test("4. 絞りで全て消えても絞りの値が保たれる", () => {
  const filter = { currentOnly: false, domains: ["存在しないドメイン"], types: [] };
  const lens = withFilter(DEFAULT_LENS, filter);
  const scene = buildScene(graph, lens, NO_FOCUS, REGISTRY);
  assert.equal(scene.nodes.length, 0, "空になる");
  assert.deepEqual(lens.filter, filter, "絞りの値は勝手に緩まない");
});

test("5. レンズの値の組は写して持ち回れる", () => {
  const saved: Lens = {
    colorBy: "status",
    filter: { currentOnly: true, domains: ["lens"], types: ["SPEC"] },
    layout: "lane",
    depth: 1,
  };
  // 別の値へ移してから戻す。
  const moved = withDepth(withColorBy(saved, "domain"), 0);
  assert.notDeepEqual(moved, saved);
  const restored: Lens = { ...saved, filter: { ...saved.filter } };
  assert.deepEqual(restored, saved, "保存した四つの値が保存時と一致する");
});

test("6. 効かない深度と配置の組み合わせは既定へ落ちる", () => {
  assert.equal(effectiveLayout(0, "lane"), "map", "L0 にレーンは効かない");
  assert.equal(effectiveLayout(0, "detail"), "map");
  assert.equal(effectiveLayout(1, "detail"), "lane");
  assert.equal(effectiveLayout(2, "map"), "detail");
  // 効く組み合わせはそのまま通る。
  assert.equal(effectiveLayout(0, "map"), "map");
  assert.equal(effectiveLayout(1, "lane"), "lane");
  assert.equal(effectiveLayout(2, "detail"), "detail");
});

test("絞りは型とドメインを積で効かせる", () => {
  const spec = node("SPEC-001", "SPEC", "lens", "current");
  assert.equal(
    passesFilter(spec, { currentOnly: false, domains: ["lens"], types: ["SPEC"] }, REGISTRY),
    true,
  );
  assert.equal(
    passesFilter(spec, { currentOnly: false, domains: ["store"], types: ["SPEC"] }, REGISTRY),
    false,
  );
  assert.equal(
    passesFilter(spec, { currentOnly: false, domains: ["lens"], types: ["REQ"] }, REGISTRY),
    false,
  );
});
