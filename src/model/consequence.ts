// doctrine:begin SPEC-006
// 帰結の組み立て — 起点から「直すことになるもの」を、直す順に並べる。
//
// 答える問いは一つだけである（SPEC-006）。
//
//   これを変えたら、何を、どの順で直すことになるか。
//
// ここは編集器の機能を使わない純粋な関数だけで書く。表示の文字列も持たない。
// 何を出すかの符号だけを返し、訳は描き手に委ねる（ADR-007）。
//
// **上流の語彙を持たない。** 型の一覧も、検査の名前の一覧も、
// `REQ→SPEC→IMPL→TEST` のような並びの表も持たない（REQ-003）。
// 並び順は「辺での距離」だけで決まる。
import type { AuditFinding } from "../doctrine/audit.js";
import type { Graph, GraphNode } from "../doctrine/model.js";
import type { TraceRange } from "../doctrine/trace.js";

/**
 * 各行の左端に置く記号。
 *
 * 重い順に排他である（`×` > `+` > `?` > `!` > `~`）。
 * それぞれがちょうど一つの上流の事実から出る（SPEC-006 制約）。
 */
export type Symbol =
  /** 既に壊れている。`docs-audit` の severity=error/warn がその文書に付いている */
  | "broken"
  /** 足りない。`--reverse-orphans` に載る */
  | "missing"
  /** 直す場所が無い。波及先だが結ばれたコード範囲が零件 */
  | "nowhere"
  /** 直す。起点に依存しているので前提が変わる */
  | "fix"
  /** 見直す。起点が影響すると宣言している */
  | "review";

/** 記号の重さ。小さいほど重い。排他の判定に使う。 */
const WEIGHT: Readonly<Record<Symbol, number>> = {
  broken: 0,
  missing: 1,
  nowhere: 2,
  fix: 3,
  review: 4,
};

/**
 * なぜこの行が居るのか。表示の文言は描き手が訳す（ADR-007）。
 *
 * どの理由も、**直前の相手**を名で持つ。持たないと、三段先の行に
 * 「起点が影響すると宣言している」と書くことになる。起点は宣言していない。
 */
export type Reason =
  /** 起点を `depends_on` に持つ。前提が変わる */
  | { readonly kind: "depends-directly" }
  /** 経由して起点に依存している */
  | { readonly kind: "depends-through"; readonly through: string }
  /** 直前の相手が、影響すると宣言している */
  | { readonly kind: "impacted"; readonly by: string };

/** 明細の一行。 */
export interface Row {
  readonly id: string;
  /**
   * 起点と直に結ばれているか。
   *
   * 波は**最長距離**で決まるので、直の辺を持つ文書が後の波へ回ることがある。
   * その行に「{X} を経由して依存している」とだけ書くと、**存在する直の辺を
   * 無いことにする。** 両方を言うためにここで持つ（ADR-017）。
   */
  readonly alsoDirect: boolean;
  /**
   * 上流が返した status を素通しする。
   *
   * 非現行が現行と交互に混ざるので、行が自分で言う必要がある（ADR-014）。
   * 語彙をこちらが持たない——値をそのまま運ぶだけである（REQ-003）。
   */
  readonly status: string;
  readonly symbol: Symbol;
  readonly reason: Reason;
  /** この行を片づけると確定に向かう件数。同じ波の中の並び順に使う。 */
  readonly behind: number;
  /** 結ばれたコード範囲。零件なら記号が `nowhere` になる。 */
  readonly ranges: readonly TraceRange[];
  /** この文書に付いている所見。上流の文をそのまま運ぶ。 */
  readonly findings: readonly AuditFinding[];
}

/** 一つの波。 */
export interface Wave {
  /** 起点からの距離。1 が起点に直接ぶら下がるもの。 */
  readonly distance: number;
  readonly rows: readonly Row[];
}

