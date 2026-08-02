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
  /** 循環の並び。先頭と末尾が同じ id になる（`A → B → A`）。 */
  readonly path: readonly string[];
  readonly findings: readonly AuditFinding[];
}

/** 画面が出す要約。 */
export interface Summary {
  readonly documents: number;
  readonly codeRanges: number;
  readonly nowhere: number;
  readonly broken: number;
  readonly missing: number;
  readonly cycles: number;
}

/** 明細ひと揃い。 */
export interface Consequence {
  readonly origin: GraphNode | null;
  readonly waves: readonly Wave[];
  readonly cycles: readonly Cycle[];
  readonly summary: Summary;
  /** 起点に繋がらない文書の数。畳んだことを必ず言う（SPEC-006 制約）。 */
  readonly unreached: number;
  /** 起点の外に付いている所見の数。 */
  readonly findingsElsewhere: number;
}

/** 組み立てに要る、グラフの外から来る値。 */
export interface ConsequenceContext {
  /** 上流が返した所見。34 検査すべて。 */
  readonly findings: readonly AuditFinding[];
  /** 上流が返したコード範囲。取れていなければ空。 */
  readonly ranges: readonly TraceRange[];
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
  readonly rangeCount: number;
  readonly kind: Reason["kind"];
}): Symbol {
  if (hasHeavyFinding(input.findings)) return "broken";
  if (input.isReverseOrphan) return "missing";
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
      waves: [],
      cycles: [],
      summary: emptySummary(),
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

  const cycles: Cycle[] = groups
    .filter((group) => group.length > 1)
    .map((group) => ({
      path: cyclePath(group, neighbours),
      findings: group.flatMap((member) => findingsFor(member, context.findings)),
    }));
  const inCycle = new Set(cycles.flatMap((c) => c.path));

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

  const rangesById = new Map<string, TraceRange[]>();
  for (const range of context.ranges) {
    const bucket = rangesById.get(range.id) ?? [];
    bucket.push(range);
    rangesById.set(range.id, bucket);
  }

  const descendants = descendantCounts(scope, neighbours, groupOf);

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
      status: typeof node.status === "string" ? node.status : "",
      symbol: symbolFor({
        findings: own,
        isReverseOrphan: context.reverseOrphans.has(id),
        rangeCount: ranges.length,
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

  return {
    origin,
    waves,
    cycles,
    summary: {
      documents: rows.length,
      codeRanges: rows.reduce((n, r) => n + r.ranges.length, 0),
      nowhere: rows.filter((r) => r.symbol === "nowhere").length,
      broken: rows.filter((r) => r.symbol === "broken").length,
      missing: rows.filter((r) => r.symbol === "missing").length,
      cycles: cycles.length,
    },
    unreached: all.size - rows.length - inCycle.size - (inCycle.has(origin.id) ? 0 : 1),
    findingsElsewhere: context.findings.filter((f) => f.doc_id !== origin.id).length,
  };
}

function emptySummary(): Summary {
  return { documents: 0, codeRanges: 0, nowhere: 0, broken: 0, missing: 0, cycles: 0 };
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
