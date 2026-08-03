// TEST-006 — 帰結の明細の受入。番号は SPEC-006 の受入基準に対応する。
//
// 1・11・12（画面の側）は preview と design.test.ts が受け持つ。
// ここは判断の側だけを見る。編集器を起こさずに確かめられる範囲である。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import type { AuditFinding } from "../doctrine/audit.js";
import type { Graph } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";
import { buildConsequence, symbolFor, weightOf, type Symbol } from "../model/consequence.js";
import { buildView } from "../model/view.js";
import type { DocMetaIndex } from "../doctrine/model.js";
import { REGISTRY } from "./fixture.js";

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

const NO_CONTEXT = {
  findings: [],
  ranges: [] as TraceRange[] | null,
  reverseOrphans: new Set<string>(),
  // 何も取れていない状態。現行かどうかも判じられない（status は全部出る）。
  registry: null as typeof REGISTRY | null,
};

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

test("006-2c. 右端の数に説明が付き、意味の違う二つの数が同じ形にならない", () => {
  // 波の見出しの数（件数）と、行の右端の数（後ろに N）は同じ位置に出る。
  // 裸の数を二種類そこへ置くと、どちらがどちらか読めない。
  const graph = graphOf(["O", "W", "X", "Y"], ["O>W", "O>X", "X>Y"]);
  const view = buildView(buildConsequence(graph, "O", NO_CONTEXT), new Map(), strings(), CONTEXT);
  assert.equal(view.waves[0]?.count, "2 文書", "波の件数は単位の語を伴う");
  assert.ok(
    view.footnotes.some((f) => f.includes("右端の数")),
    `右端の数の説明が無い: ${view.footnotes}`,
  );
});

test("006-2d. 右端の数が一つも無いときは、その説明を出さない", () => {
  const graph = graphOf(["O", "A"], ["O>A"]);
  const view = buildView(buildConsequence(graph, "O", NO_CONTEXT), new Map(), strings(), CONTEXT);
  assert.ok(!view.footnotes.some((f) => f.includes("右端の数")), "説明だけが浮く");
});

test("006-13. 脚注の検査の数が、渡された数そのものである（代弁の語を置かない）", () => {
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  const view = buildView(c, new Map(), strings(), { ...CONTEXT, checksRun: 34 });
  assert.ok(view.footnotes.some((f) => f.includes("34 検査")), `脚注: ${view.footnotes}`);
  // 上流が増やしたら追随する。実装が数を持っていればここで固まる。
  const more = buildView(c, new Map(), strings(), { ...CONTEXT, checksRun: 41 });
  assert.ok(more.footnotes.some((f) => f.includes("41 検査")), `脚注: ${more.footnotes}`);
});

test("006-14. 行が status を出し、後継が在れば併記する", () => {
  const graph = graphOf(["O", "古い"], ["O>古い"]);
  // 上流が返した status を素通しする。語彙をこちらが持たない。
  (graph.nodes as { id: string; status: string }[]).forEach((n) => {
    if (n.id === "古い") n.status = "deprecated";
  });
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.equal(c.waves[0]?.rows[0]?.status, "deprecated", "模型が status を運んでいない");

  const meta: DocMetaIndex = new Map([
    ["古い", { title: "退役した仕様", updated: "", supersededBy: "SPEC-006" }],
  ]);
  const view = buildView(c, meta, strings(), CONTEXT);
  assert.equal(view.waves[0]?.rows[0]?.status, "deprecated");
  assert.equal(view.waves[0]?.rows[0]?.succeeds, "後継 SPEC-006");
});