/** 循環に入っていて波が決まらない組。 */
export interface Cycle {
  /**
   * 見せるための一巡。先頭と末尾が同じ id になる（`A → B → A`）。
   *
   * **成分の全員を覆うとは限らない。** `A↔B, B↔C` の成分から書き下せる一巡は
   * `A → B → A` で、`C` は載らない。件数を数えるときは `members` を使う。
   */
  readonly path: readonly string[];
  /** 強連結成分の全員。畳んだ件数はここから数える。 */
  readonly members: readonly string[];
  readonly findings: readonly AuditFinding[];
}

/** 画面が出す要約。 */
/**
 * 画面が出す要約。
 *
 * **記号ごとの数（`bySymbol`）と、事実ごとの数（`facts`）を分ける。**
 * 記号は重い順に排他なので、`broken` に負けた「足りない」は記号の数から消える。
 * 排他は「一行にどれを出すか」の規律であって、数の規律ではない。
 * 実測で、逆孤児かつ範囲 0 の文書に error が付くと「足りない 0 ・ 直す場所が無い 0」
 * と出ていた。どちらも事実ではない。
 */
export interface Summary {
  readonly documents: number;
  readonly codeRanges: number;
  /** 記号ごとの件数。五つの和が `documents` に一致する。 */
  readonly bySymbol: Readonly<Record<Symbol, number>>;
  /** 事実ごとの件数。記号に負けたものも数える。互いに排他ではない。 */
  readonly facts: {
    readonly broken: number;
    readonly missing: number;
    readonly noRange: number;
  };
  /** 循環の本数。文書の数ではない。 */
  readonly cycles: number;
  /** 循環に落ちて波に入らなかった文書の数。 */
  readonly inCycle: number;
}

/** 明細ひと揃い。 */
export interface Consequence {
  readonly origin: GraphNode | null;
  /**
   * 起点自身に付いている所見。
   *
   * 起点は行にならないので、ここに出さないと画面のどこにも現れない。
   * 実測で、起点に `error` が付いていても「壊れている 0」と言い切っていた。
   */
  readonly originFindings: readonly AuditFinding[];
  /** 起点自身の記号。所見と逆孤児と範囲の有無から、行と同じ規則で決まる。 */
  readonly originSymbol: Symbol | null;
  readonly waves: readonly Wave[];
  readonly cycles: readonly Cycle[];
  readonly summary: Summary;
  /** コード範囲を取れたか。取れていなければ、範囲に関する数は意味を持たない。 */
  readonly rangesKnown: boolean;
  /**
   * 起点が前提にしている文書の数。
   *
   * この画面は「起点を変えると何が壊れるか」の向きにしか辿らないので、
   * 起点が依っているものは一件も出ない。**それは「無関係」ではない。**
   * 「繋がらない」に混ぜると読み手が「影響なし」と読む。
   */
  readonly premiseCount: number;
  /** 帰結にも前提にも繋がらない文書の数。畳んだことを必ず言う（SPEC-006 制約）。 */
  readonly unreached: number;
  /** **画面のどこにも出ていない**所見の数。「起点以外」ではない。 */
  readonly findingsElsewhere: number;
}

/** 組み立てに要る、グラフの外から来る値。 */
export interface ConsequenceContext {
  /** 上流が返した所見。34 検査すべて。 */
  readonly findings: readonly AuditFinding[];
  /**
   * 上流が返したコード範囲。
   *
   * **取れなかったときは `null` を渡すこと。** 空配列を渡すと、
   * 「本当に範囲が無い」と区別が付かず、全部の行が `?`（直す場所が無い）に化ける。
   * 実測でそうなった（ADR-017）。
   */
  readonly ranges: readonly TraceRange[] | null;
  /** 上流 `--reverse-orphans` が挙げた id。 */
  readonly reverseOrphans: ReadonlySet<string>;
}

const EMPTY_CONTEXT: ConsequenceContext = {
  findings: [],
  ranges: [],
  reverseOrphans: new Set(),
};

