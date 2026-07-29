// 題名の取得の受入（SPEC-006 の入力「題名」に対応する）。
//
// この層は上流に `title` が無いあいだの継ぎである（Forest-Project-Lab/doctrine#149）。
// 継ぎであっても、**黙って空を返さない**ことだけは厳しく見る。空の表と
// 「題名の無い木」は画面の上で見分けが付かず、実際に一度そうなったためである。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { locatePluginRoot } from "../doctrine/locate.js";
import { displayTitle, fetchDocMeta, type DocMetaIndex } from "../doctrine/titles.js";

const PROJECT = resolve(__dirname, "..", "..");
const OPTIONS = { pythonPath: "python3", timeoutMs: 30000, cwd: PROJECT };

function pluginRootOrSkip(): string | null {
  return locatePluginRoot(PROJECT);
}

/** 見本の統治木を一つ作る。中身は呼び手が決める。 */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-titles-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return dir;
}

const DOC = (id: string, title: string, extra = ""): string =>
  `---\nid: ${id}\ntitle: ${title}\nupdated: 2026-07-29\n${extra}---\n\n本文\n`;

test("題名・更新日・後継を、上流のパーサ越しに取る", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const dir = tree({
    "_system/glossary.md": DOC("GLOSSARY-001", "用語辞書"),
    "lens/spec/SPEC-002.md": DOC("SPEC-002", "古い仕様", "superseded_by: SPEC-006\n"),
  });
  try {
    const outcome = await fetchDocMeta(dir, pluginRoot, OPTIONS);
    assert.ok(outcome.ok, `取れなかった: ${outcome.ok ? "" : outcome.detail}`);
    assert.equal(outcome.value.get("GLOSSARY-001")?.title, "用語辞書");
    assert.equal(outcome.value.get("SPEC-002")?.updated, "2026-07-29");
    assert.equal(outcome.value.get("SPEC-002")?.supersededBy, "SPEC-006");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("id を持たない .md は拾わない（何が文書かの規則を持たない）", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const dir = tree({
    "README.md": "# ただの読み物\n",
    "lens/spec/SPEC-001.md": DOC("SPEC-001", "本物"),
  });
  try {
    const outcome = await fetchDocMeta(dir, pluginRoot, OPTIONS);
    assert.ok(outcome.ok);
    assert.deepEqual([...outcome.value.keys()], ["SPEC-001"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("根が無ければ失敗として返る（空の表に化けない）", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const outcome = await fetchDocMeta(join(tmpdir(), "この木は無い"), pluginRoot, OPTIONS);
  assert.equal(outcome.ok, false, "空の表を成功として返してはならない");
});

test("相対パスを渡しても、空の表を成功として返さない", async (t) => {
  // 子プロセスの作業フォルダは私有の一時場所なので、相対パスは必ず外れる。
  // 外れたことが「題名の無い木」に化けると、画面はただ id を並べて何も言わない。
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const outcome = await fetchDocMeta("doctrine_docs", pluginRoot, OPTIONS);
  assert.equal(outcome.ok, false);
});

test("解析が全件で落ちたら、失敗として返る（黙って空の表を返さない）", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  // 上流のパーサが読めないバイト列。全件がこれなら、木の問題ではなく呼び方の問題である。
  // 握り潰して空の表を返すと、画面は id を並べるだけで、なぜかを言えない。
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-titles-"));
  try {
    writeFileSync(join(dir, "a.md"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    writeFileSync(join(dir, "b.md"), Buffer.from([0xff, 0xfe, 0x00, 0x42]));
    const outcome = await fetchDocMeta(dir, pluginRoot, OPTIONS);
    assert.equal(outcome.ok, false, "0/N を成功として返してはならない");
    if (!outcome.ok) {
      assert.match(outcome.detail, /parsed 0 of 2/, `理由が届いていない: ${outcome.detail}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("一部だけ壊れていても、読めたものは返る（全部か無かにしない）", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-titles-"));
  try {
    writeFileSync(join(dir, "good.md"), DOC("SPEC-001", "読めるほう"), "utf8");
    writeFileSync(join(dir, "bad.md"), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    const outcome = await fetchDocMeta(dir, pluginRoot, OPTIONS);
    assert.ok(outcome.ok, "一件でも読めれば成功である");
    assert.equal(outcome.value.get("SPEC-001")?.title, "読めるほう");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("id を持つ文書がまだ無いだけの木は、異常ではない", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  // frontmatter を持たない .md しか無い木。上流は解析できるが id を返さない。
  // 「解析が落ちて 0 件」とは別の事実である。一つの合図に畳むと、
  // まだ id を書いていないだけの木を「壊れている」と告げることになる。
  const dir = tree({ "a.md": "本文だけ\n" });
  try {
    const outcome = await fetchDocMeta(dir, pluginRoot, OPTIONS);
    assert.ok(outcome.ok, "id を持つ文書が無いことは異常ではない");
    assert.equal(outcome.value.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("このプロジェクトの統治木から、全文書ぶんの題名が取れる", async (t) => {
  const pluginRoot = pluginRootOrSkip();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const outcome = await fetchDocMeta(join(PROJECT, "doctrine_docs"), pluginRoot, OPTIONS);
  assert.ok(outcome.ok, `取れなかった: ${outcome.ok ? "" : outcome.detail}`);
  assert.ok(outcome.value.size > 30, `文書が少なすぎる（${outcome.value.size} 件）`);
  const untitled = [...outcome.value.entries()].filter(([, m]) => !m.title).map(([id]) => id);
  assert.deepEqual(untitled, [], "題名を持たない文書がある");
});

test("python が無ければ起動の失敗として返る", async () => {
  const outcome = await fetchDocMeta("/tmp", "/tmp", {
    pythonPath: "この名前の実行ファイルは無い",
    timeoutMs: 5000,
    cwd: PROJECT,
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "spawn-failed");
});

test("題名が無ければ id へ落ちる（落ちたことは脚注が言う）", () => {
  const meta: DocMetaIndex = new Map([
    ["A", { title: "在る題", updated: "", supersededBy: "" }],
    ["B", { title: "", updated: "", supersededBy: "" }],
  ]);
  assert.equal(displayTitle("A", meta), "在る題");
  assert.equal(displayTitle("B", meta), "B", "空の題名で主文を空にしない");
  assert.equal(displayTitle("知らない", meta), "知らない");
});