test("006-23. 現行は語らず、外れたものだけ語る。語彙は上流から来る", () => {
  const graph = graphOf(["O", "現行のもの", "古い"], ["O>現行のもの", "O>古い"]);
  const nodes = graph.nodes as { id: string; status: string }[];
  // 見本の status も語彙も、上流の登録簿が返した値を使う（試験は門の対象外）。
  const 現行 = REGISTRY.currentStatuses[0] as string;
  const 非現行 = REGISTRY.allStatuses.find((s) => !REGISTRY.currentStatuses.includes(s)) as string;
  nodes.forEach((n) => {
    if (n.id === "現行のもの") n.status = 現行;
    if (n.id === "古い") n.status = 非現行;
  });

  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    registry: REGISTRY,
  });
  const rows = c.waves.flatMap((w) => w.rows);
  const 現行行 = rows.find((r) => r.id === "現行のもの");
  const 非現行行 = rows.find((r) => r.id === "古い");

  // 模型は事実を両方持つ。素通しの値は消さない。
  assert.equal(現行行?.notCurrent, false);
  assert.equal(現行行?.status, 現行, "模型は上流の値を捨てない");
  assert.equal(非現行行?.notCurrent, true);

  // 画面へ渡る段で、既定だけが黙る。
  const view = buildView(c, new Map(), strings(), CONTEXT);
  const 見え = new Map(view.waves.flatMap((w) => w.rows).map((r) => [r.id, r.status]));
  assert.equal(見え.get("現行のもの"), "", "現行の行が語っている");
  assert.equal(見え.get("古い"), 非現行, "非現行の行が黙っている");
});

test("006-24. 要約の非現行の数が、status の出ている行の本数に一致する", () => {
  const graph = graphOf(["O", "A", "B", "C"], ["O>A", "O>B", "O>C"]);
  const 現行 = REGISTRY.currentStatuses[0] as string;
  const 非現行 = REGISTRY.allStatuses.find((s) => !REGISTRY.currentStatuses.includes(s)) as string;
  (graph.nodes as { id: string; status: string }[]).forEach((n) => {
    n.status = n.id === "A" ? 現行 : 非現行;
  });

  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    registry: REGISTRY,
  });
  const view = buildView(c, new Map(), strings(), CONTEXT);
  const 語る行 = view.waves.flatMap((w) => w.rows).filter((r) => r.status !== "").length;

  assert.equal(c.summary.facts.notCurrent, 2, "B と C の 2 件");
  assert.equal(語る行, 2, "画面で語っている行と数が食い違う");
  assert.ok(view.summary.includes("非現行 2"), `要約: ${view.summary}`);
});

test("006-25. 判じられない回は隠さない。全行に出し、数は出さない", () => {
  const graph = graphOf(["O", "A", "B"], ["O>A", "O>B"]);
  const 現行 = REGISTRY.currentStatuses[0] as string;
  (graph.nodes as { id: string; status: string }[]).forEach((n) => {
    n.status = 現行;
  });

  // 登録簿が取れなかった回。空集合ではなく null を渡す。
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, registry: null });
  const rows = c.waves.flatMap((w) => w.rows);
  assert.ok(
    rows.every((r) => r.notCurrent === null),
    "取れなかったことを false に潰している（全部現行だと言ったことになる）",
  );

  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(
    view.waves.flatMap((w) => w.rows).every((r) => r.status === 現行),
    "隠す根拠が無いのに隠している",
  );
  assert.equal(c.summary.facts.notCurrent, null);
  assert.ok(!view.summary.includes("非現行"), `要約: ${view.summary}`);
});

test("006-25b. 空集合を渡されても、全行が非現行に化けない見張り", () => {
  // `null` と `new Set()` を取り違えると、全行が非現行として語り出す。
  // 呼ぶ側の規律であることを、ここで明文にしておく（ADR-017 の形）。
  const graph = graphOf(["O", "A"], ["O>A"]);
  const 現行 = REGISTRY.currentStatuses[0] as string;
  (graph.nodes as { id: string; status: string }[]).forEach((n) => {
    n.status = 現行;
  });
  const 空 = buildConsequence(graph, "O", { ...NO_CONTEXT, registry: { ...REGISTRY, currentStatuses: [] } });
  assert.equal(空.summary.facts.notCurrent, 1, "空集合は『どれも現行でない』を意味する");
  const 未取得 = buildConsequence(graph, "O", { ...NO_CONTEXT, registry: null });
  assert.equal(未取得.summary.facts.notCurrent, null, "取れなかったことは数にならない");
});

test("006-14b. 後継が無ければ何も出さない（空の札を置かない）", () => {
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.equal(view.waves[0]?.rows[0]?.succeeds, "");
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
  assert.equal(view.waves[0]?.rows[0]?.findings[0]?.message, long, "描く側でも切り詰めない");
});

