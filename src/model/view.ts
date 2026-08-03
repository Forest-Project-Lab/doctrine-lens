// doctrine:begin SPEC-006
// 明細を、そのまま描ける形に組み立てる。
//
// ここは編集器の機能を使わない純粋な関数だけで書く。訳し終えた文字列は
// 引数で受け取り、翻訳の仕組みをこちらが持たない（ADR-007）。
//
// なぜ webview ではなくここで組むか: 旧設計は場面の組み立てを webview 側に置いていた。
// ダイヤルを回すたびに本体と往復するのを避けるためだった。ダイヤルが無くなったので、
// その理由も消えた。組み立てをここへ寄せると、webview は判断を一つも持たなくなり、
// 門（単体試験と突然変異）が明細の中身まで届く。
import { termsIn, type Glossary } from "../doctrine/glossary.js";
import type { DocMetaIndex } from "../doctrine/model.js";
import type { GraphNode } from "../doctrine/model.js";
import type { AuditFinding } from "../doctrine/audit.js";
import type {
  ConsequenceView,
  FindingView,
  CycleView,
  OriginView,
  RangeLink,
  RowView,
  WaveView,
} from "../shared/protocol.js";
import type { Consequence, Reason, Row, Symbol } from "./consequence.js";

/** 訳し終えた文言の型。`{0}` は差し込み位置。 */
export interface ViewStrings {
  /** `{0} 文書を直す ・ コード {1} か所` */
  readonly summaryCounts: string;
  /** `直すことになる {0} 文書` */
  readonly summaryDocuments: string;
  /** `コード {0} か所`。範囲が取れていなければ出ない */
  readonly summaryCodeRanges: string;
  /** 記号ごとの内訳。五つの和が文書数に一致する。`× {0} ・ + {1} ・ ? {2} ・ ! {3} ・ ~ {4}` */
  readonly summarySymbols: string;
  /** 事実ごとの件数。記号に負けたものも数える。`壊れている {0} ・ 足りない {1} ・ 範囲が無い {2}` */
  readonly summaryFacts: string;
  /** `既に壊れている {0}`。所見が取れていなければ出ない */
  readonly summaryFactBroken: string;
  /** `足りない {0}`。逆孤児が取れていなければ出ない */
  readonly summaryFactMissing: string;
  /** `範囲が無い {0}`。範囲が取れていなければ出ない */
  readonly summaryFactNoRange: string;
  /** 現行でない行の本数。判じられた回だけ出る。`非現行 {0}` */
  readonly summaryFactNotCurrent: string;
  /** 記号ごとの数と事実ごとの数が食い違う理由。脚注に置く */
  readonly footHeaviest: string;
  /** `循環 {0} 本（{1} 文書）` */
  readonly summaryCycles: string;
  /** `第 {0} 波` */
  readonly waveHeading: string;
  /** 波の見出しの右端に置く件数。`{0} 文書` */
  readonly waveCount: string;
  /** 第 1 波に添える一文 */
  readonly waveFirstNote: string;
  /** 第 2 波以降に添える一文。`{0}` は一つ前の番号 */
  readonly waveLaterNote: string;
  /** 直の辺も在るときに理由へ添える一文 */
  readonly reasonAlsoDirect: string;
  /** `depends_on に {0} を持つ。前提が変わる。` */
  readonly reasonDirect: string;
  /** `{0} を経由して {1} に依存している。` */
  readonly reasonThrough: string;
  /** `{0} が影響すると宣言している。` */
  readonly reasonImpacted: string;
  /** `{0} 行` などの範囲の札。`{0}` はパス、`{1}` は始まり、`{2}` は終わり */
  readonly rangeLabel: string;
  /** 起点が無いときの説明。`{0}` はいま開いているものの名前 */
  readonly noOrigin: string;
  /** 起点が全く分からないとき（ファイルを開いていない） */
  readonly noOriginNoFile: string;
  /** 範囲が取れていないので、カーソルからは起点を引けないときの一文 */
  readonly noOriginRangesUnknown: string;
  /** `起点が前提にしている {0} 文書は出していない（この画面は逆向きに辿らない）` */
  readonly footPremises: string;
  /** `帰結にも前提にも繋がらない {0} 文書は出していない` */
  readonly footHidden: string;
  /** `起点に繋がらない {0} 文書に所見が付いている` */
  readonly footElsewhere: string;
  /** `起点が前提にしている {0} 文書に所見が付いている` */
  readonly footPremiseFindings: string;
  /** `この画面の問いに属さない所見が {0} 件（どの文書にも紐づかない）` */
  readonly footUnattached: string;
  /** 起点自身に所見が付いているときの前置き */
  readonly originFindingsNote: string;
  /** `上流 docs-audit（{1} 検査）を {0} に実行` */
  readonly footAudit: string;
  /** 監査をまだ取っていないとき */
  readonly footAuditNever: string;
  /** 時刻は在るが、走らせた検査の一覧が取れていない回 */
  readonly footAuditNoChecks: string;
  /** `題名を取れなかった文書がある` */
  readonly footNoTitles: string;
  /** 行の右端の数が何かを言う一文 */
  readonly footBehind: string;
  /** `後継 {0}` */
  readonly rowSucceeds: string;
  /** 波が決まらない旨。`{0}` は件数 */
  readonly cycleNote: string;
  /** 記号の語彙。順に 壊れている・足りない・場所が要る・直す・見直す */
  readonly legendBroken: string;
  readonly legendMissing: string;
  readonly legendNowhere: string;
  readonly legendFix: string;
  readonly legendReview: string;
}

