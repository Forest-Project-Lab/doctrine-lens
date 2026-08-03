// doctrine:begin IMPL-001
// 本体と webview のあいだで取り決めた形（IMPL-001）。
//
// webview は子プロセスを起こさない。上流の CLI を呼ぶのは本体だけである。
//
// **webview は模型を持たない。** 明細の組み立て（波・記号・順序）は本体側の
// 純粋な関数が行い、題名の解決も文言の訳も本体で済ませる。webview が受け取るのは
// そのまま描ける形であり、判断を一つも持たない。
// 旧設計では場面の組み立てを webview 側に置いていたが、それはダイヤルを回すたびに
// 往復が起きるのを避けるためだった。ダイヤルが無くなったので、その理由も消えた。

/** 各行の左端に置く記号。重い順に排他（SPEC-006）。 */
export type RowSymbol = "broken" | "missing" | "nowhere" | "fix" | "review";

/** コード範囲への案内。押すとその行へ跳ぶ。 */
export interface RangeLink {
  readonly path: string;
  readonly beginLine: number;
  readonly endLine: number;
  readonly label: string;
}

/** 明細の一行。すべて訳し終えた文字列である。 */
/**
 * 上流の所見一件。**六項をそのまま運ぶ。**
 *
 * 以前は `message` だけを運んでいた。`severity` を捨てると error と advisory が
 * 同じ見え方になり、`path` を捨てると所見が指すファイルへ跳べない（ADR-017）。
 */
export interface FindingView {
  readonly check: string;
  readonly severity: string;
  /** 上流がその所見を付けた文書の id。**行の id とは限らない**（refs 経由で並ぶため）。 */
  readonly doc_id: string;
  readonly message: string;
  readonly path: string;
  readonly refs: readonly string[];
}

export interface RowView {
  /** 上流が返した status。空なら出さない。語彙は上流のもの（REQ-003）。 */
  readonly status: string;
  /** 後継の id を告げる一文。無ければ空。 */
  readonly succeeds: string;
  readonly id: string;
  readonly symbol: RowSymbol;
  /** 主文。題名が取れていれば題名、取れていなければ id。 */
  readonly title: string;
  /** なぜこの行が居るかの一文。 */
  readonly reason: string;
  /** 「後ろに N」。0 なら画面に出さない。 */
  readonly behind: number;
  readonly ranges: readonly RangeLink[];
  /** 上流の所見の文。一字も変えずに運ぶ。 */
  readonly findings: readonly FindingView[];
}

/** 一つの波。 */
export interface WaveView {
  /** 「第 1 波」などの見出し。 */
  readonly heading: string;
  /** 見出しに添える一文（「起点に直接ぶら下がる」）。 */
  readonly note: string;
  /**
   * 見出しの右端に置く件数（「2 文書」）。
   *
   * 単位の語を付けるのは、行の右端の数（「後ろに N」）と同じ位置に出るためである。
   * 裸の数を二種類、同じ場所に置くと、どちらがどちらか読めない。
   */
  readonly count: string;
  readonly rows: readonly RowView[];
}

/** 波が決まらない組。 */
export interface CycleView {
  /** `A → B → A` の形にした一行。題名ではなく id で書く（短く読ませるため）。 */
  readonly path: string;
  readonly findings: readonly FindingView[];
}

/** 起点の欄。 */
export interface OriginView {
  /** 起点自身の記号。行と同じ規則で決まる。起点が無ければ null。 */
  readonly symbol: RowView["symbol"] | null;
  /** 起点自身に付いた所見の文。上流の文をそのまま。 */
  readonly findings: readonly FindingView[];
  /** 所見が在るときの前置き。無ければ空。 */
  readonly findingsNote: string;
  readonly title: string;
  /** `SPEC-001 · src/doctrine/cli.ts:1-231 · 現行 · 更新 2026-07-28` の形。 */
  readonly detail: string;
}