test("006-9b. 起点の外の所見の件数を脚注に出す（黙って捨てない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("よそ", "info", "よその話")],
  });
  assert.deepEqual([...c.findingsElsewhereAt], ["よそ"], "行き先を挙げていない");
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
  assert.deepEqual(c.summary.bySymbol, { broken: 0, missing: 0, nowhere: 0, fix: 1, review: 0 });
  // 現行かどうかは判じられていない。0 と書くと「一つも無い」ことになる（ADR-021）。
  assert.deepEqual(c.summary.facts, { broken: 0, missing: 0, noRange: 0, notCurrent: null });
  assert.equal(c.summary.documents, 1);
  assert.equal(c.summary.codeRanges, 1);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(view.summary.includes("壊れている 0"), `要約: ${view.summary}`);
  // 判じられない回は、数そのものを出さない。
  assert.ok(!view.summary.includes("非現行"), `要約: ${view.summary}`);
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


// --- ADR-017: 画面が確かめていないことを言わない -----------------------------

test("006-18. 強連結成分の全員が数えられる（一巡に載らない要素が消えない）", () => {
  // A↔B, B↔C。A から書き下せる一巡は A→B→A で、C は経路に載らない。
  // 経路から件数を数えていたので、C は行にも循環にも出ず「届かない」に化けていた。
  const graph = graphOf(["O", "A", "B", "C"], ["O>A", "A>B", "B>A", "B>C", "C>B"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.equal(c.cycles.length, 1);
  assert.deepEqual([...(c.cycles[0]?.members ?? [])], ["A", "B", "C"], "成分の全員を運ぶ");
  assert.equal(c.summary.inCycle, 3, "畳んだ文書の数を言う");
  assert.equal(c.unreached, 0, "届くものを「届かない」と数えない");
});

test("006-18b. 件数が負にならない（辺だけが指す死んだ参照）", () => {
  const graph = graphOf(["O", "A"], ["O>A", "A>幽霊", "幽霊>A"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.ok(c.unreached >= 0, `件数が負である: ${c.unreached}`);
  assert.equal(c.unreached, 0);
});

test("006-15. 起点自身の所見が画面に届く（壊れていても 0 と言わない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("O", "error", "起点が壊れている")],
  });
  assert.equal(c.originSymbol, "broken", "起点の記号が出ない");
  assert.equal(c.originFindings.length, 1, "起点の所見が落ちている");
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.equal(view.origin?.symbol, "broken");
  assert.equal(view.origin?.findings[0]?.message, "起点が壊れている");
  assert.equal(view.origin?.findings[0]?.severity, "error");
});

test("006-16. 「外」は「画面のどこにも出ていない」である（起点以外ではない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("P", "error", "行に出る"), finding("よそ", "info", "出ない")],
  });
  assert.equal(c.waves[0]?.rows[0]?.findings.length, 1, "行に出ている");
  // 行に出ている所見は「外」に数えない。外なのは「よそ」の一件だけ。
  assert.deepEqual([...c.findingsElsewhereAt], ["よそ"], "行に出ている所見を「外」に数えている");
});

test("006-17b. 記号に負けた事実も数える（排他は行の規律であって数の規律ではない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("P", "error", "壊れている")],
    reverseOrphans: new Set(["P"]),
  });
  assert.equal(c.summary.bySymbol.broken, 1, "行の記号は最も重いもの");
  assert.equal(c.summary.facts.missing, 1, "逆孤児である事実が数から消えている");
  assert.equal(c.summary.facts.noRange, 1, "範囲が無い事実が数から消えている");
});

test("006-17. 記号ごとの件数の和が、直すことになる文書の数に一致する", () => {
  const graph = graphOf(["O", "A", "B", "C"], ["O>A", "O>B", "O~C"]);
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: [range("A")] });
  const sum = Object.values(c.summary.bySymbol).reduce((a, b) => a + b, 0);
  assert.equal(sum, c.summary.documents, `和が合わない: ${JSON.stringify(c.summary.bySymbol)}`);
});