/** 起点からの向きつき隣接。値は「その相手へ渡る辺の種類」。 */
type Neighbours = ReadonlyMap<string, ReadonlyMap<string, Reason["kind"]>>;

/**
 * 「起点を変えると影響が及ぶ」向きの隣接。
 *
 * 上流は依存（`depends_on`）と影響（`impacts`）を別の端として持つ。
 * どちらも「起点が変わると相手を見直すことになる」向きだが、意味が違うので
 * 別の理由として運ぶ。ここで混ぜてよいのは**到達の計算だけ**である。
 *
 * - `X depends_on 起点` → 起点が変われば X の前提が変わる。辺を dst→src で辿る。
 * - `起点 impacts Y` → 起点が変われば Y へ波及する。辺を src→dst で辿る。
 *
 * 自己ループは辿らない。相互のペアは集合なので自然に一つに畳まれる。
 */
function affectedNeighbours(graph: Graph): Map<string, Map<string, Reason["kind"]>> {
  const out = new Map<string, Map<string, Reason["kind"]>>();
  const add = (from: string, to: string, kind: Reason["kind"]): void => {
    if (from === to) return;
    const bucket = out.get(from) ?? new Map<string, Reason["kind"]>();
    // 依存のほうが強い理由である。両方あるときは依存を残す。
    if (!(bucket.get(to) === "depends-directly")) bucket.set(to, kind);
    out.set(from, bucket);
  };
  for (const edge of graph.edges) {
    if (edge.field === "depends_on") add(edge.dst, edge.src, "depends-directly");
    else if (edge.field === "impacts") add(edge.src, edge.dst, "impacted");
  }
  return out;
}

/** 起点から辿り着けるものを集める（起点自身を含む）。 */
function reachFrom(origin: string, neighbours: Neighbours): Set<string> {
  const seen = new Set<string>([origin]);
  let frontier = [origin];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const to of neighbours.get(from)?.keys() ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        next.push(to);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * 強連結成分を、逆位相順で返す（Tarjan）。
 *
 * なぜ要るか: 波の番号は「起点からの**最長**距離」である。最短距離で並べると、
 * `起点 → C → B` と `起点 → B` の両方があるとき B が第 1 波に出る。だが B は
 * C 経由でも起点に依存しているので、C を直す前に B を直すと前提が二度変わる。
 * 順を答える画面が、間違った順を答えることになる。
 *
 * 最長距離は循環があると定まらない。そこで循環を一つの塊に畳む。畳んだ図
 * （縮約）は必ず非循環なので、最長距離が全域で定まる。
 *
 * 明示の作業スタックで回す。再帰で書くと、深い木で呼び出し段が尽きて例外になる。
 */
function stronglyConnected(
  origin: string,
  neighbours: Neighbours,
  inScope: ReadonlySet<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  // 並びを固定する。同じ入力から同じ出力を出す（REQ-002）。
  const successors = (id: string): string[] =>
    [...(neighbours.get(id)?.keys() ?? [])].filter((to) => inScope.has(to)).sort();

  const roots = [origin, ...[...inScope].sort()];
  for (const root of roots) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    const work = [{ id: root, next: successors(root), at: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1] as { id: string; next: string[]; at: number };
      if (frame.at < frame.next.length) {
        const to = frame.next[frame.at] as string;
        frame.at += 1;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter);
          counter += 1;
          stack.push(to);
          onStack.add(to);
          work.push({ id: to, next: successors(to), at: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.id, Math.min(low.get(frame.id) as number, index.get(to) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.id, Math.min(low.get(parent.id) as number, low.get(frame.id) as number));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const group: string[] = [];
        for (;;) {
          const member = stack.pop() as string;
          onStack.delete(member);
          group.push(member);
          if (member === frame.id) break;
        }
        out.push(group.sort());
      }
    }
  }
  return out;
}

/**
 * 強連結成分の中から、実際の循環を一本取り出す（`A → B → A`）。
 *
 * 成分が二つ以上の要素を持つなら、その中のどの点からも自分へ戻る道がある。
 * 最小の id から幅優先で戻り道を引き、経路として書き下す。
 */
function cyclePath(group: readonly string[], neighbours: Neighbours): string[] {
  const inside = new Set(group);
  const start = group[0] as string;
  const via = new Map<string, string>();
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const to of [...(neighbours.get(from)?.keys() ?? [])].sort()) {
        if (!inside.has(to)) continue;
        if (to === start) {
          const path = [start];
          for (let at = from; at !== start; at = via.get(at) as string) path.unshift(at);
          path.unshift(start);
          return path;
        }
        if (via.has(to)) continue;
        via.set(to, from);
        next.push(to);
      }
    }
    frontier = next;
  }
  // 成分の大きさが 2 以上なら必ず戻れるので、ここへは来ない。
  return [...group, start];
}