/** 画面ひと揃い。これがそのまま描ける。 */
/** 画面に出た語ひとつと、その定義。木の用語辞書から引く（ADR-018）。 */
export interface TermView {
  readonly word: string;
  readonly meaning: string;
}

export interface ConsequenceView {
  /** 起点が無ければ `null`。そのときは `emptyReason` を出す。 */
  readonly origin: OriginView | null;
  /** 起点が無いときに出す文。何を開けばよいかまで書く。 */
  readonly emptyReason: string;
  /** 要約の一行。すでに組み立てた文字列。 */
  readonly summary: string;
  readonly waves: readonly WaveView[];
  readonly cycles: readonly CycleView[];
  /** 脚注の各行。畳んだ件数・上流の名前と時刻。 */
  readonly footnotes: readonly string[];
  /**
   * 画面に出ていない所見が付いている文書の id。**押せる行き先**（ADR-019）。
   *
   * 押すとその文書が開き、開けば起点になる。件数だけを出して
   * 読み手に手が無い状態を「隠していない」と呼ばない。
   */
  readonly findingsAt: readonly string[];
  /**
   * 起点が**直に**前提にしている文書の id。**押せる行き先**（ADR-019）。
   *
   * この画面は逆向きに辿らないが、**辿らないことと行き先を出さないことは別である。**
   * 一歩ぶんの名を出せば、押してそこからまた一歩辿れる。
   * 「そうなるまでの変異」——なぜこの形になったか——はここから入る（CHANGE-016）。
   */
  readonly premisesAt: readonly string[];
  /**
   * 起点の**前提**のうち、画面に出ていない所見が付いている文書の id。
   *
   * 前提は行にならないので所見も画面に出ない。だが「起点に繋がらない」ではない
   * （`findingsAt` と混ぜると、同じ文書を前提とも無関係とも言うことになる。CHANGE-028）。
   * **別の行き先として出す。** 推移の前提も含むので、`premisesAt` に無い id も並ぶ。
   */
  readonly premiseFindingsAt: readonly string[];
  /** 記号の語彙（`×壊れている` など）。 */
  readonly legend: readonly string[];
  /**
   * 画面に出た語の定義。木の用語辞書から引いたもの（ADR-018）。
   *
   * 辞書が取れなければ空。**画面はこれを説明として書かない**——正本は木に在る。
   */
  readonly terms: readonly TermView[];
}

/** 本体から webview へ。 */
export type ToWebview =
  | { readonly kind: "view"; readonly view: ConsequenceView }
  | { readonly kind: "busy"; readonly busy: boolean }
  | {
      /**
       * 本体からの通知。取得の失敗・部分的な欠け。
       *
       * 明細そのものが告げること（畳んだ件数など）とは出所が違うので、
       * 画面では別の帯に出す。一つの帯を共有すると、本体が取得のたびに送る
       * 「消せ」で明細側の通知が必ず消える。
       */
      readonly kind: "notice";
      readonly tone: "info" | "error";
      readonly text: string;
      readonly detail: string;
    };

/** webview から本体へ。 */
export type ToHost =
  | { readonly kind: "ready" }
  | { readonly kind: "refresh" }
  /** 文書を開く。`id` で指す。 */
  | { readonly kind: "openDocument"; readonly id: string }
  /**
   * 範囲か文書のファイルを開く。
   *
   * **`base` が座標系である。** 上流は二つの座標系で相対パスを返す——
   * 範囲（`trace-index`）は作業フォルダ基準の `src/model/view.ts`、
   * 所見（`docs-audit`）は統治木基準の `lens/spec/SPEC-006-….md`。
   * 一つの項に二座標系を混ぜると、片方が必ず開かない
   * （実測でそうなっていた。所見の道は一度も開けていなかった。CHANGE-027）。
   */
  | {
      readonly kind: "openRange";
      readonly path: string;
      readonly beginLine: number;
      readonly endLine: number;
      readonly base: "workspace" | "docs";
    };
// doctrine:end IMPL-001