test("006-19. 起点が前提にしているものを「繋がらない」に混ぜない", () => {
  // O は A に依存し、B は O に依存する。C はどちらにも繋がらない。
  const graph = graphOf(["O", "A", "B", "C"], ["A>O", "O>B"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  assert.deepEqual(c.waves.flatMap((w) => w.rows.map((r) => r.id)), ["B"], "帰結は B だけ");
  assert.equal(c.premiseCount, 1, "起点が前提にしている A を数えていない");
  assert.equal(c.unreached, 1, "どちらにも繋がらないのは C だけ");
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(view.footnotes.some((f) => f.includes("前提 1")), `脚注: ${view.footnotes}`);
  assert.ok(view.footnotes.some((f) => f.includes("隠した 1")), `脚注: ${view.footnotes}`);
});


test("006-20. 範囲を取れなかったことと、範囲が無いことを区別する", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  // 取れなかった（null）。「直す場所が無い」と断定してはならない。
  const unknown = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: null });
  assert.equal(unknown.rangesKnown, false);
  assert.notEqual(unknown.waves[0]?.rows[0]?.symbol, "nowhere", "知らないことを断定している");
  // 取れていて、本当に零件。
  const known = buildConsequence(graph, "O", { ...NO_CONTEXT, ranges: [] });
  assert.equal(known.rangesKnown, true);
  assert.equal(known.waves[0]?.rows[0]?.symbol, "nowhere");
});

test("006-28. 取れていない事実の数を、要約が 0 と断定しない", () => {
  const graph = graphOf(["O", "P", "Q"], ["O>P", "O>Q"]);
  const 取れた = { ...NO_CONTEXT, findings: [], ranges: [range("P")], reverseOrphans: new Set<string>() };

  // 全部取れていれば、数はすべて出る（0 も数で言う。ADR-014）。
  const 全部 = buildConsequence(graph, "O", 取れた);
  assert.equal(全部.summary.codeRanges, 1);
  assert.equal(全部.summary.facts.broken, 0);
  assert.equal(全部.summary.facts.missing, 0);
  assert.equal(全部.summary.facts.noRange, 1);

  // 取れていない事実は `null`。**0 と書くと「一つも無い」ことになる。**
  const 範囲なし = buildConsequence(graph, "O", { ...取れた, ranges: null });
  assert.equal(範囲なし.summary.codeRanges, null, "コード範囲を 0 と断定している");
  assert.equal(範囲なし.summary.facts.noRange, null, "「範囲が無い」を数で断定している");

  const 所見なし = buildConsequence(graph, "O", { ...取れた, findings: null });
  assert.equal(所見なし.summary.facts.broken, null, "「壊れている 0」と断定している");

  const 逆孤児なし = buildConsequence(graph, "O", { ...取れた, reverseOrphans: null });
  assert.equal(逆孤児なし.summary.facts.missing, null, "「足りない 0」と断定している");
});

test("006-28b. 取れていない数は、画面のその場に出ない", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const 取れた = { ...NO_CONTEXT, findings: [], ranges: [range("P")], reverseOrphans: new Set<string>() };

  const 全部 = buildView(buildConsequence(graph, "O", 取れた), new Map(), strings(), CONTEXT);
  assert.ok(全部.summary.includes("コード"), `要約: ${全部.summary}`);
  assert.ok(全部.summary.includes("壊れている 0"), `要約: ${全部.summary}`);

  const 何も無い = buildView(
    buildConsequence(graph, "O", { ...取れた, ranges: null, findings: null, reverseOrphans: null }),
    new Map(),
    strings(),
    CONTEXT,
  );
  assert.ok(!何も無い.summary.includes("コード"), `取れていないコード範囲を出している: ${何も無い.summary}`);
  assert.ok(!何も無い.summary.includes("壊れている"), `取れていない所見を出している: ${何も無い.summary}`);
  assert.ok(!何も無い.summary.includes("足りない"), `取れていない逆孤児を出している: ${何も無い.summary}`);
  assert.ok(!何も無い.summary.includes("範囲無し"), `取れていない範囲を出している: ${何も無い.summary}`);
  // 文書の数は取れている。消えてはならない。
  assert.ok(何も無い.summary.includes("1 文書"), `要約: ${何も無い.summary}`);
});

test("006-28c. 取れていない事実を記号と比べて、誤った理由の脚注を出さない", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const view = buildView(
    buildConsequence(graph, "O", { ...NO_CONTEXT, findings: null, ranges: null, reverseOrphans: null }),
    new Map(),
    strings(),
    CONTEXT,
  );
  // 記号は 0、事実は null。`null !== 0` を食い違いと読むと、
  // 「記号は最も重い一つしか出ないから」という誤った理由が付く。
  assert.ok(
    !view.footnotes.some((f) => f.includes("最も重い")),
    `取れていないことを、排他のせいにしている: ${view.footnotes}`,
  );
});

