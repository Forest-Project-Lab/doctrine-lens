// TEST-006 — 帰結の明細の受入。番号は SPEC-006 の受入基準に対応する。
//
// 1・11・12（画面の側）は preview と design.test.ts が受け持つ。
// ここは判断の側だけを見る。編集器を起こさずに確かめられる範囲である。
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import type { AuditFinding } from "../doctrine/audit.js";
import type { Graph } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";
import { buildConsequence, symbolFor, weightOf, type Symbol } from "../model/consequence.js";
import { buildView } from "../model/view.js";
import type { DocMetaIndex } from "../doctrine/titles.js";

// --- 見本 ------------------------------------------------------------------

function node(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    path: `lens/${id}.md`,
    type: id.split("-")[0],
    domain: "lens",
    status: "current",
    depends_on: [],
    impacts: [],
    canonical_for: [],
    ...extra,
  };
}

/** `A>B` は「B depends_on A」。`A~B` は「A impacts B」。 */
function graphOf(ids: readonly string[], wires: readonly string[]): Graph {
  const edges = wires.map((wire) => {
    if (wire.includes(">")) {
      const [from, to] = wire.split(">") as [string, string];
      return { src: to, dst: from, field: "depends_on", kind: "intra_domain" };
    }
    const [from, to] = wire.split("~") as [string, string];
    return { src: from, dst: to, field: "impacts", kind: "intra_domain" };
  });
  return { nodes: ids.map((id) => node(id)), edges } as unknown as Graph;
}

function finding(docId: string, severity: string, message: string): AuditFinding {
  return { check: "dead_link", severity, doc_id: docId, path: "", message, refs: [] };
}

function range(id: string, path = "src/a.ts"): TraceRange {
  return { id, path, begin_line: 1, end_line: 9, fingerprint: "" } as unknown as TraceRange;
}

const NO_CONTEXT = { findings: [], ranges: [], reverseOrphans: new Set<string>() };

/** 行を id の順に平らへ均す。波の番号を添える。 */
function flatten(c: ReturnType<typeof buildConsequence>): string[] {
  return c.waves.flatMap((w) => w.rows.map((r) => `${w.distance}:${r.symbol}:${r.id}`));
}

// --- 受入 ------------------------------------------------------------------

test("006-2. 波及先が距離ごとの波に分かれ、遠回りのほうを採る", () => {
  // 起点 → C → B と 起点 → B の両方がある。B は C の後に直す。
  const graph = graphOf(["SPEC-001", "B", "C"], ["SPEC-001>C", "SPEC-001>B", "C>B"]);
  const c = buildConsequence(graph, "SPEC-001", {
    ...NO_CONTEXT,
    ranges: [range("B"), range("C")],
  });
  assert.deepEqual(
    c.waves.map((w) => [w.distance, w.rows.map((r) => r.id)]),
    [
      [1, ["C"]],
      [2, ["B"]],
    ],
    "最短距離で並べると B が第 1 波に出る。それは間違った順である",
  );
});

test("006-2b. 同じ波の中は「後ろに N」の降順に並ぶ", () => {
  // X の後ろには二つ（Y・Z）。W の後ろには何も無い。
  const graph = graphOf(["O", "W", "X", "Y", "Z"], ["O>W", "O>X", "X>Y", "Y>Z"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const first = c.waves.find((w) => w.distance === 1);
  assert.deepEqual(
    first?.rows.map((r) => [r.id, r.behind]),
    [
      ["X", 2],
      ["W", 0],
    ],
  );
});

test("006-3. 依存と影響の両方で結ばれた隣が、一行としてだけ出る", () => {
  // 上流の統治木では、これが最も多い形である（同じ事実を二箇所へ書く）。
  const graph = graphOf(["O", "P"], ["O>P", "O~P"]);
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: [range("P")] });
  assert.equal(c.summary.documents, 1, "同じ事実が二行にならない");
  assert.deepEqual(flatten(c), ["1:fix:P"], "依存の側を理由に採る（直し方が具体である）");
});

