// TEST-001 — 橋渡しの受入。番号は SPEC-001 の受入基準に対応する。
// 受入基準 7〜10 は paths.test.ts と cadence.test.ts が受け持つ。
//
// 2・6 は上流の CLI を実際に起こす。python か doctrine プラグインが無い環境では
// その二つを飛ばす（無い環境で赤くしても、直せる欠陥を指していない）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import type { RunOptions } from "../doctrine/cli.js";
import { GraphStore, fetchSnapshot } from "../doctrine/graph.js";
import { locateDocsRoot, locatePluginRoot } from "../doctrine/locate.js";
import { fetchRegistry } from "../doctrine/registry.js";
import type { Graph } from "../doctrine/model.js";
import { buildConsequence } from "../model/consequence.js";

const PROJECT = resolve(__dirname, "..", "..");

const options = (cwd: string): RunOptions => ({
  pythonPath: "python3",
  timeoutMs: 30000,
  cwd,
});

function pluginRootOrSkip(): string | null {
  return locatePluginRoot(PROJECT);
}

test("1. 統治木を持たないフォルダでは不在が返り、例外が出ない", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-"));
  try {
    assert.equal(locateDocsRoot(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1b. _system を持たない素の docs は統治木として認めない", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-"));
  try {
    mkdirSync(join(dir, "docs"));
    assert.equal(locateDocsRoot(dir), null, "他所の土地を統治木にしない");
    mkdirSync(join(dir, "docs", "_system"));
    assert.equal(locateDocsRoot(dir), join(dir, "docs"), "_system があれば認める");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1c. このプロジェクトの統治木は doctrine_docs に解決される", () => {
  assert.equal(locateDocsRoot(PROJECT), join(PROJECT, "doctrine_docs"));
});

test("2. 統治木があれば nodes と edges を持つ値が返る", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const outcome = await fetchSnapshot(PROJECT, docsRoot, pluginRoot, options(PROJECT));
  assert.ok(outcome.ok, `取得に失敗した: ${outcome.ok ? "" : outcome.detail}`);
  assert.ok(Array.isArray(outcome.value.snapshot.graph.nodes));
  assert.ok(Array.isArray(outcome.value.snapshot.graph.edges));
  assert.ok(outcome.value.snapshot.graph.nodes.length > 0, "この統治木は空ではない");

  // 取ったものが実際に明細へ組めることまで見る。
  const consequence = buildConsequence(outcome.value.snapshot.graph, "SPEC-001");
  assert.ok(consequence.origin, "起点が引ける");
});

test("3. 上流が項を増やしても既知の項の値が変わらない", () => {
  const withExtra: Graph = {
    nodes: [
      {
        id: "SPEC-001",
        path: "lens/spec/SPEC-001.md",
        type: "SPEC",
        domain: "lens",
        status: "current",
        depends_on: [],
        impacts: [],
        canonical_for: [],
        // 上流が将来足すかもしれない項。
        future_field: { nested: true },
        another: 42,
      },
    ],
    edges: [{ src: "SPEC-001", dst: "SPEC-001", field: "depends_on", kind: "intra_domain", extra: "x" }],
  };
  const consequence = buildConsequence(withExtra, "SPEC-001");
  assert.equal(consequence.origin?.id, "SPEC-001");
  assert.equal(consequence.origin?.domain, "lens", "既知の項の値が変わらない");
});

test("4. 終了コードが 0 でなくても直前に成功した結果が保たれる", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const store = new GraphStore();
  assert.equal(store.snapshot, null, "一度も成功していなければ空");

  const first = await store.refresh(PROJECT, docsRoot, pluginRoot, options(PROJECT));
  assert.ok(first.snapshot, "一度目は成功する");
  assert.equal(first.failure, null);
  const kept = first.snapshot;

  // 存在しない統治木を指すと、上流は 0 でない終了コードで終わる。
  const second = await store.refresh(
    PROJECT,
    join(PROJECT, "存在しない木"),
    pluginRoot,
    options(PROJECT),
  );
  assert.ok(second.failure, "二度目は失敗する");
  assert.equal(second.snapshot, kept, "直前に成功した結果が保たれる");
  assert.equal(store.snapshot, kept, "入れ物の中身も消えない");
});