test("006-29. 検査の一覧が取れない回に「0 検査を走らせた」と言わない", () => {
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  const 取れた = buildView(c, new Map(), strings(), { ...CONTEXT, checksRun: 36 });
  assert.ok(取れた.footnotes.some((f) => f.includes("36 検査")), `脚注: ${取れた.footnotes}`);

  const 取れない = buildView(c, new Map(), strings(), { ...CONTEXT, checksRun: null });
  assert.ok(
    !取れない.footnotes.some((f) => f.includes("0 検査")),
    `「0 検査」と言っている: ${取れない.footnotes}`,
  );
  assert.ok(
    取れない.footnotes.some((f) => f.includes("検査は取れていない")),
    `取れていないことを言っていない: ${取れない.footnotes}`,
  );
});

test("006-30. 範囲が取れていない回の案内が、「起点が無い」ではない", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const 取れた = buildView(
    buildConsequence(graph, null, { ...NO_CONTEXT, ranges: [] }),
    new Map(),
    strings(),
    CONTEXT,
  );
  assert.ok(!取れた.emptyReason.includes("範囲が取れていない"), `案内: ${取れた.emptyReason}`);

  const 取れない = buildView(
    buildConsequence(graph, null, { ...NO_CONTEXT, ranges: null }),
    new Map(),
    strings(),
    CONTEXT,
  );
  assert.ok(
    取れない.emptyReason.includes("範囲が取れていない"),
    `既に開いている利用者へ「印を持つファイルを開け」と案内している: ${取れない.emptyReason}`,
  );
});

test("006-28d. 取れていない事実に、記号を当てない", () => {
  // 記号は「その事実が在る」ことの印である。取れていないものに当てると、
  // 上流の失敗が「壊れている」「足りない」に化ける（ADR-023 決定 1）。
  const 基本 = { rangeCount: 1, kind: "depends-directly" as const };

  assert.equal(symbolFor({ ...基本, findings: [finding("P", "error", "壊")], isReverseOrphan: false }), "broken");
  // 所見が取れていない回は、その文書に付いた所見も空で届く（`findingsFor`）。
  // 空なら重い所見も無いので `×` は当たらない。**道を二つ作らない。**
  assert.equal(symbolFor({ ...基本, findings: [], isReverseOrphan: false }), "fix");

  assert.equal(symbolFor({ ...基本, findings: [], isReverseOrphan: true }), "missing");
  assert.equal(
    symbolFor({ ...基本, findings: [], isReverseOrphan: null }),
    "fix",
    "逆孤児が取れていないのに + を当てている",
  );
});

test("006-33. 前提の数を出したら、直の一歩の行き先も出す", () => {
  // 「起点 ← A ← B」。A は直の前提、B は推移の前提。
  const graph = graphOf(["O", "A", "B"], ["A>O", "B>A"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);

  assert.equal(c.premiseCount, 2, "推移の件数は A と B の 2 件");
  assert.deepEqual(c.premisesDirect, ["A"], "直の一歩だけを名で出す（推移の全部を並べない）");

  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.deepEqual([...view.premisesAt], ["A"], "画面へ行き先が届いていない");
  assert.ok(
    view.footnotes.some((f) => f.includes("2")),
    `推移の件数を数で言っていない: ${view.footnotes}`,
  );
});

test("006-33b. 前提が無ければ、その脚注も行き先も出さない", () => {
  // 起点に流れ込む辺が無い。説明だけが浮かないこと（SPEC-006 制約）。
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  assert.equal(c.premiseCount, 0);
  assert.deepEqual(c.premisesDirect, []);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.deepEqual([...view.premisesAt], []);
});

test("006-31. status を言っていない節点を「非現行」と数えない", () => {
  // 上流は、型も status も書かれていない文書に `""` を返す（既定を引けないため）。
  // `""` を「現行でない」と数えると、要約は「非現行 1」と言うのに
  // 行には空文字が渡って何も出ず、数と行が突き合わせられない（ADR-021 決定 2）。
  const graph = graphOf(["O", "書きかけ"], ["O>書きかけ"]);
  (graph.nodes as { id: string; status: string }[]).forEach((n) => {
    if (n.id === "書きかけ") n.status = "";
  });
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, registry: REGISTRY });
  const row = c.waves.flatMap((w) => w.rows)[0];
  assert.equal(row?.notCurrent, null, "上流が言っていない status を判じている");
  assert.equal(c.summary.facts.notCurrent, 0, "画面に出ない行を非現行に数えている");

  const view = buildView(c, new Map(), strings(), CONTEXT);
  const 語る行 = view.waves.flatMap((w) => w.rows).filter((r) => r.status !== "").length;
  assert.equal(語る行, c.summary.facts.notCurrent, "数と行が食い違う");
});