/** その文書に付いている所見。上流の文をそのまま運ぶ。 */
function findingsFor(id: string, findings: readonly AuditFinding[]): AuditFinding[] {
  return findings.filter((f) => f.doc_id === id || (f.refs ?? []).includes(id));
}

/** 所見の中に「重い」ものが在るか。重さの語彙は上流が定める（REQ-003）。 */
function hasHeavyFinding(findings: readonly AuditFinding[]): boolean {
  return findings.some((f) => f.severity === "error" || f.severity === "warn");
}

/**
 * 記号を決める。重い順に排他で当てる。
 *
 * 各記号はちょうど一つの事実から出る。二つの事実を一つの記号に畳まない。
 */
export function symbolFor(input: {
  readonly findings: readonly AuditFinding[];
  readonly isReverseOrphan: boolean;
  /** 結ばれた範囲の数。**取れていなければ `null`。** */
  readonly rangeCount: number | null;
  readonly kind: Reason["kind"];
}): Symbol {
  if (hasHeavyFinding(input.findings)) return "broken";
  if (input.isReverseOrphan) return "missing";
  // 取れていない（null）ときは「無い」と言わない。知らないことを断定しない。
  if (input.rangeCount === 0) return "nowhere";
  return input.kind === "impacted" ? "review" : "fix";
}

/** 記号の重さを返す。並び替えと排他の判定に使う。 */
export function weightOf(symbol: Symbol): number {
  return WEIGHT[symbol];
}

/**
 * 起点から帰結を組み立てる。
 *
 * `origin` がグラフに無ければ、起点なしの明細を返す（例外にしない）。
 */
