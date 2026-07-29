// TEST-004 — 追跡索引の橋渡しの受入。004-N は SPEC-004 の受入基準の番号に対応する。
// TEST-005 — コード側の面の受入。005-N は SPEC-005 の受入基準の番号に対応する。
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { staleDocumentIds, traceFindings, type AuditFinding } from "../doctrine/audit.js";
import type { RunOptions } from "../doctrine/cli.js";
import { locateDocsRoot, locatePluginRoot } from "../doctrine/locate.js";
import {
  fetchTraceRanges,
  isExempt,
  readExemptPaths,
  type TraceRange,
} from "../doctrine/trace.js";
import { buildScene, descend, ascend, NO_FOCUS, type Position } from "../model/depth.js";
import { DEFAULT_LENS, withDepth } from "../model/lens.js";
import { bandsForPath,
  groupByDocument,
  headlinesForPath,
  rangeAtLine,
  rangesForDocument,
  rangesForPath,
  actionOnSave,
  sameRanges,
  summarizeCoverage,
} from "../model/trace.js";
import { node, REGISTRY, twoDomainGraph } from "./fixture.js";

const PROJECT = resolve(__dirname, "..", "..");
const options: RunOptions = { pythonPath: "python3", timeoutMs: 30000, cwd: PROJECT };
const pluginRoot = (): string | null => locatePluginRoot(PROJECT);

function range(id: string, path: string, begin: number, end: number): TraceRange {
  return { id, path, begin_line: begin, end_line: end, fingerprint: `sha256:${id}${begin}` };
}

// --- TEST-004 -------------------------------------------------------------

test("004-1. 取得が上流と同じ範囲の組を返す", async (t) => {
  const plugin = pluginRoot();
  if (!plugin) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const outcome = await fetchTraceRanges(PROJECT, docsRoot, plugin, options);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.detail);
  assert.ok(outcome.value.length > 0, "この木には印が打ってある");
  for (const r of outcome.value) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.begin_line >= 1, "行は 1 から数える");
    assert.ok(r.end_line >= r.begin_line);
    assert.ok(r.fingerprint.startsWith("sha256:"));
  }
});

test("004-2. 統治外に挙げたパスの配下の範囲が落ちる", async (t) => {
  const plugin = pluginRoot();
  if (!plugin) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const exempt = readExemptPaths(docsRoot);
  assert.ok(exempt.includes("out/"), "この木は out/ を統治外に挙げている");

  const outcome = await fetchTraceRanges(PROJECT, docsRoot, plugin, options);
  assert.ok(outcome.ok);
  const offenders = outcome.value.filter((r) => r.path.startsWith("out/") || r.path.startsWith("dist/"));
  assert.deepEqual(offenders, [], "生成物の範囲が混じっている");
});