test("006-4. ! の行と ~ の行が、別の記号と別の一文で出る", () => {
  const graph = graphOf(["O", "D", "I"], ["O>D", "O~I"]);
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: [range("D"), range("I")] });
  const rows = c.waves.flatMap((w) => w.rows);
  const d = rows.find((r) => r.id === "D");
  const i = rows.find((r) => r.id === "I");
  assert.equal(d?.symbol, "fix");
  assert.equal(i?.symbol, "review");
  assert.equal(d?.reason.kind, "depends-directly");
  assert.equal(i?.reason.kind, "impacted");
});

test("006-4b. 三段先の影響の行が、起点ではなく直前の相手を名指す", () => {
  // 「起点が影響すると宣言している」は、三段先では事実ではない。
  const graph = graphOf(["O", "A", "B"], ["O~A", "A~B"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const b = c.waves.flatMap((w) => w.rows).find((r) => r.id === "B");
  assert.equal(b?.reason.kind, "impacted");
  assert.equal(b?.reason.kind === "impacted" ? b.reason.by : "", "A", "宣言したのは A である");
});

test("006-5. 行の主文が題名で、id は副文に落ちる", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const meta: DocMetaIndex = new Map([
    ["O", { title: "起点の題", updated: "2026-07-29", supersededBy: "" }],
    ["P", { title: "波及先の題", updated: "", supersededBy: "" }],
  ]);
  const view = buildView(c, meta, strings(), CONTEXT);
  assert.equal(view.origin?.title, "起点の題");
  assert.ok(view.origin?.detail.startsWith("O · "), "id はパスと並んで副文へ");
  assert.equal(view.waves[0]?.rows[0]?.title, "波及先の題");
});

test("006-5b. 題名が取れない行は id を主文へ落とし、脚注に断る", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const view = buildView(c, new Map(), strings(), { ...CONTEXT, titlesMissing: true });
  assert.equal(view.waves[0]?.rows[0]?.title, "P");
  assert.ok(view.footnotes.includes("題名が無い"), "取れなかったことを言う");
});

test("006-6. 出していないものの件数が脚注に出る", () => {
  const graph = graphOf(["O", "P", "余り1", "余り2"], ["O>P"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.equal(c.unreached, 2, "起点にも波及先にも入らない二つ");
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(view.footnotes.some((f) => f.includes("隠した 2")), `脚注: ${view.footnotes}`);
});

test("006-7. 起点が無いとき、空の絵ではなく文が出て、開いているものの名が挙がる", () => {
  const c = buildConsequence(graphOf(["A"], []), null, NO_CONTEXT);
  assert.equal(c.origin, null);
  assert.deepEqual(c.waves, []);
  const view = buildView(c, new Map(), strings(), { ...CONTEXT, openFile: "src/nowhere.ts" });
  assert.equal(view.origin, null);
  assert.ok(view.emptyReason.includes("src/nowhere.ts"), `文: ${view.emptyReason}`);
});

test("006-7b. 起点に指した id がグラフに無ければ、起点が無いものとして扱う", () => {
  const c = buildConsequence(graphOf(["A"], []), "居ない", NO_CONTEXT);
  assert.equal(c.origin, null, "例外にしない");
  assert.equal(c.unreached, 1);
});

test("006-8. 循環に入った文書は波に入らず、一行の文字列として出る", () => {
  const graph = graphOf(["O", "A", "B"], ["O>A", "A>B", "B>A"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.equal(c.cycles.length, 1);
  assert.deepEqual(c.cycles[0]?.path, ["A", "B", "A"], "先頭と末尾が同じ id");
  assert.deepEqual(flatten(c), [], "循環の中の文書は波に混ざらない");
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.equal(view.cycles[0]?.path, "A → B → A");
});

test("006-8b. 循環でない相互のペアを循環と呼ばない", () => {
  // depends_on と impacts の対は同じ事実を二度書いたものであり、循環ではない。
  // 旧画面はこれを二本の矢印で描き、利用者に「異常か？」と読ませた。
  const graph = graphOf(["O", "P"], ["O>P", "O~P"]);
  assert.deepEqual(buildConsequence(graph, "O", NO_CONTEXT).cycles, []);
});

test("006-8c. 自己ループを波にも循環にも数えない", () => {
  const graph = graphOf(["O", "P"], ["O>P", "P>P", "O>O"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.deepEqual(c.cycles, []);
  assert.equal(c.summary.documents, 1);
});

test("006-9. 上流の所見の文が、一字も変えずに出る", () => {
  const long =
    "SPEC-002 は deprecated だが superseded_by が空である。降格の手順を最後まで踏むこと。";
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("P", "error", long)],
  });
  const row = c.waves[0]?.rows[0];
  assert.equal(row?.symbol, "broken", "重い所見が付いていれば × が最も重い");
  assert.equal(row?.findings[0]?.message, long);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.equal(view.waves[0]?.rows[0]?.findings[0], long, "描く側でも切り詰めない");
});

test("006-9b. 起点の外の所見の件数を脚注に出す（黙って捨てない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("よそ", "info", "よその話")],
  });
  assert.equal(c.findingsElsewhere, 1);
});