test("006-32. 起点が循環に落ちても、畳んだ件数の総和が節点の数に届く", () => {
  // `O ↔ A` の輪に起点が入る。`X` はどちらにも届かない。
  const graph = graphOf(["O", "A", "X"], ["O>A", "A>O"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const rows = c.waves.flatMap((w) => w.rows).length;
  const inCycle = c.cycles.reduce((n, x) => n + x.members.length, 0);
  assert.equal(
    rows + inCycle + c.premiseCount + c.unreached,
    graph.nodes.length,
    "起点を二重に引いている（どちらにも届かない文書が消える）",
  );
  assert.equal(c.unreached, 1, "X が「届かない」に数えられていない");
});

test("006-27. 迂回路だけを名乗って、存在する直の辺を無いことにしない", () => {
  // P は O を直に depends_on に持ち、かつ M を経由してもいる（最長距離で第 2 波）。
  const graph = graphOf(["O", "M", "P"], ["O>M", "O>P", "M>P"]);
  const c = buildConsequence(graph, "O", NO_CONTEXT);
  const row = c.waves.find((w) => w.distance === 2)?.rows[0];
  assert.equal(row?.id, "P");
  assert.equal(row?.reason.kind, "depends-through");
  assert.equal(row?.alsoDirect, true, "直の辺が在ることを持っていない");
  const view = buildView(c, new Map(), strings(), CONTEXT);
  const shown = view.waves.find((w) => w.heading.includes("2"))?.rows[0]?.reason ?? "";
  assert.ok(shown.includes("直にも持つ"), `直の辺を名乗っていない: ${shown}`);
});

test("006-5c. 空白だけの題名は id へ落とす", () => {
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  const meta: DocMetaIndex = new Map([["P", { title: "   ", updated: "", supersededBy: "" }]]);
  assert.equal(buildView(c, meta, strings(), CONTEXT).waves[0]?.rows[0]?.title, "P");
});

test("006-9c. 所見の六項がそのまま届く（severity や path を捨てない）", () => {
  const graph = graphOf(["O", "P"], ["O>P"]);
  const f = { ...finding("P", "error", "壊れている"), check: "dead_link", path: "a/b.md", refs: ["X"] };
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, findings: [f] });
  const got = buildView(c, new Map(), strings(), CONTEXT).waves[0]?.rows[0]?.findings[0];
  assert.equal(got?.severity, "error");
  assert.equal(got?.check, "dead_link");
  assert.equal(got?.path, "a/b.md");
  assert.deepEqual([...(got?.refs ?? [])], ["X"]);
});


test("006-22. 出ていない所見を、行き先の在るものと無いものに分ける", () => {
  const graph = graphOf(["O", "P", "よそ"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [
      finding("よそ", "error", "起点に繋がらない文書の所見"),
      // 上流の一部の検査は doc_id を空で挙げる。どの起点でも明細に出ない。
      { ...finding("", "advisory", "どの文書にも紐づかない"), refs: [] },
    ],
  });
  assert.deepEqual([...c.findingsElsewhereAt], ["よそ"], "行き先を挙げていない");
  assert.equal(c.findingsUnattached, 1, "属さないものを数えていない");
});

test("006-22b. 行き先が押せる形で画面へ届く", () => {
  const graph = graphOf(["O", "P", "よそ"], ["O>P"]);
  const c = buildConsequence(graph, "O", {
    ...NO_CONTEXT,
    findings: [finding("よそ", "error", "所見")],
  });
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.deepEqual([...view.findingsAt], ["よそ"], "行き先が画面へ届いていない");
  assert.ok(view.footnotes.some((f) => f.includes("行ける 1")), `脚注: ${view.footnotes}`);
});

