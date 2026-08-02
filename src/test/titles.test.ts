// 用語辞書の受入（ADR-018）と、題名の落とし方。
//
// 題名を上流の内部モジュールから補う継ぎ（titles.ts 137 行）は、
// 上流 0.8.0 が節点に title を載せたので捨てた（ADR-020）。
// その層の受入もここから消えている。
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { join } from "node:path";
import { test } from "node:test";

import { locatePluginRoot } from "../doctrine/locate.js";
import { displayTitle, type DocMetaIndex } from "../doctrine/model.js";

const PROJECT = resolve(__dirname, "..", "..");
const OPTIONS = { pythonPath: "python3", timeoutMs: 30000, cwd: PROJECT };

function pluginRootOrSkip(): string | null {
  return locatePluginRoot(PROJECT);
}

test("題名が無ければ id へ落ちる（落ちたことは脚注が言う）", () => {
  const meta: DocMetaIndex = new Map([
    ["A", { title: "在る題", updated: "", supersededBy: "" }],
    ["B", { title: "", updated: "", supersededBy: "" }],
    ["C", { title: "   ", updated: "", supersededBy: "" }],
  ]);
  assert.equal(displayTitle("A", meta), "在る題");
  assert.equal(displayTitle("B", meta), "B", "空の題名で主文を空にしない");
  assert.equal(displayTitle("C", meta), "C", "空白だけの題名も id へ落とす");
  assert.equal(displayTitle("知らない", meta), "知らない");
});

test("上流の節点が題名を持つ（継ぎを捨ててよい根拠）", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const { locateDocsRoot } = await import("../doctrine/locate.js");
  const { runJson } = await import("../doctrine/cli.js");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);
  const outcome = await runJson<{ nodes: { id: string; title?: unknown }[] }>(
    [join(pluginRoot, "scripts", "dep-graph.py"), "--root", docsRoot, "--classify-edges", "--json"],
    OPTIONS,
  );
  assert.ok(outcome.ok, `取れなかった: ${outcome.ok ? "" : outcome.detail}`);
  const nodes = outcome.value.nodes;
  assert.ok(nodes.length > 30, `文書が少なすぎる（${nodes.length}）`);
  const untitled = nodes.filter((n) => typeof n.title !== "string" || !n.title.trim());
  assert.deepEqual(untitled.map((n) => n.id), [], "題名を持たない節点がある");
});

// --- 用語辞書（ADR-018）---------------------------------------------------

test("辞書の場所を canonical_for から引く（ファイル名を実装が持たない）", async () => {
  const { glossaryPath } = await import("../doctrine/glossary.js");
  const graph = {
    nodes: [
      { id: "A", path: "x/a.md", canonical_for: [] },
      { id: "G", path: "_system/用語.md", canonical_for: ["glossary"] },
    ],
    edges: [],
  } as never;
  assert.equal(glossaryPath(graph), "_system/用語.md", "canonical_for から引けていない");
});

test("辞書を主張する文書が無ければ、失敗として返る（既定の場所を勝手に見ない）", async () => {
  const { glossaryPath } = await import("../doctrine/glossary.js");
  const graph = { nodes: [{ id: "A", path: "x/a.md", canonical_for: [] }], edges: [] } as never;
  assert.equal(glossaryPath(graph), null);
});

test("どれが承認語かを実装が判じない（上流が言った語だけ意味を拾う）", async () => {
  // この木の辞書には表が二つ在り、字面はどちらも三列である。見分ける規則は
  // 上流の _termcheck が持っている。こちらが同じ規則を書けば二重定義になる。
  const { meaningsFor } = await import("../doctrine/glossary.js");
  const body = [
    "| 承認語 | 唯一の意味 | 禁止する同義語 |",
    "|---|---|---|",
    "| 起点 | たどり始める文書 | 基点 |",
    "",
    "| 使わない（カルク） | 直す | なぞった英語 |",
    "|---|---|---|",
    "| 同じページにいる | 認識を揃える | on the same page |",
  ].join("\n");
  const got = meaningsFor(body, new Set(["起点"]));
  assert.deepEqual(got, [{ word: "起点", meaning: "たどり始める文書" }]);
});

test("画面に出た語だけを拾う。長い語を先に見る", async () => {
  const { termsIn } = await import("../doctrine/glossary.js");
  const glossary = new Map([
    ["孤児", "依存されない文書"],
    ["逆孤児", "あるべき文書の不在"],
    ["波", "距離で分けた段"],
  ]);
  // 「逆孤児」の中の「孤児」を二重に拾わない。出ていない「波」は拾わない。
  const got = await Promise.resolve(termsIn("逆孤児が 3 件ある。", glossary));
  assert.deepEqual(got.map((t) => t.word), ["逆孤児"]);
  // 独立して出ていれば、両方拾う。
  const both = termsIn("逆孤児と孤児は別である。", glossary);
  assert.deepEqual(both.map((t) => t.word), ["孤児", "逆孤児"]);
});

test("この木の辞書が上流越しに読め、カルクの表が混ざらない", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const { fetchGlossary } = await import("../doctrine/glossary.js");
  const { locateDocsRoot } = await import("../doctrine/locate.js");
  const { runJson } = await import("../doctrine/cli.js");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);
  const graph = await runJson<{ nodes: unknown[] }>(
    [join(pluginRoot, "scripts", "dep-graph.py"), "--root", docsRoot, "--classify-edges", "--json"],
    OPTIONS,
  );
  assert.ok(graph.ok);
  const outcome = await fetchGlossary(graph.value as never, docsRoot, pluginRoot, OPTIONS);
  assert.ok(outcome.ok, `取れなかった: ${outcome.ok ? "" : outcome.detail}`);
  assert.ok(outcome.value.size > 20, `承認語が少なすぎる（${outcome.value.size}）`);
  assert.ok(outcome.value.has("指紋"), "画面に最も多く出る語が辞書に無い");
  assert.ok(!outcome.value.has("同じページにいる"), "カルクの表が混ざっている");
});