/**
 * 判定を取った時刻。秒を出さない（DESIGN.md）。
 *
 * ここに置いてあるのは、写しの道具（tools/preview-webview.mjs）が同じ関数を
 * 通すためである。画面の側に置くと、写しは自前で整えることになり、
 * 確かめた見た目と配る見た目が食い違う。実際に一度そうなった。
 */
export function formatTime(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

function fill(template: string, ...values: readonly string[]): string {
  return values.reduce((text, value, index) => text.split(`{${index}}`).join(value), template);
}

/** 題名。取れていなければ id へ落とす。 */
function titleOf(id: string, meta: DocMetaIndex): string {
  // 空白だけの題名も id へ落とす。真値なのでそのまま通し、
  // 画面で一番大きい文字が空白になっていた（ADR-017）。
  return meta.get(id)?.title?.trim() || id;
}

/** 起点の副文。`SPEC-001 · path · status · 更新 2026-07-28` の形。 */
function originDetail(node: GraphNode, meta: DocMetaIndex): string {
  const updated = meta.get(node.id)?.updated ?? "";
  return [node.id, node.path, node.status, updated].filter(Boolean).join(" · ");
}

function reasonText(
  reason: Reason,
  originId: string,
  alsoDirect: boolean,
  strings: ViewStrings,
): string {
  const base = reasonBase(reason, originId, strings);
  // 迂回路だけを名乗って、存在する直の辺を無いことにしない（ADR-017）。
  //
  // **影響の側でも同じである**（CHANGE-028）。初版は `depends-through` だけを見ていたので、
  // 「起点が直に影響すると宣言しているのに、別の経路が長いので後の波へ回った」行が
  // 迂回路だけを名乗った。実測でこの木に 30 行・25 起点あった。
  // 基文が既に起点を名で出している行（直の依存・起点自身が宣言した影響）は除く。
  const detour =
    reason.kind === "depends-through" || (reason.kind === "impacted" && reason.by !== originId);
  return detour && alsoDirect
    ? `${base} ${fill(strings.reasonAlsoDirect, originId)}`
    : base;
}

function reasonBase(reason: Reason, originId: string, strings: ViewStrings): string {
  // 影響は「直前の相手が宣言した」と書く。三段先の行に「起点が宣言している」と
  // 書くと、それは事実ではない。起点は宣言していない。
  if (reason.kind === "impacted") return fill(strings.reasonImpacted, reason.by);
  if (reason.kind === "depends-directly") return fill(strings.reasonDirect, originId);
  return fill(strings.reasonThrough, reason.through, originId);
}

/** 上流の所見を、そのまま描ける形へ。**判断を足さない。** */
function toFindingView(f: AuditFinding): FindingView {
  return {
    check: typeof f.check === "string" ? f.check : "",
    severity: typeof f.severity === "string" ? f.severity : "",
    // **六項のうち二つが落ちていた**（CHANGE-028）。`doc_id` はここで写されず、
    // `refs` は画面が描いていなかった。一件の所見は `doc_id` でも `refs` でも
    // 行に並ぶので、`doc_id` が無いと**どの文書に付いた所見かが読めない**。
    doc_id: typeof f.doc_id === "string" ? f.doc_id : "",
    message: f.message,
    path: typeof f.path === "string" ? f.path : "",
    refs: Array.isArray(f.refs) ? f.refs : [],
  };
}

function rangeLinks(row: Row, strings: ViewStrings): RangeLink[] {
  return row.ranges.map((range) => ({
    path: range.path,
    beginLine: range.begin_line,
    endLine: range.end_line,
    label: fill(strings.rangeLabel, range.path, String(range.begin_line), String(range.end_line)),
  }));
}

function rowView(row: Row, originId: string, meta: DocMetaIndex, strings: ViewStrings): RowView {
  const successor = meta.get(row.id)?.supersededBy ?? "";
  return {
    id: row.id,
    // **既定は語らない**（ADR-021）。上流が現行と呼ぶ status は出さない。
    // 判じられなかった回（`null`）は出す——隠す根拠が無いのに隠さない（ADR-017）。
    // 値そのものは上流のものを一字も変えずに運ぶ（REQ-003）。
    status: row.notCurrent === false ? "" : row.status,
    succeeds: successor ? fill(strings.rowSucceeds, successor) : "",
    symbol: row.symbol as Symbol,
    title: titleOf(row.id, meta),
    reason: reasonText(row.reason, originId, row.alsoDirect, strings),
    behind: row.behind,
    ranges: rangeLinks(row, strings),
    // 上流の六項を一字も変えずに運ぶ（SPEC-006 制約・ADR-017）。
    findings: row.findings.map(toFindingView),
  };
}

/**
 * 明細を、そのまま描ける形へ組み立てる。
 *
 * `openFile` は「いま開いているものの名前」。起点が無いときの説明に使う。
 * `auditAt` は判定を取った時刻の文字列。取っていなければ空。
 */
export function buildView(
  consequence: Consequence,
  meta: DocMetaIndex,
  strings: ViewStrings,
  context: {
    readonly openFile: string;
    readonly auditAt: string;
    readonly titlesMissing: boolean;
    /** 上流が実際に走らせた検査の数。数えた数であって、代弁の語ではない（ADR-014）。 */
    /** 上流が走らせた検査の数。**取れていなければ `null`。** 0 と断定しない。 */
    readonly checksRun: number | null;
    /** 木の用語辞書。取れなければ空。 */
    readonly glossary: Glossary;
  },
): ConsequenceView {
  const origin: OriginView | null = consequence.origin
    ? {
        title: titleOf(consequence.origin.id, meta),
        detail: originDetail(consequence.origin, meta),
        // 起点は行にならない。ここに出さないと画面のどこにも現れない。
        symbol: consequence.originSymbol,
        findings: consequence.originFindings.map(toFindingView),
        findingsNote: consequence.originFindings.length > 0 ? strings.originFindingsNote : "",
      }
    : null;

  const originId = consequence.origin?.id ?? "";

  const waves: WaveView[] = consequence.waves.map((wave) => ({
    heading: fill(strings.waveHeading, String(wave.distance)),
    note:
      wave.distance === 1
        ? strings.waveFirstNote
        : fill(strings.waveLaterNote, String(wave.distance - 1)),
    count: fill(strings.waveCount, String(wave.rows.length)),
    rows: wave.rows.map((row) => rowView(row, originId, meta, strings)),
  }));

  const cycles: CycleView[] = consequence.cycles.map((cycle) => ({
    path: cycle.path.join(" → "),
    findings: cycle.findings.map(toFindingView),
  }));

  const s = consequence.summary;
  // **取れていない数は、その場に出さない**（ADR-023）。0 と書くと「無い」に化ける。
  // 取れなかったことは、部分失敗の通知が別に言っている（SPEC-005）。
  const counts = [
    fill(strings.summaryDocuments, String(s.documents)),
    ...(s.codeRanges === null ? [] : [fill(strings.summaryCodeRanges, String(s.codeRanges))]),
  ].join(" · ");
  const summary = [
    counts,
    // 記号ごと。五つの和が documents に一致する（読み手が足し算できる）。
    fill(
      strings.summarySymbols,
      String(s.bySymbol.broken),
      String(s.bySymbol.missing),
      String(s.bySymbol.nowhere),
      String(s.bySymbol.fix),
      String(s.bySymbol.review),
    ),
    // 事実ごと。記号に負けたものも数える。互いに排他ではない。
    // 非現行は記号を争わない。行から消した語を、この数が支える（ADR-021 決定 2）。
    // 判じられなかった回は数を出さない。0 と書くと「一つも無い」ことになる。
    [
      ...(s.facts.broken === null ? [] : [fill(strings.summaryFactBroken, String(s.facts.broken))]),
      ...(s.facts.missing === null
        ? []
        : [fill(strings.summaryFactMissing, String(s.facts.missing))]),
      ...(s.facts.noRange === null
        ? []
        : [fill(strings.summaryFactNoRange, String(s.facts.noRange))]),
      ...(s.facts.notCurrent === null
        ? []
        : [fill(strings.summaryFactNotCurrent, String(s.facts.notCurrent))]),
    ].join(" · "),
    // 循環は文書の内数ではないので、本数と文書数を分けて言う。
    fill(strings.summaryCycles, String(s.cycles), String(s.inCycle)),
  ].join("\n");

  // 畳んだら必ず件数を書く。隠すことは抽象ではない（SPEC-006 制約）。
  const footnotes: string[] = [];
  // 「辿る向きが違うので出さない」と「繋がらないので出さない」は別の事実である。
  // 一語に畳むと、前者が「影響なし」と読まれる（ADR-017）。
  if (consequence.premiseCount > 0) {
    // 推移の件数は数で言い、**直の一歩は名で言う**（ADR-019・CHANGE-016）。
    // 全部を並べない——実測で推移は最大 43 件、直は 92% の起点で 8 件以下である。
    footnotes.push(
      fill(
        strings.footPremises,
        String(consequence.premiseCount),
        String(consequence.premisesDirect.length),
      ),
    );
  }
  if (consequence.unreached > 0) {
    footnotes.push(fill(strings.footHidden, String(consequence.unreached)));
  }
  // 行き先が在るものは、行き先を出す（ADR-019）。
  if (consequence.findingsElsewhereAt.length > 0) {
    footnotes.push(
      fill(strings.footElsewhere, String(consequence.findingsElsewhereAt.length)),
    );
  }
  // 前提に付いた所見。**繋がらないのとは別である**（CHANGE-028）。
  if (consequence.findingsOnPremisesAt.length > 0) {
    footnotes.push(
      fill(strings.footPremiseFindings, String(consequence.findingsOnPremisesAt.length)),
    );
  }
  // 行き先が無いものは、無いと言う。「出していない」とだけ書くと、
  // 読み手は「探せばどこかで出る」と読む。出ない。
  if (consequence.findingsUnattached > 0) {
    footnotes.push(fill(strings.footUnattached, String(consequence.findingsUnattached)));
  }
  if (cycles.length > 0) {
    footnotes.push(fill(strings.cycleNote, String(cycles.length)));
  }
  // 右端の数は説明の無い記号である。説明しないなら出してはいけない。
  if (consequence.waves.some((w) => w.rows.some((r) => r.behind > 0))) {
    footnotes.push(strings.footBehind);
  }
  // 記号ごとの数と事実ごとの数が食い違う理由を言う。要約の行に括弧で足すと、
  // 280px で要約が六行になり、数そのものが読みにくくなる（DESIGN.md 9-4）。
  // 説明は脚注へ置く。「右端の数が何か」を脚注で言うのと同じ扱いである。
  //
  // **実際に食い違っている回だけ出す。** 一致している画面に置くと、説明だけが浮く
  // （SPEC-006 制約。右端の数が一つも無いときにその脚注を出さないのと同じ）。
  // 取れていない事実は比べない。`null !== 0` を食い違いと読むと、
  // 「取れなかったから食い違っている」という誤った理由が出る。
  if (
    (s.facts.broken !== null && s.facts.broken !== s.bySymbol.broken) ||
    (s.facts.missing !== null && s.facts.missing !== s.bySymbol.missing) ||
    (s.facts.noRange !== null && s.facts.noRange !== s.bySymbol.nowhere)
  ) {
    footnotes.push(strings.footHeaviest);
  }
  if (context.titlesMissing) footnotes.push(strings.footNoTitles);
  // 検査の数が取れていない回に「0 検査を走らせた」と言わない（ADR-023）。
  footnotes.push(
    context.auditAt
      ? context.checksRun === null
        ? fill(strings.footAuditNoChecks, context.auditAt)
        : fill(strings.footAudit, context.auditAt, String(context.checksRun))
      : strings.footAuditNever,
  );

  return {
    origin,
    // **起点が決まらない理由を、取り違えない。** 範囲が取れていない回に
    // 「印を持つファイルを開け」と案内すると、既に開いている利用者へ嘘をつく
    // （カーソルから起点を引くには範囲が要る。ADR-023）。
    emptyReason: !context.openFile
      ? strings.noOriginNoFile
      : consequence.rangesKnown
        ? fill(strings.noOrigin, context.openFile)
        : fill(strings.noOriginRangesUnknown, context.openFile),
    summary,
    waves,
    cycles,
    footnotes,
    // 押せる行き先。押すとその文書が開き、開けば起点になる（ADR-019）。
    findingsAt: [...consequence.findingsElsewhereAt],
    premisesAt: [...consequence.premisesDirect],
    premiseFindingsAt: [...consequence.findingsOnPremisesAt],
    // 画面に実際に出た文字列と辞書を突き合わせる。
    // **出す語の一覧を実装が持たない**（ADR-018）。
    terms: termsIn(
      [
        origin?.title ?? "",
        origin?.detail ?? "",
        summary,
        ...waves.flatMap((w) => [
          w.heading,
          w.note,
          ...w.rows.flatMap((r) => [r.title, r.reason, r.succeeds, ...r.findings.map((f) => f.message)]),
        ]),
        ...cycles.flatMap((c) => c.findings.map((f) => f.message)),
        ...footnotes,
      ].join("\n"),
      context.glossary,
    ),
    legend: [
      strings.legendBroken,
      strings.legendMissing,
      strings.legendNowhere,
      strings.legendFix,
      strings.legendReview,
    ],
  };
}
// doctrine:end SPEC-006