test("006-22c. refs だけで紐づく所見も「行き先が在る」側に入れる", () => {
  const graph = graphOf(["O", "P", "よそ"], ["O>P"]);
  const f = { ...finding("", "warn", "refs で指す"), refs: ["よそ"] };
  const c = buildConsequence(graph, "O", { ...NO_CONTEXT, findings: [f] });
  assert.deepEqual([...c.findingsElsewhereAt], ["よそ"]);
  assert.equal(c.findingsUnattached, 0, "refs を見ていない");
});

test("006-22d. 属さない所見が無ければ、その脚注を出さない", () => {
  const c = buildConsequence(graphOf(["O", "P"], ["O>P"]), "O", NO_CONTEXT);
  const view = buildView(c, new Map(), strings(), CONTEXT);
  assert.ok(!view.footnotes.some((f) => f.includes("属さない")), "説明だけが浮く");
  assert.deepEqual([...view.findingsAt], []);
});

// --- 道具 ------------------------------------------------------------------

const CONTEXT = {
  openFile: "src/a.ts",
  auditAt: "2026-07-29 09:14",
  titlesMissing: false,
  checksRun: 34,
  glossary: new Map<string, string>(),
};

/** 差し込みの位置だけを見る、短い見本の文言。訳の中身は l10n.test.ts が見る。 */
function strings(): Parameters<typeof buildView>[2] {
  return {
    summaryCounts: "{0} 文書 / コード {1}",
    summarySymbols: "× {0} / + {1} / ? {2} / ! {3} / ~ {4}",
    summaryFacts: "壊れている {0} / 足りない {1} / 範囲無し {2}",
    summaryDocuments: "{0} 文書",
    summaryCodeRanges: "コード {0}",
    summaryFactBroken: "壊れている {0}",
    summaryFactMissing: "足りない {0}",
    summaryFactNoRange: "範囲無し {0}",
    footAuditNoChecks: "監査 {0}（検査は取れていない）",
    noOriginRangesUnknown: "範囲が取れていない（{0}）",
    summaryFactNotCurrent: "非現行 {0}",
    footHeaviest: "行には最も重い記号だけが出る",

    summaryCycles: "循環 {0} 本（{1} 文書）",
    waveHeading: "第 {0} 波",
    waveCount: "{0} 文書",
    waveFirstNote: "先に直すものは無い",
    waveLaterNote: "第 {0} 波を先に",
    reasonDirect: "depends_on に {0}",
    reasonThrough: "{0} を経由して {1}",
    reasonImpacted: "{0} が影響すると宣言",
    reasonAlsoDirect: "{0} を直にも持つ。",
    rangeLabel: "{0}:{1}-{2}",
    noOrigin: "起点が無い。開いているのは {0}",
    noOriginNoFile: "起点が無い",
    footPremises: "前提 {0}",
    footHidden: "隠した {0}",
    footElsewhere: "行ける {0} 文書",
    footUnattached: "属さない {0} 件",
    originFindingsNote: "起点自身が壊れている:",
    footAudit: "監査 {0}／{1} 検査",
    footAuditNever: "監査まだ",
    footNoTitles: "題名が無い",
    footBehind: "右端の数は片づけると確定に向かう件数",
    rowSucceeds: "後継 {0}",
    cycleNote: "循環 {0}",
    legendBroken: "×",
    legendMissing: "+",
    legendNowhere: "?",
    legendFix: "!",
    legendReview: "~",
  };
}

// --- 上流の判定を捨てない ---------------------------------------------------

