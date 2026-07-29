// 取得の入れ物の規律 — 世代・相乗り・待ち合わせ・鍵（SPEC-001 制約）。
//
// なぜ専用の試験が要るか: ここは「走行中に何かが起きた」ときにだけ壊れる。
// 実物の CLI で確かめようとすると時間に依存した不安定な試験になり、
// かといって字面では守れない。取りに行く関数を差し替えて、走行中の切り替え・
// 保存の割り込み・世代の入れ替わりを決定的に踏む。
//
// 三巡目でここへ入れた直しは、どれも試験が無く、個別に潰しても全件が通っていた。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { RunOptions } from "../doctrine/cli.js";
import { fetchSnapshot, GraphStore, type FetchSnapshot, type Snapshot } from "../doctrine/graph.js";
import { ok, type Outcome } from "../doctrine/model.js";

const OPTIONS: RunOptions = { pythonPath: "python3", timeoutMs: 1000, cwd: "/w" };
const OTHER: RunOptions = { pythonPath: "/venv/bin/python", timeoutMs: 1000, cwd: "/w" };

interface Pending {
  readonly docsRoot: string;
  readonly withAudit: boolean;
  readonly settle: () => void;
}

/**
 * 取りに行く関数の代わり。呼ばれた分だけ手で決着させられる。
 *
 * 決着の順を試験の側が決められるので、「後から始まった取得が先に着く」
 * といった順序も踏める。
 */
function stubFetch(): { fetch: FetchSnapshot; pending: Pending[]; calls: number } {
  const pending: Pending[] = [];
  const state = { calls: 0 };
  const fetch: FetchSnapshot = (projectDir, docsRoot, pluginRoot, options, withAudit = true) => {
    state.calls += 1;
    let settle!: () => void;
    const promise = new Promise<Outcome<{ snapshot: Snapshot; partial: [] }>>((resolve) => {
      settle = (): void =>
        resolve(
          ok({
            snapshot: {
              graph: { nodes: [{ id: docsRoot, path: "", type: "SPEC", domain: "d", status: "current", depends_on: [], impacts: [], canonical_for: [] }], edges: [] },
              registry: null,
              ranges: null,
              findings: null,
              reverseOrphans: [],
              docMeta: new Map(),
              docsRoot,
              projectDir,
            },
            partial: [],
          }),
        );
    });
    pending.push({ docsRoot, withAudit, settle });
    return promise;
  };
  return {
    fetch,
    pending,
    get calls(): number {
      return state.calls;
    },
  } as { fetch: FetchSnapshot; pending: Pending[]; calls: number };
}

/** 直前に積まれた要求を決着させ、待っている側が進むまで譲る。 */
async function settleLast(pending: Pending[]): Promise<void> {
  pending[pending.length - 1]?.settle();
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

test("clear() は走っている取得を無効にする（捨てた地図が蘇らない）", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  const running = store.refresh("/w", "/w/old", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1, "取得が始まっている");

  // 走っているあいだに木を捨てる。
  store.clear();
  await settleLast(pending);
  const result = await running;

  assert.ok(result.snapshot, "呼び手には返す");
  assert.equal(
    store.snapshot,
    null,
    "捨てたあとに着地した結果を、入れ物が保ってはならない",
  );
});

test("同じ要求は一つの取得を共有する", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  const a = store.refresh("/w", "/w/docs", "/p", OPTIONS);
  const b = store.refresh("/w", "/w/docs", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1, "二つの要求で取得は一つ");

  await settleLast(pending);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.snapshot, rb.snapshot, "同じ結果を共有する");
});

test("鍵が違えば相乗りせず、待ってから走る", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  const first = store.refresh("/w", "/w/a", "/p", OPTIONS);
  await Promise.resolve();
  const second = store.refresh("/w", "/w/b", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1, "先の取得が済むまで次を走らせない");

  await settleLast(pending);
  await first;
  assert.equal(pending.length, 2, "済んでから走る");
  assert.equal(pending[1]?.docsRoot, "/w/b");
  await settleLast(pending);
  const result = await second;
  assert.equal(result.snapshot?.docsRoot, "/w/b", "自分の木の結果を受け取る");
});

test("鍵の違う待ち手が二つあっても、二重に走らせない", async () => {
  // `if` で一度だけ待つと、待ち手が二つあったとき両方が走り出し、
  // 保持する地図が「要求の順」ではなく「終わった順」で決まる。
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  void store.refresh("/w", "/w/a", "/p", OPTIONS);
  await Promise.resolve();
  const b = store.refresh("/w", "/w/b", "/p", OPTIONS);
  const c = store.refresh("/w", "/w/c", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1, "走っているのは最初の一つだけ");

  await settleLast(pending);
  assert.equal(pending.length, 2, "次は一つだけ走る（二つ同時に走らない）");
  await settleLast(pending);
  await b;
  assert.equal(pending.length, 3);
  await settleLast(pending);
  await c;
  assert.equal(pending.length, 3, "余分に走らせない");
  assert.equal(store.snapshot?.docsRoot, "/w/c", "最後に要求した木が残る");
});

test("監査つきの要求は、監査抜きの取得に相乗りしない", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  void store.refresh("/w", "/w/docs", "/p", OPTIONS, false);
  await Promise.resolve();
  void store.refresh("/w", "/w/docs", "/p", OPTIONS, true);
  await Promise.resolve();
  assert.equal(pending.length, 1, "先が済むまで待つ");
  await settleLast(pending);
  assert.equal(pending.length, 2);
  assert.equal(pending[1]?.withAudit, true, "監査つきの取得が別に走る");
});

