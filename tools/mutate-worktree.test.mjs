// 隔離木の作成・排他・後始末を検める（SPEC-008 / TEST-008）。
//
// なぜ要るか: 以前この道具は利用者の作業木を直接書き換え、SIGKILL や並行実行で木と
// 判定の両方を汚した。守りたい性質は一つ —— **どの経路でも作業木が一バイトも動かない**。
// 字面のレビューでは守れないので、実物の git リポジトリを立てて実測する。
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireLock,
  createIsolated,
  pruneOrphans,
  removeIsolated,
  treeState,
} from "./mutate-worktree.mjs";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/** 一件の commit を持つ実物のリポジトリを立てる。 */
const withRepo = (body) => {
  const root = mkdtempSync(join(tmpdir(), "mutate-worktree-fixture-"));
  try {
    git(root, ["init", "--quiet", "-b", "main"]);
    git(root, ["config", "user.email", "t@example.invalid"]);
    git(root, ["config", "user.name", "t"]);
    writeFileSync(join(root, "src.txt"), "original\n", "utf8");
    git(root, ["add", "-A"]);
    git(root, ["commit", "--quiet", "-m", "first"]);
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("隔離木は作業木の外に立ち、対象 commit の中身を持つ", () => {
  withRepo((root) => {
    const commit = git(root, ["rev-parse", "HEAD"]);
    const wt = createIsolated(root, commit);
    try {
      assert.ok(!wt.startsWith(root), "隔離木が作業木の中に立っている");
      assert.equal(readFileSync(join(wt, "src.txt"), "utf8"), "original\n");
    } finally {
      removeIsolated(root, wt);
    }
  });
});

// これが直した欠陥そのものである。以前は作業木のソースを直接書き換えていた。
test("隔離木を潰しても、作業木は一バイトも動かない", () => {
  withRepo((root) => {
    const before = treeState(root);
    const wt = createIsolated(root, git(root, ["rev-parse", "HEAD"]));
    try {
      writeFileSync(join(wt, "src.txt"), "潰した\n", "utf8");
      assert.equal(readFileSync(join(root, "src.txt"), "utf8"), "original\n");
      assert.equal(treeState(root), before);
    } finally {
      removeIsolated(root, wt);
    }
    assert.equal(treeState(root), before, "片づけの後も作業木は不変");
  });
});

test("隔離木を消すと、実体も git の登録も残らない", () => {
  withRepo((root) => {
    const wt = createIsolated(root, git(root, ["rev-parse", "HEAD"]));
    removeIsolated(root, wt);
    assert.ok(!existsSync(wt), "実体が残っている");
    assert.ok(!git(root, ["worktree", "list", "--porcelain"]).includes(wt), "登録が残っている");
  });
});

test("走行が二つ重なると、後の一つが潰しの前に失敗する", () => {
  withRepo((root) => {
    const first = acquireLock(root);
    try {
      assert.throws(() => acquireLock(root), /同時に二つは走らせない/);
    } finally {
      first.release();
    }
    // 解いた後は取れる。錠が残り続けない。
    acquireLock(root).release();
  });
});

test("死んだ走行が残した錠は引き継ぐ（一度の SIGKILL で以後ずっと走れなくならない）", () => {
  withRepo((root) => {
    const held = acquireLock(root);
    // 生きていない pid を書き込んで「死んだ走行の錠」を作る。
    writeFileSync(join(held.path, "pid"), "2147483646", "utf8");
    const taken = acquireLock(root);
    assert.equal(readFileSync(join(taken.path, "pid"), "utf8").trim(), String(process.pid));
    taken.release();
  });
});

test("孤児の片づけは、利用者が自分で作った worktree に触らない", () => {
  withRepo((root) => {
    const mine = join(tmpdir(), `user-worktree-${process.pid}`);
    rmSync(mine, { recursive: true, force: true });
    git(root, ["worktree", "add", "--detach", "--quiet", mine, "HEAD"]);
    try {
      pruneOrphans(root);
      assert.ok(existsSync(mine), "利用者の worktree を消した");
      assert.ok(git(root, ["worktree", "list", "--porcelain"]).includes(mine));
    } finally {
      removeIsolated(root, mine);
    }
  });
});

test("孤児の片づけは、いま走っている自分の隔離木に触らない", () => {
  withRepo((root) => {
    const wt = createIsolated(root, git(root, ["rev-parse", "HEAD"]));
    try {
      pruneOrphans(root);
      assert.ok(existsSync(wt), "自分の隔離木を消した");
    } finally {
      removeIsolated(root, wt);
    }
  });
});

test("作業木の追跡下が動けば treeState が変わる", () => {
  withRepo((root) => {
    const before = treeState(root);
    writeFileSync(join(root, "src.txt"), "触った\n", "utf8");
    assert.notEqual(treeState(root), before);
  });
});