test("橋が所見を検査名で絞らない（木の健康状態に依らずに検める）", async () => {
  // 旧実装は check が "trace" で始まるものだけを通していた。34 のうち 11 である。
  // 判断の層を橋の上で捨てていたので、画面は事実しか言えず、判断は読み手に残った。
  //
  // **この試験は統治木を一切読まない。** 前は実樹の監査を走らせて
  // 「追跡以外の所見が一件来たか」を見ていたが、それは二つの意味で誤りだった。
  //   ・34 という数を検めていない（33 を絞っても通る）
  //   ・木の健康状態に依っている（木が緑になると、橋が正しいまま赤くなる）
  // 偽のプラグインに混在の報告を返させ、橋の性質だけを見る（ADR-014）。
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-audit-"));
  try {
    const scripts = join(dir, "plugin", "scripts");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(join(dir, "doctrine_docs"), { recursive: true });

    // 追跡と追跡以外を混ぜた報告。上流が返す形に揃える。
    const report = {
      schema: "docs-audit/1",
      root: join(dir, "doctrine_docs"),
      checks_run: ["dead_link", "dep_cycle", "trace_stale", "guard_liveness_gap", "orphan"],
      findings: [
        { check: "dead_link", severity: "error", doc_id: "A", path: "", message: "死んだ参照", refs: [] },
        { check: "trace_stale", severity: "warn", doc_id: "B", path: "", message: "指紋が違う", refs: [] },
        { check: "guard_liveness_gap", severity: "advisory", doc_id: "", path: "", message: "配線", refs: [] },
        { check: "dep_cycle", severity: "error", doc_id: "C", path: "", message: "循環", refs: [] },
      ],
    };
    writeFileSync(
      join(scripts, "docs-audit.py"),
      `import json,sys\njson.dump(${JSON.stringify(report)}, sys.stdout)`,
      "utf8",
    );

    const { fetchFindings } = await import("../doctrine/audit.js");
    const outcome = await fetchFindings(dir, join(dir, "doctrine_docs"), join(dir, "plugin"), {
      pythonPath: "python3",
      timeoutMs: 20000,
      cwd: dir,
    });
    assert.ok(outcome.ok, `取れなかった: ${outcome.ok ? "" : outcome.detail}`);

    assert.deepEqual(
      outcome.value.findings.map((f) => f.check).sort(),
      ["dead_link", "dep_cycle", "guard_liveness_gap", "trace_stale"],
      "橋が検査名で絞っている（追跡以外が落ちている）",
    );
    assert.deepEqual(
      [...outcome.value.checksRun].sort(),
      ["dead_link", "dep_cycle", "guard_liveness_gap", "orphan", "trace_stale"],
      "走らせた検査の一覧が届いていない",
    );
    // 所見が出ていない検査（orphan）も一覧には在る。ここが「数を数える」根拠である。
    assert.ok(
      outcome.value.checksRun.length > outcome.value.findings.length,
      "所見の数と検査の数を混同している",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("走らせた検査の数が、上流の検査の一覧と一致する（数を実装が持たない）", async (t) => {
  // 上流が検査を増やしたら、こちらが何もしなくても数が追随することを見る。
  // 期待値を実行時に上流から読む。定数で 34 と書いたらこの試験の意味が消える。
  const { locatePluginRoot, locateDocsRoot } = await import("../doctrine/locate.js");
  const { fetchFindings } = await import("../doctrine/audit.js");
  const project = resolve(__dirname, "..", "..");
  const pluginRoot = locatePluginRoot(project);
  const docsRoot = locateDocsRoot(project);
  if (!pluginRoot || !docsRoot) return t.skip("doctrine プラグインか統治木が無い");

  // 上流の検査の一覧を、上流の原文から読む。
  const source = readFileSync(join(pluginRoot, "scripts", "docs-audit.py"), "utf8");
  const block = source.slice(source.indexOf("AUDIT_CHECKS = ("));
  const literal = block.slice(0, block.indexOf(")"));
  const upstream = [...literal.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(upstream.length > 20, `上流の検査の一覧を読めない（${upstream.length} 件）`);

  const outcome = await fetchFindings(project, docsRoot, pluginRoot, {
    pythonPath: "python3",
    timeoutMs: 60000,
    cwd: project,
  });
  assert.ok(outcome.ok, `監査に失敗した: ${outcome.ok ? "" : outcome.detail}`);
  assert.deepEqual(
    [...outcome.value.checksRun].sort(),
    [...upstream].sort(),
    "上流が走らせた検査と、橋が伝えた一覧が食い違う",
  );

  // 実装が数を定数で持っていないことを字面で見る（ADR-014 の却下案 1）。
  for (const rel of ["src/doctrine/audit.ts", "src/model/view.ts", "src/l10n.ts"]) {
    const text = readFileSync(join(project, rel), "utf8");
    const hits = [...text.matchAll(/\b34\b/g)].map((m) => m[0]);
    assert.deepEqual(hits, [], `${rel} が検査の数を字面で持っている`);
  }
});
