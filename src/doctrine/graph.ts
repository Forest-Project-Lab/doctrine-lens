// doctrine:begin SPEC-001
// 取得の束ねと、取得したものの保持。
//
// 取得に失敗しても、直前に成功した地図を消さない（SPEC-001 エラー時挙動）。
// 同じ統治木に対する取得は同時に一つに束ねる（SPEC-001 制約）。
// 範囲と所見の取得もこの束ねの中で行う（SPEC-004 制約）。
import { join } from "node:path";

import { fetchFindings, type AuditFinding } from "./audit.js";
import { fetchGlossary, type Glossary } from "./glossary.js";
import { runJson, type RunOptions } from "./cli.js";
import { fetchTraceRanges, type TraceRange } from "./trace.js";
import { fetchRegistry } from "./registry.js";
import type { DocMetaIndex } from "./model.js";
import { fail, ok, type Graph, type Outcome, type Registry } from "./model.js";

/** 取得したひと揃い。地図を描くのに要るものを束ねる。 */
export interface Snapshot {
  graph: Graph;
  /** 登録簿が読めなかったときは `null`。語彙に依る表示だけを止める。 */
  registry: Registry | null;
  /** 範囲が取れなかったときは `null`。L3 とコード側の面だけを止める。 */
  ranges: TraceRange[] | null;
  /** 所見が取れなかったときは `null`。判定の表示だけを止める。 */
  findings: AuditFinding[] | null;
  /** 上流が実際に走らせた検査の名。**取れなければ `null`。** 数を実装が持たない（ADR-014）。 */
  checksRun: string[] | null;
  /** 上流が挙げた逆孤児（対応する仕様や試験が無いもの）の id。**取れなければ `null`。** */
  reverseOrphans: string[] | null;
  /** 文書の題名など。取れなければ空の表。主文が id へ落ちる。 */
  docMeta: DocMetaIndex;
  /** 木の用語辞書。取れなければ空。語の定義を出さないだけで、明細は出る（ADR-018）。 */
  glossary: Glossary;
  docsRoot: string;
  projectDir: string;
}

/** 部分的に取れなかったものの名前。表示は呼び手が訳す（ADR-007）。 */
/** 部分的に取れなかったもの。 */
export interface PartialFetch {
  readonly what: "registry" | "ranges" | "findings" | "orphans" | "glossary";
  /** 取れなかった理由の符号。表示の文言は呼び手が訳す（ADR-007）。 */
  readonly reason: string;
  /**
   * 診断の詳細。上流が返した文言や、突き合わせで分かった食い違いが入る。
   *
   * 名前だけに潰すと、恒久的な設定の誤り（表示している木と上流が監査した木が
   * 違う、など）が一時的な取得の失敗と同じ見え方になり、直し方の手がかりが
   * 画面のどこにも残らない。
   */
  readonly detail: string;
}

/** 画面が受け取る取得の結果。前回の値と、今回の失敗が同時に立ちうる。 */
export interface FetchResult {
  /** 直前に成功した取得の結果。一度も成功していなければ `null`。 */
  snapshot: Snapshot | null;
  /** 今回の取得が失敗したときだけ立つ。 */
  failure: { reason: string; detail: string } | null;
  /** グラフは取れたが、部分的に取れなかったもの。 */
  partial: PartialFetch[];
}

/**
 * グラフを取り、登録簿・範囲・所見を添えて返す。
 *
 * グラフの取得だけが必須である。残る三つの失敗はグラフの失敗にしない。
 * それぞれが止めるのは、その値に依る表示だけである（SPEC-004 制約）。
 */
/**
 * 節点から題名などを組む。
 *
 * 上流 0.8.0 が節点の白名簿を捨てたので、frontmatter の項がそのまま届く。
 * 以前は上流の内部モジュールを直接呼ぶ継ぎ（`titles.ts` 137 行）で補っていた。
 * **上流が答えたので捨てた**（ADR-020）。
 */
function docMetaFrom(graph: Graph): DocMetaIndex {
  const out = new Map<string, { title: string; updated: string; supersededBy: string }>();
  for (const node of graph.nodes) {
    if (typeof node.id !== "string" || !node.id) continue;
    out.set(node.id, {
      title: typeof node.title === "string" ? node.title : "",
      updated: typeof node.updated === "string" ? node.updated : "",
      supersededBy: typeof node.superseded_by === "string" ? node.superseded_by : "",
    });
  }
  return out;
}