test("5. 実装のどこにも型の一覧・status の語彙が書かれていない", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const registryOutcome = await fetchRegistry(pluginRoot, options(PROJECT));
  assert.ok(registryOutcome.ok, "登録簿を読めること");
  const { types, allStatuses } = registryOutcome.value;

  const vocabulary = new Set<string>([...types, ...allStatuses]);
  const offenders: string[] = [];

  for (const file of sourceFiles(join(PROJECT, "src"))) {
    // 試験と見本は対象外。禁じているのは実装が語彙を持つことである。
    if (file.includes(`${"/"}test${"/"}`)) continue;
    const text = stripComments(readFileSync(file, "utf8"));
    for (const literal of stringLiterals(text)) {
      if (vocabulary.has(literal)) {
        offenders.push(`${file.slice(PROJECT.length + 1)}: "${literal}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `上流の語彙が実装に写されている（REQ-003 の破れ）:\n${offenders.join("\n")}`,
  );
});

// 印の綴りは連結で組み立てる。原文にそのまま書くと、上流の「打ったつもりの印」の
// 照合がこの試験自身に反応する（上流の _tracescan が同じ規律を採っている）。
const BEGIN_MARK = "doctrine" + ":" + "begin";

test("実装のファイルが追跡の走査から静かに落ちない", () => {
  // NUL を一つ含むだけで、上流の走査も grep もそのファイルをバイナリと見なし、
  // 印を打ってあっても黙って対象から外れる。実際に起きた（src/model/depth.ts）。
  // 落ちたことは何も告げないので、ここで字面から止める。
  const binary: string[] = [];
  const unmarked: string[] = [];
  for (const file of sourceFiles(join(PROJECT, "src"))) {
    const rel = file.slice(PROJECT.length + 1);
    const bytes = readFileSync(file);
    if (bytes.includes(0)) binary.push(rel);
    // model と doctrine の実装は、対応する仕様へ印で結んである。
    if (/^src\/(model|doctrine)\//.test(rel) && !bytes.includes(Buffer.from(BEGIN_MARK))) {
      unmarked.push(rel);
    }
  }
  assert.deepEqual(binary, [], `NUL を含む実装がある: ${binary.join(", ")}`);
  assert.deepEqual(unmarked, [], `仕様へ印で結んでいない実装がある: ${unmarked.join(", ")}`);
});

test("6. 登録簿の取得が上流と同じ型の並びを返す", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const outcome = await fetchRegistry(pluginRoot, options(PROJECT));
  assert.ok(outcome.ok);

  // 上流の登録簿の原文から並びを取り出して突き合わせる。
  const source = readFileSync(join(pluginRoot, "scripts", "_registry.py"), "utf8");
  const block = source.slice(source.indexOf("TYPES = ("));
  const literal = block.slice(0, block.indexOf(")"));
  const upstream = [...literal.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]);

  assert.deepEqual(outcome.value.types, upstream, "型の並びが上流と一致する");
  assert.ok(outcome.value.currentStatuses.length > 0);
  assert.ok(outcome.value.allStatuses.length > 0);
});

test("timeout を過ぎた取得は打ち切られ、例外にならない", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);
  const outcome = await fetchSnapshot(PROJECT, docsRoot, pluginRoot, {
    pythonPath: "python3",
    timeoutMs: 1,
    cwd: PROJECT,
  });
  // 1 ミリ秒で終わることは無いが、機械が速ければ成功しうる。どちらでも例外は出ない。
  if (!outcome.ok) assert.equal(outcome.reason, "timeout");
});

test("python が無ければ起動の失敗として返る", async () => {
  const outcome = await fetchSnapshot(PROJECT, "/tmp", "/tmp", {
    pythonPath: "この名前の実行ファイルは無い",
    timeoutMs: 5000,
    cwd: PROJECT,
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "spawn-failed");
});

// --- 走査の道具 ----------------------------------------------------------

test("006-26. 上流から取って使わない値を、登録簿の写しに残さない", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const outcome = await fetchRegistry(pluginRoot, options(PROJECT));
  assert.ok(outcome.ok, "登録簿を読めること");

  // 取って使わない値は、次に読む人に「どこかで効いている」と読ませる。
  // 実際 `currentStatuses` がそうだった——必要な値が既に手元に在ったのに、
  // 無いものとして設計を始めていた（ADR-021 決定 4）。
  //
  // **使い手は拡張機能とは限らない。** `types` と `allStatuses` は門だけが使う
  // （実装が語彙を持っていないことを、上流の語彙そのもので検める）。門も使い手である。
  //
  // 数えないのは三箇所だけ。項の宣言（`model.ts`）、問い合わせ（`registry.ts`）、
  // 偽の登録簿（`fixture.ts`）である。**偽物は使い手ではない**——
  // 見本にだけ載っている項は、誰も読まないまま毎回の取得で運ばれ続ける。
  //
  // **注釈は使い手ではない。** 落とさずに数えると、この試験の注釈が
  // `types` と `allStatuses` と `currentStatuses` を名指しているせいで、
  // 実装が一つも読んでいなくても「使っている」と読める。
  // 実際そうなっていた（独立の走査が挙げた）。**門が自分の注釈で通っていた。**
  const 出所 = new Set(["doctrine/model.ts", "doctrine/registry.ts", "test/fixture.ts"]);
  const 使い手 = sourceFiles(join(PROJECT, "src")).filter(
    (f) => ![...出所].some((s) => f.endsWith(s)),
  );
  const 字面 = 使い手.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");

  const 孤児 = Object.keys(outcome.value).filter((項) => !字面.includes(項));
  assert.deepEqual(孤児, [], "取っておいて誰も使っていない項が在る");
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * 注釈を落とす。語彙の走査が説明文に反応しないようにするため。
 *
 * 文字列の中の `//` を注釈と誤らない（誤ると、同じ行のリテラルが走査から落ちる）。
 * 実装は l10n.test.ts と同じ規律である。
 */
function stripComments(text: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (c === quote) {
        quote = "";
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/** 文字列リテラルの中身を集める。 */
function stringLiterals(text: string): string[] {
  const out: string[] = [];
  // 逃げを含むリテラルも見る。飛ばすと、上流の語彙を写した文字列が
  // バックスラッシュを一つ含むだけで走査から落ちる。
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
    const value = m[1] ?? m[2];
    if (value) out.push(value);
  }
  return out;
}