// --- 記号 ------------------------------------------------------------------

test("記号は重い順に排他で、それぞれ一つの事実から出る", () => {
  const heavy = [finding("X", "error", "")];
  // × は他の何より重い。
  assert.equal(
    symbolFor({ findings: heavy, isReverseOrphan: true, rangeCount: 0, kind: "impacted" }),
    "broken",
  );
  // + は ? より重い。
  assert.equal(
    symbolFor({ findings: [], isReverseOrphan: true, rangeCount: 0, kind: "impacted" }),
    "missing",
  );
  // ? は方向より重い。
  assert.equal(
    symbolFor({ findings: [], isReverseOrphan: false, rangeCount: 0, kind: "depends-directly" }),
    "nowhere",
  );
  // 残りは方向で分かれる。
  assert.equal(
    symbolFor({ findings: [], isReverseOrphan: false, rangeCount: 1, kind: "depends-directly" }),
    "fix",
  );
  assert.equal(
    symbolFor({ findings: [], isReverseOrphan: false, rangeCount: 1, kind: "impacted" }),
    "review",
  );
});

test("軽い所見だけでは × にしない（重さの語彙は上流が定める）", () => {
  assert.equal(
    symbolFor({
      findings: [finding("X", "info", "")],
      isReverseOrphan: false,
      rangeCount: 1,
      kind: "depends-directly",
    }),
    "fix",
  );
});

test("記号の重さが五つとも異なる（畳むと排他が壊れる）", () => {
  const marks: Symbol[] = ["broken", "missing", "nowhere", "fix", "review"];
  const weights = marks.map(weightOf);
  assert.equal(new Set(weights).size, 5);
  assert.deepEqual([...weights].sort((a, b) => a - b), weights, "宣言の順が重い順である");
});

test("所見は doc_id だけでなく refs でも引く（上流が二つの持ち方をする）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const withRefs: AuditFinding = { ...finding("よそ", "warn", "文"), refs: ["P"] };
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, findings: [withRefs] });
  assert.equal(c.waves[0]?.rows[0]?.symbol, "broken");
});

// --- 要約 ------------------------------------------------------------------

test("良い状態を空白で表さず、数で言う", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: [range("P")] });
  assert.deepEqual(c.summary, {
    documents: 1,
    codeRanges: 1,
    nowhere: 0,
    broken: 0,
    missing: 0,
    cycles: 0,
  });
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(view.summary.includes("壊れている 0"), `要約: ${view.summary}`);
});

test("誰も依存していない文書は、空の一覧ではなく 0 として出る", () => {
  const c = buildConsequence(graphOf(["O", "他"], []), "O", NO_CONTEXT);
  assert.deepEqual(c.waves, []);
  assert.equal(c.summary.documents, 0);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(view.origin, "起点そのものは出る");
  assert.ok(view.summary.includes("0 文書"), `要約: ${view.summary}`);
});