test("004-3. 宣言を消すとその配下の範囲が現れる", () => {
  // 設定の読み取りと照合だけを見る。CLI は起こさない。
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-exempt-"));
  try {
    mkdirSync(join(dir, "_system"), { recursive: true });
    const configPath = join(dir, "_system", ".context-config.json");

    writeFileSync(configPath, JSON.stringify({ trace_exempt: { "out/": "生成物" } }), "utf8");
    const withDeclaration = readExemptPaths(dir);
    assert.deepEqual(withDeclaration, ["out/"]);
    assert.equal(isExempt("out/model/lens.js", withDeclaration), true);

    writeFileSync(configPath, JSON.stringify({ trace_exempt: {} }), "utf8");
    const without = readExemptPaths(dir);
    assert.deepEqual(without, []);
    assert.equal(isExempt("out/model/lens.js", without), false, "宣言を消すと現れる");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("004-3b. 理由の無い宣言は成立せず、照合は上流と同じ規則にする", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-exempt-"));
  try {
    mkdirSync(join(dir, "_system"), { recursive: true });
    writeFileSync(
      join(dir, "_system", ".context-config.json"),
      JSON.stringify({ trace_exempt: { "a/": "理由あり", "b/": "  ", "c.ts": "理由あり", "d.ts": 1 } }),
      "utf8",
    );
    const paths = readExemptPaths(dir);
    assert.deepEqual(paths, ["a/", "c.ts"], "理由の無い項目は読み飛ばす");
    // 末尾 / は前置き、それ以外は完全一致。
    assert.equal(isExempt("a/deep/file.ts", paths), true);
    assert.equal(isExempt("c.ts", paths), true);
    assert.equal(isExempt("c.ts.map", paths), false, "完全一致であって前置きではない");
    assert.equal(isExempt("ab/file.ts", paths), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("004-3c. 設定が無い・壊れているときは宣言が無いものとして扱う", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-exempt-"));
  try {
    assert.deepEqual(readExemptPaths(dir), [], "設定が無い");
    mkdirSync(join(dir, "_system"), { recursive: true });
    writeFileSync(join(dir, "_system", ".context-config.json"), "{ 壊れている", "utf8");
    assert.deepEqual(readExemptPaths(dir), [], "壊れていても例外にしない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("004-4. 範囲が取れなくても場面は組める", () => {
  const graph = twoDomainGraph();
  const scene = buildScene(graph, DEFAULT_LENS, NO_FOCUS, REGISTRY, {
    ranges: null,
    staleIds: new Set(),
  });
  assert.ok(scene.nodes.length > 0, "L0 は範囲に依らない");
});

test("004-5. 指紋の突き合わせが実装のどこにも書かれていない", () => {
  // 指紋は上流が突き合わせる。こちらが sha を比べていたら REQ-003 の破れである。
  const offenders: string[] = [];
  for (const file of sourceFiles(join(PROJECT, "src"))) {
    const rel = file.slice(PROJECT.length + 1);
    if (rel.startsWith("src/test/")) continue;
    const text = readFileSync(file, "utf8");
    // 指紋どうしを比べる形（=== や !== の両側に fingerprint が現れる）を探す。
    if (/fingerprint\s*[=!]==/.test(text) || /[=!]==\s*[a-z]*\.?fingerprint/.test(text)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `指紋を突き合わせている: ${offenders.join(", ")}`);
});

test("004-6. 所見のうち追跡に関わるものだけを取り出す", () => {
  const findings: AuditFinding[] = [
    finding("trace_stale", "SPEC-003"),
    finding("dead_link", "SPEC-001"),
    finding("trace_broken_ref", "SPEC-002"),
    finding("projection_drift", "OVERVIEW-001"),
  ];
  const picked = traceFindings(findings);
  assert.deepEqual(picked.map((f) => f.check), ["trace_stale", "trace_broken_ref"]);
});

test("004-6b. 食い違いの id は上流の所見から拾うだけである", () => {
  const findings: AuditFinding[] = [
    { ...finding("trace_stale", "SPEC-003"), refs: ["SPEC-003", "SPEC-009"] },
    finding("trace_broken_ref", "SPEC-002"),
  ];
  const stale = staleDocumentIds(findings);
  assert.deepEqual([...stale].sort(), ["SPEC-003", "SPEC-009"]);
  assert.ok(!stale.has("SPEC-002"), "trace_stale 以外は食い違いではない");
});

// --- TEST-005 -------------------------------------------------------------

const nodesById = new Map([
  ["SPEC-001", node("SPEC-001", "SPEC", "lens", "current", { title: "橋渡し" } as never)],
  ["SPEC-002", node("SPEC-002", "SPEC", "lens", "current")],
]);

const sample: TraceRange[] = [
  range("SPEC-001", "src/a.ts", 1, 20),
  range("SPEC-002", "src/a.ts", 30, 40),
  range("SPEC-001", "src/b.ts", 5, 9),
];

test("005-1. 範囲の始まりの行に見出しが出る", () => {
  const headlines = headlinesForPath(sample, "src/a.ts", nodesById, new Set());
  assert.equal(headlines.length, 2);
  assert.deepEqual(headlines.map((h) => h.line), [1, 30]);
  assert.equal(headlines[0]?.docId, "SPEC-001");
  assert.equal(headlines[0]?.title, "橋渡し", "題は上流の節点から取る");
  assert.equal(headlines[1]?.title, null, "題が無ければ null");
});

test("005-2. 見出しは開く先の文書を持つ", () => {
  const headlines = headlinesForPath(sample, "src/b.ts", nodesById, new Set());
  assert.equal(headlines.length, 1);
  assert.equal(headlines[0]?.known, true);
  assert.equal(headlines[0]?.docId, "SPEC-001");
});

test("005-2b. グラフに無い文書の見出しは開く操作を無効にする", () => {
  const orphan = [range("SPEC-999", "src/c.ts", 3, 4)];
  const headlines = headlinesForPath(orphan, "src/c.ts", nodesById, new Set());
  assert.equal(headlines[0]?.known, false);
  assert.equal(headlines[0]?.title, null);
});

test("005-3. 食い違いが見出しに立つ", () => {
  const headlines = headlinesForPath(sample, "src/a.ts", nodesById, new Set(["SPEC-002"]));
  assert.equal(headlines[0]?.stale, false);
  assert.equal(headlines[1]?.stale, true);
});

test("005-4. 印を含まないファイルには何も出ない", () => {
  assert.deepEqual(headlinesForPath(sample, "src/zzz.ts", nodesById, new Set()), []);
  assert.deepEqual(rangesForPath(sample, "src/zzz.ts"), []);
});

test("005-5. 範囲の外を指すと対応が見つからない", () => {
  assert.equal(rangeAtLine(sample, "src/a.ts", 25), null, "範囲と範囲のあいだ");
  assert.equal(rangeAtLine(sample, "src/a.ts", 0), null, "行は 1 から数える");
  assert.equal(rangeAtLine(sample, "src/zzz.ts", 1), null, "範囲の無いファイル");
});

test("005-5b. 境界の行も範囲の内である", () => {
  assert.equal(rangeAtLine(sample, "src/a.ts", 1)?.id, "SPEC-001", "始まりの行");
  assert.equal(rangeAtLine(sample, "src/a.ts", 20)?.id, "SPEC-001", "終わりの行");
  assert.equal(rangeAtLine(sample, "src/a.ts", 21), null, "終わりの次の行");
});

test("005-5c. 重なりがあるときは最も内側を返す", () => {
  const nested = [range("SPEC-001", "src/n.ts", 1, 50), range("SPEC-002", "src/n.ts", 10, 20)];
  assert.equal(rangeAtLine(nested, "src/n.ts", 15)?.id, "SPEC-002");
  assert.equal(rangeAtLine(nested, "src/n.ts", 5)?.id, "SPEC-001");
});

test("005-6. 跳ぶ先が複数ある文書は複数の範囲を返す", () => {
  const mine = rangesForDocument(sample, "SPEC-001");
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((r) => r.path), ["src/a.ts", "src/b.ts"], "整列している");
  assert.equal(rangesForDocument(sample, "SPEC-002").length, 1);
  assert.equal(rangesForDocument(sample, "SPEC-999").length, 0);
});

test("005-7. 文書ごとの束ねと覆いの数え", () => {
  const grouped = groupByDocument(sample, new Set(["SPEC-002"]));
  assert.deepEqual(grouped.map((g) => g.docId), ["SPEC-001", "SPEC-002"]);
  assert.equal(grouped[0]?.ranges.length, 2);
  assert.equal(grouped[0]?.stale, false);
  assert.equal(grouped[1]?.stale, true);

  const coverage = summarizeCoverage(sample, new Set(["SPEC-002"]), [
    "SPEC-001", "SPEC-002", "SPEC-003",
  ]);
  assert.equal(coverage.tracedDocuments, 2);
  assert.equal(coverage.totalRanges, 3);
  assert.equal(coverage.staleDocuments, 1);
  assert.deepEqual(coverage.untracedSpecIds, ["SPEC-003"]);
});

// --- TEST-002 の追補（L3 の行き来） ---------------------------------------

test("002-8. L2 の焦点から L3 へ降り、範囲が節点として並ぶ", () => {
  const graph = twoDomainGraph();
  const ranges = [range("SPEC-001", "src/a.ts", 1, 20), range("SPEC-001", "src/b.ts", 5, 9)];
  const context = { ranges, staleIds: new Set<string>() };
  const position: Position = { depth: 2, focus: { domain: "lens", docId: "SPEC-001" } };
  const l2 = buildScene(graph, withDepth(DEFAULT_LENS, 2), position.focus, REGISTRY, context);

  const down = descend(position, "SPEC-001", l2, context);
  assert.ok(down, "焦点そのものを選ぶと降りる");
  assert.equal(down.depth, 3);
  assert.equal(down.focus.docId, "SPEC-001");

  const l3 = buildScene(graph, withDepth(DEFAULT_LENS, 3), down.focus, REGISTRY, context);
  assert.equal(l3.depth, 3);
  assert.equal(l3.nodes.length, 2);
  assert.ok(l3.nodes.every((n) => n.kind === "range"));
  assert.equal(l3.edges.length, 0, "範囲どうしの関係を上流は返さない");
  assert.equal(l3.nodes[0]?.count, 20, "背の高さに使う行数");
});

test("002-9. L3 から上がると同じ文書の L2 へ戻る", () => {
  const position: Position = { depth: 3, focus: { domain: "lens", docId: "SPEC-001" } };
  const up = ascend(position);
  assert.equal(up.depth, 2);
  assert.equal(up.focus.docId, "SPEC-001", "焦点の文書を保つ");
  assert.equal(ascend(up).depth, 1);
  assert.equal(ascend(ascend(up)).depth, 0);
});

test("002-10. 範囲を持たない文書からは L3 へ降りられない", () => {
  const graph = twoDomainGraph();
  const context = { ranges: [] as TraceRange[], staleIds: new Set<string>() };
  const position: Position = { depth: 2, focus: { domain: "lens", docId: "SPEC-001" } };
  const l2 = buildScene(graph, withDepth(DEFAULT_LENS, 2), position.focus, REGISTRY, context);
  assert.equal(descend(position, "SPEC-001", l2, context), null);
});

test("002-10b. 範囲が消えた状態で L3 を求めると L2 へ戻される", () => {
  const graph = twoDomainGraph();
  const scene = buildScene(
    graph,
    withDepth(DEFAULT_LENS, 3),
    { domain: "lens", docId: "SPEC-001" },
    REGISTRY,
    { ranges: [], staleIds: new Set() },
  );
  assert.equal(scene.depth, 2);
  assert.ok(scene.recovered, "戻した事実を載せる");
});

test("002-10c. 指紋が食い違う文書の L3 は、その印を節点に運ぶ", () => {
  const graph = twoDomainGraph();
  const ranges = [range("SPEC-001", "src/a.ts", 1, 20)];
  const scene = buildScene(
    graph,
    withDepth(DEFAULT_LENS, 3),
    { domain: "lens", docId: "SPEC-001" },
    REGISTRY,
    { ranges, staleIds: new Set(["SPEC-001"]) },
  );
  assert.equal(scene.depth, 3);
  assert.equal(scene.nodes[0]?.isFocus, true, "食い違いを isFocus で運ぶ");
});

// --- 道具 ------------------------------------------------------------------

function finding(check: string, docId: string): AuditFinding {
  return { check, severity: "warn", doc_id: docId, path: "", message: "", refs: [] };
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

// --- 帯（SPEC-005 受入基準 3・4） -----------------------------------------
//
// 帯の行と種類は編集器の型を使わずに決める。分けてあるので、
// 「食い違いが帯に出る」ことを編集器を起こさずに確かめられる。

test("005-3. 指紋が食い違う範囲の帯は種類が変わる", () => {
  const ranges = [
    { id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 10, fingerprint: "sha256:a" },
    { id: "SPEC-002", path: "src/a.ts", begin_line: 20, end_line: 30, fingerprint: "sha256:b" },
  ];
  const bands = bandsForPath(ranges, "src/a.ts", new Set(["SPEC-002"]), 999);
  assert.deepEqual(
    bands.map((b) => [b.id, b.stale]),
    [
      ["SPEC-001", false],
      ["SPEC-002", true],
    ],
    "食い違っている範囲だけが別の種類になる",
  );
  // 行は編集器と同じ 0 始まりへ直っている。
  assert.deepEqual(bands[0], { id: "SPEC-001", begin: 0, end: 9, stale: false });
});

test("005-4. 範囲を持たないファイルには帯が出ない", () => {
  const ranges = [{ id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 10, fingerprint: "sha256:a" }];
  assert.deepEqual(bandsForPath(ranges, "src/b.ts", new Set(), 999), []);
  assert.deepEqual(bandsForPath([], "src/a.ts", new Set(), 999), []);
});

test("ファイルの行数を超えた範囲は末尾へ寄せる", () => {
  // 上流の索引が古いと、既に短くなったファイルへ長い範囲が来る。
  // 例外にせず、末尾へ寄せる（SPEC-005 エラー時挙動）。
  const ranges = [{ id: "SPEC-001", path: "src/a.ts", begin_line: 40, end_line: 90, fingerprint: "sha256:a" }];
  assert.deepEqual(
    bandsForPath(ranges, "src/a.ts", new Set(), 9),
    [{ id: "SPEC-001", begin: 9, end: 9, stale: false }],
  );
});

// --- 保存の合図（SPEC-005 制約） -----------------------------------------

test("統治の .md と、既に印を持つ原本は、そのまま取り直す", () => {
  const ranges = [
    { id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 9, fingerprint: "sha256:a" },
  ];
  assert.equal(actionOnSave("doctrine_docs/lens/SPEC-001.md", "doctrine_docs", ranges), "refresh");
  assert.equal(actionOnSave("src/a.ts", "doctrine_docs", ranges), "refresh");
  // 作業フォルダの外。
  assert.equal(actionOnSave(null, "doctrine_docs", ranges), "ignore");
});

test("まだ知らないファイルは「無関係」ではなく「訊く」", () => {
  // 「知っている範囲に載っていない＝無関係」と決めつけると、印を新しく書いて
  // 保存した原本が永久に拾われない。見出しも帯も出ず、手がかりも出ない。
  // 「コードに印を書いて保存する」は SPEC-005 の中心の流れである。
  const ranges = [
    { id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 9, fingerprint: "sha256:a" },
  ];
  assert.equal(actionOnSave("src/b.ts", "doctrine_docs", ranges), "probe");
  assert.equal(actionOnSave("notes.txt", "doctrine_docs", ranges), "probe");
  assert.equal(actionOnSave("README.md", "doctrine_docs", ranges), "probe");
  // 訊くのは一本だけである（すべて取り直すと七本走る）。
});

test("範囲がまだ取れていないうちは取り直す（取れるまで動かないよりよい）", () => {
  assert.equal(actionOnSave("src/a.ts", "doctrine_docs", null), "refresh");
});

test("統治木の名前が違っても効く（docs/ を使う木）", () => {
  assert.equal(actionOnSave("docs/lens/SPEC-001.md", "docs", []), "refresh");
  assert.equal(actionOnSave("docsx/lens/SPEC-001.md", "docs", []), "probe", "前方一致だけで通さない");
});

test("範囲の集合の異同で、印が足された・消えたを見分ける", () => {
  const a = { id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 9, fingerprint: "sha256:a" };
  const b = { id: "SPEC-002", path: "src/b.ts", begin_line: 1, end_line: 5, fingerprint: "sha256:b" };
  assert.equal(sameRanges([a], [a]), true);
  assert.equal(sameRanges([a], [a, b]), false, "印が足されたことを見落とす");
  assert.equal(sameRanges([a, b], [b, a]), true, "並びの違いは同じと見る");
  assert.equal(sameRanges([a], [{ ...a, end_line: 20 }]), false, "範囲が動いたことを見落とす");
  // 指紋だけが変わった回は、印の集合としては同じである（中身の変化は監査が見る）。
  assert.equal(sameRanges([a], [{ ...a, fingerprint: "sha256:z" }]), true);
});

test("経路の突き合わせが Windows の区切りを吸収する", () => {
  const ranges = [
    { id: "SPEC-001", path: "src/a.ts", begin_line: 1, end_line: 9, fingerprint: "sha256:a" },
  ];
  // 編集器から来る経路は環境ごとの区切りを持つ。揃えないと Windows でだけ外れる。
  assert.equal(rangesForPath(ranges, "src\\a.ts").length, 1, "\\ を / に揃えていない");
  assert.equal(rangesForPath(ranges, "src/a.ts").length, 1);
  assert.equal(rangesForPath(ranges, "src/b.ts").length, 0);
});

test("上流が終わりを始まりより手前に返しても、帯の行が逆さにならない", () => {
  // 索引が壊れている木でも、編集器へ渡す範囲は begin <= end でなければならない。
  const ranges = [
    { id: "SPEC-001", path: "src/a.ts", begin_line: 40, end_line: 10, fingerprint: "sha256:a" },
  ];
  const band = bandsForPath(ranges, "src/a.ts", new Set(), 999)[0];
  assert.ok(band);
  assert.ok(band.begin <= band.end, `逆さの帯が出ている: ${band.begin}-${band.end}`);
});