export async function fetchSnapshot(
  projectDir: string,
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
  withAudit = true,
): Promise<Outcome<{ snapshot: Snapshot; partial: PartialFetch[] }>> {
  const graphOutcome = await runJson<Graph>(
    [join(pluginRoot, "scripts", "dep-graph.py"), "--root", docsRoot, "--classify-edges", "--json"],
    options,
  );
  if (!graphOutcome.ok) return graphOutcome;

  const raw = graphOutcome.value;
  if (!Array.isArray(raw?.nodes) || !Array.isArray(raw?.edges)) {
    return fail("bad-json", 'the value has no "nodes" or "edges"');
  }

  // 残る三つは互いに独立なので並べて走らせる。どれが落ちても他を巻き込まない。
  // 監査は最も重いので、速い拍では走らせない（ADR-008）。
  const [registryOutcome, rangesOutcome, findingsOutcome, orphanOutcome, glossaryOutcome] =
    await Promise.all([
    fetchRegistry(pluginRoot, options),
    fetchTraceRanges(projectDir, docsRoot, pluginRoot, options),
    withAudit ? fetchFindings(projectDir, docsRoot, pluginRoot, options) : Promise.resolve(null),
    fetchReverseOrphans(docsRoot, pluginRoot, options),
    // 辞書の場所はグラフから引くので、グラフが取れたあとで良い。
    fetchGlossary(raw, docsRoot, pluginRoot, options),
  ]);

  const partial: PartialFetch[] = [];
  if (!registryOutcome.ok) {
    partial.push({ what: "registry", reason: registryOutcome.reason, detail: registryOutcome.detail });
  }
  if (!rangesOutcome.ok) {
    partial.push({ what: "ranges", reason: rangesOutcome.reason, detail: rangesOutcome.detail });
  }
  if (findingsOutcome && !findingsOutcome.ok) {
    partial.push({ what: "findings", reason: findingsOutcome.reason, detail: findingsOutcome.detail });
  }
  if (!orphanOutcome.ok) {
    partial.push({ what: "orphans", reason: orphanOutcome.reason, detail: orphanOutcome.detail });
  }
  if (!glossaryOutcome.ok) {
    partial.push({ what: "glossary", reason: glossaryOutcome.reason, detail: glossaryOutcome.detail });
  }

  return ok({
    snapshot: {
      graph: { nodes: raw.nodes, edges: raw.edges },
      registry: registryOutcome.ok ? registryOutcome.value : null,
      ranges: rangesOutcome.ok ? rangesOutcome.value : null,
      // 監査を飛ばした回は null を返す。呼び手が前回の判定を保つ（ADR-008）。
      findings: findingsOutcome?.ok ? findingsOutcome.value.findings : null,
      // 取れなかったものは `null` のまま運ぶ。空へ潰すと「無い」に化ける（ADR-023）。
      checksRun: findingsOutcome?.ok ? findingsOutcome.value.checksRun : null,
      reverseOrphans: orphanOutcome.ok ? orphanOutcome.value : null,
      // 題名は節点が持つ（上流 0.8.0 以降）。継ぎは捨てた（ADR-020）。
      docMeta: docMetaFrom(raw),
      glossary: glossaryOutcome.ok ? glossaryOutcome.value : new Map(),
      docsRoot,
      projectDir,
    },
    partial,
  });
}

/**
 * 対応する仕様や試験が無い文書の id を取る。
 *
 * 上流が「足りない」と判じたものである。こちらは「何が足りないか」の規則を持たない
 * （REQ-003）。返る形は `{req_without_spec: [...], spec_without_test: [...]}` で、
 * 分類はこちらで畳む——画面が出すのは「足りない」という一つの記号だけである。
 */
