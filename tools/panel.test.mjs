// `src/panel/lensPanel.ts` を、編集器を起こさずに走らせて検める。
//
// **この層にも単体試験が一度も届いていなかった。** `lensPanel.ts` は `vscode` を
// 取り込むので `tsconfig.test.json` の外に在る。そこに
// 「明細が焦点を取ると起点が消える」欠陥が住んでいた（`CHANGE-028`）。
//
// 手は `tools/session.test.mjs` と同じ——esbuild で束ね、編集器の面だけを
// `tools/fake/vscode.mjs` へ差し替える。束ねる元は `src/` の実物である。
//
//   node --test tools/panel.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");

let bundleDir;
let LensPanel;
let hooks;
let fakeWindow;

before(async () => {
  const { build } = await import(join(PROJECT, "node_modules", "esbuild", "lib", "main.js"));
  bundleDir = mkdtempSync(join(tmpdir(), "doctrine-lens-panel-"));
  const entry = join(bundleDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export { LensPanel } from ${JSON.stringify(join(PROJECT, "src", "panel", "lensPanel.ts"))};`,
      `export { hooks, window } from ${JSON.stringify(join(HERE, "fake", "vscode.mjs"))};`,
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
        name: "編集器を偽物へ差し替える",
        setup(b) {
          b.onResolve({ filter: /^vscode$/ }, () => ({ path: join(HERE, "fake", "vscode.mjs") }));
        },
      },
    ],
  });
  const mod = await import(`file://${outfile}`);
  LensPanel = mod.LensPanel;
  hooks = mod.hooks;
  fakeWindow = mod.window;
});

after(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

/** 取得が済んだ状態の、小さな木。 */
function sessionOf() {
  const snapshot = {
    docsRoot: "/w/doctrine_docs",
    graph: {
      nodes: [
        { id: "SPEC-006", path: "spec/SPEC-006.md", type: "SPEC", domain: "lens", status: "current", depends_on: [], impacts: ["TEST-006"], canonical_for: [] },
        { id: "TEST-006", path: "test/TEST-006.md", type: "TEST", domain: "lens", status: "current", depends_on: ["SPEC-006"], impacts: [], canonical_for: [] },
      ],
      edges: [{ src: "TEST-006", dst: "SPEC-006", field: "depends_on", kind: "intra" }],
    },
    ranges: [{ id: "SPEC-006", path: "src/model/consequence.ts", begin_line: 1, end_line: 900 }],
    findings: [],
    checksRun: ["c"],
    registry: { types: ["SPEC"], currentStatuses: ["current"], allStatuses: ["current"] },
    glossary: new Map(),
    docMeta: new Map([
      ["SPEC-006", { title: "帰結の一覧", detail: "" }],
      ["TEST-006", { title: "受入", detail: "" }],
    ]),
    reverseOrphans: [],
  };
  const state = {
    snapshot,
    unavailable: null,
    failure: null,
    partial: [],
    busy: false,
    candidate: { folder: "/w", docsRoot: "/w/doctrine_docs" },
    candidateCount: 1,
    auditAt: new Date("2026-08-03T12:00:00"),
    staleCount: 0,
  };
  return {
    state,
    snapshot,
    onDidChange: () => ({ dispose() {} }),
    toRelativePath: (uri) => (uri.fsPath.startsWith("/w/") ? uri.fsPath.slice(3) : null),
    toUri: () => null,
    refresh: async () => {},
  };
}

const lastView = () => [...hooks.posted].reverse().find((m) => m.kind === "view")?.view;

test("明細が焦点を取っても、起点が消えない", () => {
  // **実測で消えていた**（CHANGE-028）。起点を `activeTextEditor` 一本から決めていたので、
  // 明細へ焦点が移った瞬間に `undefined` になり、`buildConsequence(graph, null)` が
  // 起点なしの帰結を返し、画面は明細を丸ごと捨てて断り文へ差し替えた。
  // **脚注の行き先も循環の行も、押すために焦点を取ると押す対象ごと消えた。**
  hooks.posted.length = 0;
  const session = sessionOf();
  LensPanel.show({ extensionUri: { fsPath: "/ext", scheme: "file" } }, session);

  // 1) 文章編集器に焦点が在り、印の中にカーソルが在る。
  fakeWindow.activeTextEditor = {
    document: {
      uri: { fsPath: "/w/src/model/consequence.ts", scheme: "file" },
      fileName: "/w/src/model/consequence.ts",
      isClosed: false,
    },
    selection: { active: { line: 20 } },
  };
  hooks.selection[0]?.();
  const before = lastView();
  assert.ok(before?.origin, "編集器に焦点が在るのに起点が出ていない");
  assert.equal(before.origin.title, "帰結の一覧", "起点の題名が違う");

  // 2) 明細が焦点を取る。編集器の側では activeTextEditor が undefined になる。
  fakeWindow.activeTextEditor = undefined;
  hooks.activeEditor[0]?.(undefined);
  const after = lastView();
  assert.ok(
    after?.origin,
    `明細が焦点を取った瞬間に起点が消えた（emptyReason=${JSON.stringify(after?.emptyReason)}）`,
  );
  assert.equal(after.origin.title, "帰結の一覧", "焦点が外れただけで起点が変わった");
});

test("覚えている編集器が閉じられたら、起点として出さない", () => {
  // 覚えるのは焦点の不在を補うためであって、消えた文書を生かすためではない。
  hooks.posted.length = 0;
  const session = sessionOf();
  LensPanel.show({ extensionUri: { fsPath: "/ext", scheme: "file" } }, session);

  const doc = {
    uri: { fsPath: "/w/src/model/consequence.ts", scheme: "file" },
    fileName: "/w/src/model/consequence.ts",
    isClosed: false,
  };
  fakeWindow.activeTextEditor = { document: doc, selection: { active: { line: 20 } } };
  hooks.selection[0]?.();
  assert.ok(lastView()?.origin, "起点が出ていない");

  doc.isClosed = true;
  fakeWindow.activeTextEditor = undefined;
  hooks.activeEditor[0]?.(undefined);
  assert.equal(lastView()?.origin, null, "閉じられた文書を起点として出している");
});