export function buildConsequence(
  graph: Graph,
  originId: string | null,
  context: ConsequenceContext = EMPTY_CONTEXT,
): Consequence {
  const all = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const origin = originId ? (all.get(originId) ?? null) : null;

  if (!origin) {
    return {
      origin: null,
      originFindings: [],
      originSymbol: null,
      waves: [],
      cycles: [],
      rangesKnown: context.ranges !== null,
      summary: emptySummary(),
      premiseCount: 0,
      unreached: all.size,
      findingsElsewhere: context.findings.length,
    };
  }

  const neighbours = affectedNeighbours(graph);
  const scope = reachFrom(origin.id, neighbours);

  // 循環を塊に畳む。Tarjan は逆位相順で返すので、ひっくり返すと位相順になる。
  const groups = stronglyConnected(origin.id, neighbours, scope).reverse();
  const groupOf = new Map<string, number>();
  groups.forEach((group, at) => group.forEach((id) => groupOf.set(id, at)));

  // 塊そのものを持つ。`path` は見せるための一巡であって、成分の全員を覆うとは限らない。
  // 覆わない場合（`A↔B, B↔C` など）、経路に載らない要素が行にも循環にも出ず、
  // 「起点から届かない」件数に化けていた。実測で再現した。
  const tangles = groups.filter((group) => group.length > 1);
  const cycles: Cycle[] = tangles.map((group) => ({
    path: cyclePath(group, neighbours),
    // 成分の全員を運ぶ。画面はこの件数を言える（畳んだら必ず件数を書く）。
    members: [...group].sort(),
    findings: group.flatMap((member) => findingsFor(member, context.findings)),
  }));
  // 節点として実在するものだけを数える。辺だけが指す死んだ参照を混ぜると、
  // `unreached` の引き算が合わなくなり、件数が負になりうる（実測で -1 になった）。
  const inCycle = new Set(tangles.flat().filter((id) => all.has(id)));

  // 縮約の上で最長距離を取る。位相順に一度なめれば済む。
  const originGroup = groupOf.get(origin.id) as number;
  const distance = new Map<number, number>([[originGroup, 0]]);
  const via = new Map<string, { from: string; kind: Reason["kind"] }>();
  for (const [at, group] of groups.entries()) {
    const here = distance.get(at);
    if (here === undefined) continue;
    for (const from of group) {
      for (const [to, kind] of neighbours.get(from) ?? []) {
        if (!scope.has(to)) continue;
        const there = groupOf.get(to) as number;
        if (there === at) continue;
        const candidate = here + 1;
        const known = distance.get(there);
        if (known === undefined || candidate > known) {
          distance.set(there, candidate);
          via.set(to, { from, kind });
        } else if (candidate === known && kind === "depends-directly") {
          // 同じ距離なら依存の側を理由に採る。影響より強く、直し方が具体である。
          via.set(to, { from, kind });
        }
      }
    }
  }

  // 取れなかったときは表を作らない。`null` のまま下へ流し、「無い」と言わない。
  const rangesKnown = context.ranges !== null;
  const rangesById = new Map<string, TraceRange[]>();
  for (const range of context.ranges ?? []) {
    const bucket = rangesById.get(range.id) ?? [];
    bucket.push(range);
    rangesById.set(range.id, bucket);
  }

  const descendants = descendantCounts(scope, neighbours, groupOf);
  // 起点と直に結ばれている相手。最長距離で後の波へ回っても、この事実は消えない。
  const directNeighbours = new Set(neighbours.get(origin.id)?.keys() ?? []);

  const rows: Row[] = [];
  for (const id of [...scope].sort()) {
    if (id === origin.id) continue;
    if (inCycle.has(id)) continue;
    if (!all.has(id)) continue;
    const hit = via.get(id);
    const at = distance.get(groupOf.get(id) as number);
    if (!hit || at === undefined) continue;
    const own = findingsFor(id, context.findings);
    const ranges = rangesById.get(id) ?? [];
    const node = all.get(id) as GraphNode;
    rows.push({
      id,
      alsoDirect: directNeighbours.has(id),
      status: typeof node.status === "string" ? node.status : "",
      symbol: symbolFor({
        findings: own,
        isReverseOrphan: context.reverseOrphans.has(id),
        rangeCount: rangesKnown ? ranges.length : null,
        kind: hit.kind,
      }),
      reason:
        hit.kind === "impacted"
          ? { kind: "impacted", by: hit.from }
          : at === 1
            ? { kind: "depends-directly" }
            : { kind: "depends-through", through: hit.from },
      behind: descendants.get(id) ?? 0,
      ranges,
      findings: own,
    });
  }

  const byDistance = new Map<number, Row[]>();
  for (const row of rows) {
    const at = distance.get(groupOf.get(row.id) as number) as number;
    const bucket = byDistance.get(at) ?? [];
    bucket.push(row);
    byDistance.set(at, bucket);
  }

  const waves: Wave[] = [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, bucket]) => ({
      distance: at,
      // 同じ波の中は「後ろに N」の降順。同数なら記号の重い順、それも同じなら id 順。
      rows: [...bucket].sort(
        (a, b) =>
          b.behind - a.behind ||
          weightOf(a.symbol) - weightOf(b.symbol) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    }));

  // 起点自身。行にならないので、ここで組まないと画面のどこにも出ない。
  const originFindings = findingsFor(origin.id, context.findings);
  const originRanges = rangesById.get(origin.id) ?? [];
  const originSymbol = symbolFor({
    findings: originFindings,
    isReverseOrphan: context.reverseOrphans.has(origin.id),
    rangeCount: rangesKnown ? originRanges.length : null,
    kind: "depends-directly",
  });

  // 起点が前提にしているもの。**この画面はそこを辿らない**（設計どおり）。
  // 辿らないことと「関係が無い」ことは別なので、件数を分けて数える。
  // 起点自身を除く。`reachFrom` は起点を含めて返す。
  const premises = new Set(
    [...reachFrom(origin.id, reversed(neighbours))].filter(
      (id) => id !== origin.id && all.has(id) && !inCycle.has(id),
    ),
  );

  // 画面のどこかに現れた所見。ここに入らないものだけが「外」である。
  const shown = new Set<AuditFinding>([
    ...originFindings,
    ...rows.flatMap((r) => r.findings),
    ...cycles.flatMap((c) => c.findings),
  ]);

  const bySymbol: Record<Symbol, number> = {
    broken: 0,
    missing: 0,
    nowhere: 0,
    fix: 0,
    review: 0,
  };
  for (const row of rows) bySymbol[row.symbol] += 1;

  return {
    origin,
    originFindings,
    originSymbol,
    waves,
    cycles,
    rangesKnown,
    summary: {
      documents: rows.length,
      codeRanges: rows.reduce((n, r) => n + r.ranges.length, 0),
      bySymbol,
      // 記号に負けた事実も数える。排他は行の規律であって数の規律ではない。
      facts: {
        broken: rows.filter((r) => hasHeavyFinding(r.findings)).length,
        missing: rows.filter((r) => context.reverseOrphans.has(r.id)).length,
        noRange: rows.filter((r) => r.ranges.length === 0).length,
      },
      cycles: cycles.length,
      inCycle: inCycle.size,
    },
    // 起点が前提にしているもの。辿る向きが違うので出さない（無関係ではない）。
    premiseCount: premises.size,
    unreached: Math.max(0, all.size - rows.length - inCycle.size - 1 - premises.size),
    // 「外」は「画面のどこにも出ていない」である。「起点以外」ではない。
    findingsElsewhere: context.findings.filter((f) => !shown.has(f)).length,
  };
}