test("設定を直した直後の取り直しは、古い設定の取得に相乗りしない", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  void store.refresh("/w", "/w/docs", "/p", OPTIONS);
  await Promise.resolve();
  void store.refresh("/w", "/w/docs", "/p", OTHER);
  await Promise.resolve();
  assert.equal(pending.length, 1, "束ねの鍵に設定が入っていない疑い");
  await settleLast(pending);
  assert.equal(pending.length, 2, "設定が違えば別に走る");
});

test("保存より前に始まった取得へは相乗りしない", async () => {
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  void store.refresh("/w", "/w/docs", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1);

  // ここでファイルが保存された。走っている取得はその前の姿である。
  // 時刻の分解能に依らないよう、始まりと保存のあいだを実際に空ける。
  await new Promise((r) => setTimeout(r, 5));
  store.markDirty();
  void store.refresh("/w", "/w/docs", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1, "済むまで待つ");

  await settleLast(pending);
  assert.equal(pending.length, 2, "保存後の姿を取り直す（相乗りして古い姿を返さない）");
});

test("汚れる前の要求どうしは、これまでどおり相乗りする", async () => {
  // 保存の合図が入っても、その前に来ていた要求まで直列化してはならない。
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);

  const a = store.refresh("/w", "/w/docs", "/p", OPTIONS);
  const b = store.refresh("/w", "/w/docs", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 1);
  await settleLast(pending);
  await Promise.all([a, b]);
  assert.equal(pending.length, 1, "余分に走らせない");
});

test("失敗しても、直前に成功した結果を入れ物が保つ", async () => {
  const calls: string[] = [];
  const fetch: FetchSnapshot = async (projectDir, docsRoot) => {
    calls.push(docsRoot);
    if (docsRoot === "/w/bad") {
      return { ok: false, reason: "exit-nonzero", detail: "boom" } as never;
    }
    return ok({
      snapshot: {
        graph: { nodes: [], edges: [] },
        registry: null,
        ranges: null,
        findings: null,
        reverseOrphans: [],
        docMeta: new Map(),
        docsRoot,
        projectDir,
      },
      partial: [],
    });
  };
  const store = new GraphStore(fetch);
  const first = await store.refresh("/w", "/w/good", "/p", OPTIONS);
  assert.ok(first.snapshot);
  const kept = first.snapshot;

  const second = await store.refresh("/w", "/w/bad", "/p", OPTIONS);
  assert.ok(second.failure);
  assert.equal(second.snapshot, kept, "直前に成功した結果が返る");
  assert.equal(store.snapshot, kept, "入れ物の中身も消えない");
});

// --- 部分的に取れなかったものの理由と詳細 --------------------------------
//
// 名前だけに潰すと、恒久的な設定の誤り（表示している木と上流が監査した木が違う、
// など）が一時的な取得の失敗と同じ見え方になり、直し方の手がかりが画面に残らない。

test("部分的な失敗の理由と詳細が、呼び手まで届く", async () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-partial-"));
  try {
    // グラフだけ返し、登録簿・範囲・監査は落ちる偽のプラグインを置く。
    const scripts = join(dir, "plugin", "scripts");
    mkdirSync(scripts, { recursive: true });
    writeFileSync(
      join(scripts, "dep-graph.py"),
      'import json,sys;json.dump({"nodes":[],"edges":[]},sys.stdout)',
      "utf8",
    );
    for (const name of ["trace-index.py", "docs-audit.py"]) {
      writeFileSync(join(scripts, name), 'import sys;sys.stderr.write("BOOM-" + __file__);sys.exit(3)', "utf8");
    }
    // 登録簿は `-c` で読むので、_registry を置かなければ落ちる。

    const outcome = await fetchSnapshot(dir, join(dir, "doctrine_docs"), join(dir, "plugin"), {
      pythonPath: "python3",
      timeoutMs: 20000,
      cwd: dir,
    });
    assert.ok(outcome.ok, "グラフが取れれば取得そのものは成功する");
    if (!outcome.ok) return;

    const partial = outcome.value.partial;
    assert.deepEqual(
      [...partial.map((p) => p.what)].sort(),
      ["findings", "orphans", "ranges", "registry", "titles"],
      "五つとも部分的な失敗として挙がる",
    );
    for (const item of partial) {
      assert.ok(item.reason, `${item.what}: 理由が空`);
      assert.ok(item.detail, `${item.what}: 詳細が空（名前だけに潰している）`);
    }
    const ranges = partial.find((p) => p.what === "ranges");
    assert.ok(ranges?.detail.includes("BOOM"), "上流が言ったことをそのまま運ぶ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("走り終えた取得は、あとから来た要求の待ち相手にならない", async () => {
  // 走っている取得の同一性を検めずに片づけると、別の取得を消したり、
  // 済んだものを待ち続けたりする。
  const { fetch, pending } = stubFetch();
  const store = new GraphStore(fetch);
  const first = store.refresh("/w", "/w/a", "/p", OPTIONS);
  await Promise.resolve();
  await settleLast(pending);
  await first;

  // 済んだあとの要求は、待たずにすぐ走る。
  const second = store.refresh("/w", "/w/b", "/p", OPTIONS);
  await Promise.resolve();
  assert.equal(pending.length, 2, "済んだ取得を待ち続けている");
  await settleLast(pending);
  assert.equal((await second).snapshot?.docsRoot, "/w/b");
});
