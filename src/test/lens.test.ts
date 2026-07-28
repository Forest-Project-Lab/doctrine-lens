// TEST-003 — レンズ文法の受入。SPEC-003 の受入基準の六項に一対一で対応する。
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScene, NO_FOCUS, type Focus } from "../model/depth.js";
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
import type { SavedLens } from "../shared/protocol.js";
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

test("5. 保存した組を選び直すと、四つの値が保存時と一致する", () => {
  // 保存の対象は「四つの値」と「そのときの焦点」である。焦点を捨てると、
  // 深度 1 以上は原理的に戻せない。ここで確かめるのは、記録を JSON へ
  // 落として読み直したあと（workspaceState はそうやって持つ）、
  // 実際に場面を組み直して四つの値が保存時と一致することである。
  const saved: Lens = {
    colorBy: "status",
    filter: { currentOnly: false, domains: [], types: [] },
    layout: "lane",
    depth: 2,
  };
  const savedFocus: Focus = { domain: "lens", docId: "SPEC-001" };

  // ダイヤルを回し、段も移して、保存時とは別の状態にする。
  const moved = withDepth(withColorBy(withLayout(saved, "map"), "domain"), 0);
  assert.notDeepEqual(moved, saved, "先に別の状態へ移っている");

  // 記録を往復させる（本体は workspaceState に JSON として持つ）。
  const record = JSON.parse(
    JSON.stringify({ name: "見る組", lens: saved, focus: savedFocus }),
  ) as SavedLens;

  // 選び直す。webview がするのと同じく、レンズと焦点を対で当てる。
  const scene = buildScene(graph, record.lens, record.focus ?? NO_FOCUS, REGISTRY);
  // 場面は深度を落としていない。落ちていれば webview は state.lens を書き戻す。
  assert.equal(scene.depth, saved.depth, "深度が保存時と一致する");
  assert.equal(scene.focus.docId, savedFocus.docId, "焦点も保存時のまま");

  const applied: Lens = withDepth(record.lens, scene.depth);
  assert.equal(applied.colorBy, saved.colorBy, "色");
  assert.equal(applied.layout, saved.layout, "配置");
  assert.deepEqual(applied.filter, saved.filter, "絞り");
  assert.equal(applied.depth, saved.depth, "深度");
});

test("5b. 焦点を捨てて保存すると深度が戻らない（焦点を持たせている理由）", () => {
  // 焦点を落とした古い記録の再現。実装がこうなっていたときは、選び直すと
  // 深度だけが黙って L0 へ落ち、しかも画面には何も出なかった。
  const saved: Lens = {
    colorBy: "status",
    filter: { currentOnly: false, domains: [], types: [] },
    layout: "lane",
    depth: 2,
  };
  const scene = buildScene(graph, saved, NO_FOCUS, REGISTRY);
  assert.equal(scene.depth, 0, "焦点が無ければ深度は立たない");
});

test("5c. 保存時の焦点が消えていれば、段を戻したうえでその旨を告げる", () => {
  const saved: Lens = {
    colorBy: "type",
    filter: { currentOnly: false, domains: [], types: [] },
    layout: "lane",
    depth: 2,
  };
  const scene = buildScene(graph, saved, { domain: "lens", docId: "消えた文書" }, REGISTRY);
  assert.equal(scene.depth, 1, "在るドメインまで戻す");
  assert.equal(scene.recovered, "doc-gone", "黙って戻さない");
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
