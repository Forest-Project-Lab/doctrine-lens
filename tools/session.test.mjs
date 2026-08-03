// `src/session.ts` を、編集器を起こさずに走らせて検める。
//
// **この層には単体試験が一度も届いていなかった。** `session.ts` は `vscode` を
// 取り込むので `tsconfig.test.json` の外に在り、`out/` にも組まれない。
// そこに「木を切り替えた直後、前の木の地図が配られる」欠陥が住んでいた
// （`CHANGE-028`。独立の走査が実測で踏んだ）。
//
// 手は写しの門（`tools/preview-webview.mjs`）と同じである——**esbuild で束ね、
// 編集器の面だけを偽物へ差し替える。** 偽物は `tools/fake/` に置く。
// 束ねる元は `src/` の実物なので、実装を直せばここも一緒に動く。
//
//   node --test tools/session.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");

let bundleDir;
let LensSession;
let control;
let state;

before(async () => {
  const { build } = await import(join(PROJECT, "node_modules", "esbuild", "lib", "main.js"));
  bundleDir = mkdtempSync(join(tmpdir(), "doctrine-lens-session-"));
  const entry = join(bundleDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export { LensSession } from ${JSON.stringify(join(PROJECT, "src", "session.ts"))};`,
      `export { control } from ${JSON.stringify(join(HERE, "fake", "graph-store.mjs"))};`,
      `export { state } from ${JSON.stringify(join(HERE, "fake", "vscode.mjs"))};`,
    ].join("\n"),
  );
  const outfile = join(bundleDir, "bundle.mjs");
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
    plugins: [
      {
        name: "編集器と取得を偽物へ差し替える",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({ path: join(HERE, "fake", "vscode.mjs") }));
          b.onResolve({ filter: /doctrine\/graph\.js$/ }, () => ({
            path: join(HERE, "fake", "graph-store.mjs"),
          }));
          b.onResolve({ filter: /doctrine\/locate\.js$/ }, () => ({
            path: join(HERE, "fake", "locate.mjs"),
          }));
        },
      },
    ],
  });
  ({ LensSession, control, state } = await import(`file://${outfile}`));
});

after(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

/** 覚えの入れ物。編集器の Memento の面だけ。 */
function mementoOf(seed = {}) {
  const memory = new Map(Object.entries(seed));
  return {
    memory,
    get: (k, d) => (memory.has(k) ? memory.get(k) : d),
    update: async (k, v) => {
      memory.set(k, v);
    },
  };
}

/** その木らしい取得の結果。id も範囲も木ごとに違う。 */
function snapshotOf(name) {
  const id = `${name.toUpperCase()}-001`;
  return {
    docsRoot: `/w/${name}/doctrine_docs`,
    graph: { nodes: [{ id, path: "a.md" }], edges: [] },
    ranges: [{ id, path: `src/${name}.ts`, begin_line: 1, end_line: 9 }],
    findings: [{ doc_id: id, severity: "error", message: name, refs: [] }],
    checksRun: ["c1"],
    registry: { types: [], currentStatuses: ["current"], allStatuses: [] },
    glossary: new Map(),
    docMeta: new Map(),
    reverseOrphans: [],
  };
}

test("木を切り替えた直後、前の木の地図と範囲を配らない", async () => {
  // **実測で配っていた**（CHANGE-028）。`#forget()` が `#store` は捨てるのに
  // `#state.snapshot` に触れず、成功の経路だけが `EMPTY_STATE` を撒いていなかった。
  // 窓は上流の CLI 五〜六本ぶん（この木で実測 2 秒前後）。その窓のあいだ、
  // 新しい木のファイルの行に**前の木の id** が起点として当たった。
  state.folders = ["/w/alpha", "/w/beta"];
  const memento = mementoOf({ "doctrineLens.chosenFolder": "/w/alpha" });
  const session = new LensSession(memento);
  try {
    control.handler = async () => ({ snapshot: snapshotOf("alpha"), failure: null, partial: [] });
    await session.refresh(true);
    assert.equal(session.state.snapshot?.docsRoot, "/w/alpha/doctrine_docs", "alpha が着地していない");

    // beta へ切り替える。取得はまだ着地させない。
    let landBeta;
    control.handler = () =>
      new Promise((resolve) => {
        landBeta = resolve;
      });
    const switching = session.choose("/w/beta");
    await new Promise((r) => setImmediate(r));

    const mid = session.state;
    assert.equal(mid.candidate?.folder, "/w/beta", "候補が切り替わっていない");
    assert.equal(
      mid.snapshot,
      null,
      `切り替えの途中で前の木の地図が配られている（${mid.snapshot?.docsRoot}）`,
    );

    landBeta({ snapshot: snapshotOf("beta"), failure: null, partial: [] });
    await switching;
    assert.equal(session.state.snapshot?.docsRoot, "/w/beta/doctrine_docs", "beta が着地していない");
  } finally {
    session.dispose();
  }
});

test("切り替えた先の取得が失敗しても、前の木の地図を残さない", async () => {
  // 失敗の経路はもともと EMPTY_STATE を撒いていた。**それを凍らせる**——
  // 成功の側だけを直したときに、失敗の側が崩れていないことを見る。
  state.folders = ["/w/alpha", "/w/beta"];
  const memento = mementoOf({ "doctrineLens.chosenFolder": "/w/alpha" });
  const session = new LensSession(memento);
  try {
    control.handler = async () => ({ snapshot: snapshotOf("alpha"), failure: null, partial: [] });
    await session.refresh(true);
    assert.ok(session.state.snapshot, "alpha が着地していない");

    control.handler = async () => ({
      snapshot: null,
      failure: { reason: "timeout", detail: "x" },
      partial: [],
    });
    await session.choose("/w/beta");
    assert.equal(session.state.snapshot, null, "失敗のあとに前の木の地図が残っている");
  } finally {
    session.dispose();
  }
});
