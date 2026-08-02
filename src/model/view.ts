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
import type { DocMetaIndex } from "../doctrine/titles.js";
import type { GraphNode } from "../doctrine/model.js";
import type {
  ConsequenceView,
  CycleView,
  OriginView,
  RangeLink,
  RowView,
  WaveView,
} from "../shared/protocol.js";
import type { Consequence, Reason, Row, Symbol } from "./consequence.js";

/** 訳し終えた文言の型。`{0}` は差し込み位置。 */
export interface ViewStrings {
  /** `{0} 文書を直す ・ {1} か所 ・ 直す場所が無い {2} 件` */
  readonly summaryCounts: string;
  /** `壊れている {0} ・ 足りない {1} ・ 循環 {2}` */
  readonly summaryJudgements: string;
  /** `第 {0} 波` */
  readonly waveHeading: string;
  /** 波の見出しの右端に置く件数。`{0} 文書` */
  readonly waveCount: string;
  /** 第 1 波に添える一文 */
  readonly waveFirstNote: string;
  /** 第 2 波以降に添える一文。`{0}` は一つ前の番号 */
  readonly waveLaterNote: string;
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
  /** `起点に繋がらない {0} 文書は出していない` */
  readonly footHidden: string;
  /** `起点の外に所見 {0} 件` */
  readonly footElsewhere: string;
  /** `上流 docs-audit（{1} 検査）を {0} に実行` */
  readonly footAudit: string;
  /** 監査をまだ取っていないとき */
  readonly footAuditNever: string;
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
  return meta.get(id)?.title || id;
}

/** 起点の副文。`SPEC-001 · path · status · 更新 2026-07-28` の形。 */
function originDetail(node: GraphNode, meta: DocMetaIndex): string {
  const updated = meta.get(node.id)?.updated ?? "";
  return [node.id, node.path, node.status, updated].filter(Boolean).join(" · ");
}

function reasonText(reason: Reason, originId: string, strings: ViewStrings): string {
  // 影響は「直前の相手が宣言した」と書く。三段先の行に「起点が宣言している」と
  // 書くと、それは事実ではない。起点は宣言していない。
  if (reason.kind === "impacted") return fill(strings.reasonImpacted, reason.by);
  if (reason.kind === "depends-directly") return fill(strings.reasonDirect, originId);
  return fill(strings.reasonThrough, reason.through, originId);
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
    // 上流が返した値をそのまま運ぶ。語彙をこちらが持たない（REQ-003）。
    status: row.status,
    succeeds: successor ? fill(strings.rowSucceeds, successor) : "",
    symbol: row.symbol as Symbol,
    title: titleOf(row.id, meta),
    reason: reasonText(row.reason, originId, strings),
    behind: row.behind,
    ranges: rangeLinks(row, strings),
    // 上流の文を一字も変えずに運ぶ（SPEC-006 制約）。
    findings: row.findings.map((f) => f.message),
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
    readonly checksRun: number;
  },
): ConsequenceView {
  const origin: OriginView | null = consequence.origin
    ? {
        title: titleOf(consequence.origin.id, meta),
        detail: originDetail(consequence.origin, meta),
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
    findings: cycle.findings.map((f) => f.message),
  }));

  const summary = [
    fill(
      strings.summaryCounts,
      String(consequence.summary.documents),
      String(consequence.summary.codeRanges),
      String(consequence.summary.nowhere),
    ),
    fill(
      strings.summaryJudgements,
      String(consequence.summary.broken),
      String(consequence.summary.missing),
      String(consequence.summary.cycles),
    ),
  ].join("\n");

  // 畳んだら必ず件数を書く。隠すことは抽象ではない（SPEC-006 制約）。
  const footnotes: string[] = [];
  if (consequence.unreached > 0) {
    footnotes.push(fill(strings.footHidden, String(consequence.unreached)));
  }
  if (consequence.findingsElsewhere > 0) {
    footnotes.push(fill(strings.footElsewhere, String(consequence.findingsElsewhere)));
  }
  if (cycles.length > 0) {
    footnotes.push(fill(strings.cycleNote, String(cycles.length)));
  }
  // 右端の数は説明の無い記号である。説明しないなら出してはいけない。
  if (consequence.waves.some((w) => w.rows.some((r) => r.behind > 0))) {
    footnotes.push(strings.footBehind);
  }
  if (context.titlesMissing) footnotes.push(strings.footNoTitles);
  footnotes.push(
    context.auditAt
      ? fill(strings.footAudit, context.auditAt, String(context.checksRun))
      : strings.footAuditNever,
  );

  return {
    origin,
    emptyReason: context.openFile
      ? fill(strings.noOrigin, context.openFile)
      : strings.noOriginNoFile,
    summary,
    waves,
    cycles,
    footnotes,
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
