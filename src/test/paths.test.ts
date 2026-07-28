// TEST-001 の追補 — 経路の正規化と、作業フォルダが複数のときの選び方。
//
// Windows で走らせられないので、環境の別は引数で与えて両方を確かめる。
// 「実機で踏んでいない」を「引数で踏む」に置き換える。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forCompare,
  isInside,
  toPosix,
  toRelative,
} from "../model/paths.js";
import { chooseCandidate, collectCandidates } from "../model/workspace.js";
import { locateDocsRoot } from "../doctrine/locate.js";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

const WIN = true;
const POSIX = false;

test("経路の区切りを / に揃え、末尾の / を落とす", () => {
  assert.equal(toPosix("C:\\work\\repo"), "C:/work/repo");
  assert.equal(toPosix("/work/repo/"), "/work/repo");
  assert.equal(toPosix("/work/repo///"), "/work/repo");
  assert.equal(toPosix("a\\b\\c"), "a/b/c");
});

test("Windows では大小文字を区別せず、他では区別する", () => {
  assert.equal(forCompare("C:\\Work\\Repo", WIN), "c:/work/repo");
  assert.equal(forCompare("/Work/Repo", POSIX), "/Work/Repo");
});

test("相対への変換は Windows の区切りと大小文字を吸収する", () => {
  assert.equal(
    toRelative("C:\\work\\repo", "C:\\work\\repo\\src\\model\\lens.ts", WIN),
    "src/model/lens.ts",
  );
  // ドライブ文字の大小が違っても同じ場所である。
  assert.equal(
    toRelative("c:\\work\\repo", "C:\\Work\\Repo\\src\\a.ts", WIN),
    "src/a.ts",
    "大小が違っても中と見なす",
  );
  // 返す値は元の大小文字を保つ。
  assert.equal(
    toRelative("C:\\work\\repo", "C:\\work\\repo\\Src\\Model.ts", WIN),
    "Src/Model.ts",
  );
});

test("大小文字を区別する環境では、違う大小は別の場所である", () => {
  assert.equal(toRelative("/work/repo", "/work/repo/src/a.ts", POSIX), "src/a.ts");
  assert.equal(toRelative("/work/Repo", "/work/repo/src/a.ts", POSIX), null);
});

test("作業フォルダの外・根そのものは相対にしない", () => {
  assert.equal(toRelative("/work/repo", "/work/other/a.ts", POSIX), null);
  assert.equal(toRelative("/work/repo", "/work/repo", POSIX), null, "根そのもの");
  // 前置きが同じだけの別フォルダを中と誤らない。
  assert.equal(toRelative("/work/repo", "/work/repo2/a.ts", POSIX), null);
});

test("isInside は根そのものも中と見なす", () => {
  assert.equal(isInside("/work/repo", "/work/repo", POSIX), true);
  assert.equal(isInside("/work/repo", "/work/repo/a.md", POSIX), true);
  assert.equal(isInside("/work/repo", "/work/repo2/a.md", POSIX), false);
  assert.equal(isInside("C:\\work\\repo", "c:\\WORK\\repo\\a.md", WIN), true);
});

// --- 作業フォルダの選び方（ADR-006） --------------------------------------

const resolveAll = (folder: string): string | null => `${folder}/doctrine_docs`;
const resolveNone = (): string | null => null;

test("統治木を持つフォルダだけを候補にし、整列して返す", () => {
  const found = collectCandidates(
    ["/work/zeta", "/work/alpha"],
    (f) => (f === "/work/alpha" ? `${f}/doctrine_docs` : null),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.folder, "/work/alpha");
  assert.equal(found[0]?.docsRoot, "/work/alpha/doctrine_docs");
  assert.equal(found[0]?.label, "alpha");

  const both = collectCandidates(["/work/zeta", "/work/alpha"], resolveAll);
  assert.deepEqual(both.map((c) => c.folder), ["/work/alpha", "/work/zeta"], "整列する");
});

test("二つ目のフォルダにしか統治木が無くても見つかる", () => {
  const found = collectCandidates(
    ["/work/app", "/work/docs-only"],
    (f) => (f === "/work/docs-only" ? `${f}/doctrine_docs` : null),
  );
  assert.equal(found.length, 1, "一つ目だけを見ない");
  assert.equal(found[0]?.folder, "/work/docs-only");
});

test("覚えたフォルダを優先し、無ければ整列順の先頭", () => {
  const candidates = collectCandidates(["/work/zeta", "/work/alpha"], resolveAll);
  assert.equal(chooseCandidate(candidates, undefined)?.folder, "/work/alpha");
  assert.equal(chooseCandidate(candidates, "/work/zeta")?.folder, "/work/zeta");
});

test("覚えたフォルダが消えていたら黙って先頭へ落ちる", () => {
  const candidates = collectCandidates(["/work/zeta", "/work/alpha"], resolveAll);
  assert.equal(
    chooseCandidate(candidates, "/work/gone")?.folder,
    "/work/alpha",
    "閉じただけで何も出なくならない",
  );
});

test("候補が無ければ null", () => {
  assert.equal(chooseCandidate([], "/work/alpha"), null);
  assert.deepEqual(collectCandidates(["/work/a"], resolveNone), []);
});

// --- docsRoot の封じ込め（ADR-010） --------------------------------------

test("docsRoot は作業フォルダの外を指せない", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "doctrine-lens-root-")));
  try {
    const ws = join(dir, "ws");
    mkdirSync(join(ws, "doctrine_docs"), { recursive: true });
    mkdirSync(join(dir, "outside", "doctrine_docs"), { recursive: true });

    assert.equal(locateDocsRoot(ws), join(ws, "doctrine_docs"), "既定は根直下の木");
    for (const escape of [
      "../outside/doctrine_docs",
      "doctrine_docs/../../outside/doctrine_docs",
      join(dir, "outside", "doctrine_docs"),
      "..\\outside\\doctrine_docs",
      ".",
    ]) {
      assert.equal(locateDocsRoot(ws, escape), null, `外を指せてしまう: ${escape}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("symlink で作業フォルダの外へ抜けられない", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "doctrine-lens-link-")));
  try {
    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    mkdirSync(join(dir, "outside", "doctrine_docs"), { recursive: true });
    // 作業フォルダの中から外の木へ張った繋ぎ。字面の前方一致だけでは通ってしまう。
    symlinkSync(join(dir, "outside", "doctrine_docs"), join(ws, "doctrine_docs"), "dir");

    const found = locateDocsRoot(ws);
    if (found !== null) {
      assert.ok(
        resolvePath(realpathSync(found)).startsWith(resolvePath(ws)),
        `実体が作業フォルダの外に在る: ${realpathSync(found)}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
