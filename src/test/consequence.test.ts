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

const CONTEXT = {
  openFile: "src/a.ts",
  auditAt: "2026-07-29 09:14",
  titlesMissing: false,
  checksRun: 34,
};

/** 差し込みの位置だけを見る、短い見本の文言。訳の中身は l10n.test.ts が見る。 */
function strings(): Parameters<typeof buildView>[2] {
  return {
    summaryCounts: "{0} 文書 / コード {1} / 場所無し {2}",
    summaryJudgements: "壊れている {0} / 足りない {1} / 循環 {2}",
    waveHeading: "第 {0} 波",
    waveCount: "{0} 文書",
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