/** 隣接を逆向きにする。起点が前提にしているものを辿るために使う。 */
function reversed(neighbours: Neighbours): Neighbours {
  const out = new Map<string, Map<string, Reason["kind"]>>();
  for (const [from, bucket] of neighbours) {
    for (const [to, kind] of bucket) {
      const back = out.get(to) ?? new Map<string, Reason["kind"]>();
      back.set(from, kind);
      out.set(to, back);
    }
  }
  return out;
}

function emptySummary(): Summary {
  return {
    documents: 0,
    codeRanges: 0,
    bySymbol: { broken: 0, missing: 0, nowhere: 0, fix: 0, review: 0 },
    facts: { broken: 0, missing: 0, noRange: 0 },
    cycles: 0,
    inCycle: 0,
  };
}

/**
 * その文書を片づけると、いくつが確定に向かうか。
 *
 * その文書から先に到達できるものの数である（自分と、自分と同じ塊は数えない）。
 * 同じ波の中の並び順に使う。順位を数で説明できるようにするため。
 */
function descendantCounts(
  scope: ReadonlySet<string>,
  neighbours: Neighbours,
  groupOf: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of scope) {
    const mine = groupOf.get(id);
    const seen = new Set<string>([id]);
    let frontier = [id];
    let count = 0;
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const from of frontier) {
        for (const to of neighbours.get(from)?.keys() ?? []) {
          if (!scope.has(to) || seen.has(to)) continue;
          seen.add(to);
          if (groupOf.get(to) !== mine) count += 1;
          next.push(to);
        }
      }
      frontier = next;
    }
    out.set(id, count);
  }
  return out;
}
// doctrine:end SPEC-006