export async function fetchReverseOrphans(
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<string[]>> {
  const outcome = await runJson<{ result?: Record<string, unknown> }>(
    [
      join(pluginRoot, "scripts", "dep-graph.py"),
      "--root", docsRoot,
      "--reverse-orphans",
      "--json",
    ],
    options,
  );
  if (!outcome.ok) return outcome;
  const result = outcome.value?.result;
  if (!result || typeof result !== "object") {
    return fail<string[]>("bad-json", 'the value has no "result"');
  }
  const ids = new Set<string>();
  for (const bucket of Object.values(result)) {
    if (!Array.isArray(bucket)) continue;
    for (const id of bucket) if (typeof id === "string" && id) ids.add(id);
  }
  return ok([...ids].sort());
}

/**
 * 取得を束ね、直前に成功した結果を保つ入れ物。
 *
 * 同じ入れ物に対する取得は同時に一つだけ走る。走っている間に来た要求は、
 * その一つの結果を共有する。取得が終わったあとに来た要求は改めて走る。
 */
export type FetchSnapshot = typeof fetchSnapshot;

export class GraphStore {
  /**
   * 実際に取りに行く関数。
   *
   * 差し替えられるようにしてあるのは試験のためである。束ねと世代の規律は
   * 上流を起こさずには確かめられず、実物の CLI で確かめようとすると
   * 時間に依存した不安定な試験になる。ここを差し替えれば、走行中の切り替えや
   * 保存の割り込みを決定的に踏める。
   */
  readonly #fetch: FetchSnapshot;

  constructor(fetch: FetchSnapshot = fetchSnapshot) {
    this.#fetch = fetch;
  }

  #snapshot: Snapshot | null = null;
  /**
   * 走っている取得と、その要求の同一性。
   *
   * 「何かが走っている」だけで相乗りすると、二つの誤りが起きる。
   * 監査つきの要求が監査抜きの取得に相乗りして監査を黙って飛ばす。
   * 統治木を切り替えた直後の要求が前の木の取得に相乗りして別の木の結果を受け取る。
   * だから四つの値が揃ったときだけ相乗りする。
   */
  #inFlight:
    | {
        key: string;
        /** この取得が始まった時刻。これより後に木が汚れたなら相乗りできない。 */
        startedAt: number;
        promise: Promise<Outcome<{ snapshot: Snapshot; partial: PartialFetch[] }>>;
      }
    | null = null;

  /**
   * 世代。`clear()` のたびに進む。
   *
   * 走っている取得は止められない。世代を見ずに結果を代入すると、`clear()` の
   * あとに前の木の取得が着地して、捨てたはずの地図が新しい木の状態として蘇る。
   */
  #generation = 0;

  /** 木が汚れた時刻。ファイルの保存で進む。 */
  #dirtyAt = 0;

  /** 直前に成功した取得の結果。一度も成功していなければ `null`。 */
  get snapshot(): Snapshot | null {
    return this.#snapshot;
  }

  /** 保持している結果を捨てる。統治木が変わったときに呼ぶ。 */
  clear(): void {
    this.#snapshot = null;
    this.#generation += 1;
  }

  /**
   * 木が変わったことを告げる。ファイルの保存で呼ぶ。
   *
   * これを呼んでおくと、以降の要求は「保存より前に始まった取得」に相乗りしない。
   * 相乗りすると保存前の姿を受け取り、間引きを 0 にしていると取り直されない。
   */
  markDirty(now = Date.now()): void {
    this.#dirtyAt = now;
  }

  /**
   * 取得する。走っている取得があればそれに相乗りする。
   *
   * 失敗しても保持している結果は消さない。返り値の `snapshot` には、
   * 失敗時も直前に成功した結果が入る。
   */
  async refresh(
    projectDir: string,
    docsRoot: string,
    pluginRoot: string,
    options: RunOptions,
    withAudit = true,
  ): Promise<FetchResult> {
    // 設定も鍵に入れる。python の在処や打ち切りを直した直後の取り直しが、
    // 古い設定で走っている取得に相乗りしては、直した意味が無い。
    const key = JSON.stringify([projectDir, docsRoot, pluginRoot, withAudit, options]);
    const requestedAt = Date.now();

    // 相乗りできない取得が走っている間は待つ。`if` で一度だけ待つと、鍵の違う
    // 待ち手が二つあったとき両方が走り出し、保持する地図が「要求の順」ではなく
    // 「終わった順」で決まる。済むまで繰り返し待つ。
    while (this.#inFlight && !this.#canJoin(this.#inFlight, key, requestedAt)) {
      await this.#inFlight.promise.catch(() => undefined);
    }
    if (!this.#inFlight) {
      const startedAt = Date.now();
      const promise = this.#fetch(
        projectDir, docsRoot, pluginRoot, options, withAudit,
      ).finally(() => {
        // 待ち合わせが直列化しているので、ここが走る時点で走っている取得は
        // 必ずこれ自身である（別の取得が登録されるのは、待ち手が await から
        // 戻ったあと、つまりこの後である）。同一性の検めは到達しないので置かない。
        this.#inFlight = null;
      });
      this.#inFlight = { key, startedAt, promise };
    }
    const generation = this.#generation;
    const outcome = await this.#inFlight.promise;
    if (outcome.ok) {
      // 待っているあいだに木が切り替わっていれば、この結果はもう別の木の話である。
      // 捨てた地図を蘇らせない。呼び手には返すが、入れ物には残さない。
      if (generation === this.#generation) this.#snapshot = outcome.value.snapshot;
      return { snapshot: outcome.value.snapshot, failure: null, partial: outcome.value.partial };
    }
    return {
      snapshot: this.#snapshot,
      failure: { reason: outcome.reason, detail: outcome.detail },
      partial: [],
    };
  }

  /**
   * 走っている取得に相乗りしてよいか。
   *
   * 要求が同じで、かつその取得が「木が汚れたあと」に始まっているときだけ。
   * 汚れる前に始まった取得の結果は、要求した側から見れば古い。
   */
  #canJoin(
    inFlight: { key: string; startedAt: number },
    key: string,
    requestedAt: number,
  ): boolean {
    if (inFlight.key !== key) return false;
    return !(this.#dirtyAt > inFlight.startedAt && this.#dirtyAt <= requestedAt);
  }
}
// doctrine:end SPEC-001