test("同じ入力から同じ出力が出る（並びが機械の気分で変わらない）", () => {
  const graph = graphOf(["O", "A", "B", "C"], ["O>A", "O>B", "O>C"]);
  const once = flatten(buildConsequence(graph, "O", NO_CONTEXT));
  const twice = flatten(buildConsequence(graph, "O", NO_CONTEXT));
  assert.deepEqual(once, twice);
  assert.deepEqual(once, ["1:nowhere:A", "1:nowhere:B", "1:nowhere:C"]);
});

test("深い鎖でも呼び出し段が尽きない（再帰で書くと落ちる）", () => {
  const ids = ["O", ...Array.from({ length: 6000 }, (_, i) => `N${i}`)];
  const wires = ids.slice(0, -1).map((id, i) => `${id}>${ids[i + 1]}`);
  const c = buildConsequence(graphOf(ids, wires), "O", NO_CONTEXT);
  assert.equal(c.summary.documents, 6000);
  assert.equal(c.waves.at(-1)?.distance, 6000);
});

// --- 道具 ------------------------------------------------------------------

const CONTEXT = { openFile: "src/a.ts", auditAt: "2026-07-29 09:14", titlesMissing: false };

/** 差し込みの位置だけを見る、短い見本の文言。訳の中身は l10n.test.ts が見る。 */
function strings(): Parameters<typeof buildView>[2] {
  return {
    summaryCounts: "{0} 文書 / コード {1} / 場所無し {2}",
    summaryJudgements: "壊れている {0} / 足りない {1} / 循環 {2}",
    waveHeading: "第 {0} 波",
    waveFirstNote: "直に載る",
    waveLaterNote: "第 {0} 波の後",
    reasonDirect: "depends_on に {0}",
    reasonThrough: "{0} を経由して {1}",
    reasonImpacted: "{0} が影響すると宣言",
    rangeLabel: "{0}:{1}-{2}",
    noOrigin: "起点が無い。開いているのは {0}",
    noOriginNoFile: "起点が無い",
    footHidden: "隠した {0}",
    footElsewhere: "外に {0}",
    footAudit: "監査 {0}",
    footAuditNever: "監査まだ",
    footNoTitles: "題名が無い",
    cycleNote: "循環 {0}",
    legendBroken: "×",
    legendMissing: "+",
    legendNowhere: "?",
    legendFix: "!",
    legendReview: "~",
  };
}

// --- 上流の判定を捨てない ---------------------------------------------------

test("上流の 34 検査すべてが橋を渡る（追跡の検査だけに絞らない）", async (t) => {
  // 旧実装は check が "trace" で始まるものだけを通していた。34 のうち 11 である。
  // 判断の層を橋の上で捨てていたので、画面は事実しか言えず、判断は読み手に残った。
  // 利用者の「依存されているから何？」は、その帰結である。
  const { locatePluginRoot, locateDocsRoot } = await import("../doctrine/locate.js");
  const { fetchFindings } = await import("../doctrine/audit.js");
  const project = resolve(__dirname, "..", "..");
  const pluginRoot = locatePluginRoot(project);
  const docsRoot = locateDocsRoot(project);
  if (!pluginRoot || !docsRoot) return t.skip("doctrine プラグインか統治木が無い");

  const outcome = await fetchFindings(project, docsRoot, pluginRoot, {
    pythonPath: "python3",
    timeoutMs: 60000,
    cwd: project,
  });
  assert.ok(outcome.ok, `監査に失敗した: ${outcome.ok ? "" : outcome.detail}`);
  const checks = new Set(outcome.value.map((f) => f.check));
  const nonTrace = [...checks].filter((c) => !c.startsWith("trace"));
  assert.ok(
    nonTrace.length > 0,
    `追跡以外の所見が一つも来ていない（来た検査: ${[...checks].join(", ") || "無し"}）`,
  );
});
