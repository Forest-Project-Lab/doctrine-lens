// 潰しを当てる隔離木の作成・排他・後始末（SPEC-008 / ADR-015）。
//
// なぜ要るか: 以前はこの道具が利用者の作業木のソースを直接書き換えていた。SIGKILL・
// 端末の切断・並行実行・通常の編集との競合で、利用者の木と検査結果の両方が汚れた
// （実測が mutate-check.mjs のコメントと CHANGE-004 に残っている）。戻し方の記録は
// 事故のあとの回復手段でしかなく、破壊的な書き込み自体は防がない。だから書き込む先を
// 捨てられる木へ移す。
//
// 標準ライブラリだけで動く。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// doctrine:begin SPEC-008
const PREFIX = "doctrine-lens-mutate-";

const git = (repoRoot, args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }).trim();

const keyOf = (repoRoot) => createHash("sha256").update(repoRoot).digest("hex").slice(0, 12);

/** 作業木の状態の指紋。走行の前後で一致することを確かめるために取る。 */
export const treeState = (repoRoot) => {
  // HEAD と、追跡下の差分（index と作業木の両方）を一つの文字列にする。
  // どのファイルが一バイトでも動けば、この文字列が変わる。
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  return `${head}\n${createHash("sha256").update(status).digest("hex")}`;
};

/**
 * リポジトリ単位の排他ロック。二重の走行を潰しの前に止める。
 *
 * ディレクトリの作成は原子的なので、これを錠にする。中に pid を書き、死んだ走行が
 * 残した錠は引き継ぐ（さもないと SIGKILL の一回で以後ずっと走れなくなる）。
 */
export const acquireLock = (repoRoot) => {
  const path = join(tmpdir(), `${PREFIX}${keyOf(repoRoot)}.lock`);
  const claim = () => {
    mkdirSync(path); // 既に在れば EEXIST で失敗する。これが錠である。
    writeFileSync(join(path, "pid"), String(process.pid), "utf8");
    return { path, release: () => rmSync(path, { recursive: true, force: true }) };
  };
  try {
    return claim();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const holder = Number(readFileSync(join(path, "pid"), "utf8").trim());
  if (Number.isInteger(holder) && alive(holder)) {
    throw new Error(
      `別の潰しの走行が動いている（pid ${holder}）。同時に二つは走らせない。` +
        `本当に居ないなら ${path} を消すこと。`,
    );
  }
  // 死んだ走行の錠。引き継ぐ。
  rmSync(path, { recursive: true, force: true });
  return claim();
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // 権限が無いだけなら生きている。
  }
};

/**
 * 対象の commit から detached の隔離木を作る。
 *
 * 利用者の作業木へは書かない。`node_modules` だけは繋いで読む（全複製も再取得もしない）。
 */
export const createIsolated = (repoRoot, commit) => {
  const path = join(tmpdir(), `${PREFIX}${keyOf(repoRoot)}-${process.pid}`);
  rmSync(path, { recursive: true, force: true });
  git(repoRoot, ["worktree", "add", "--detach", "--quiet", path, commit]);
  const deps = join(repoRoot, "node_modules");
  if (existsSync(deps)) symlinkSync(deps, join(path, "node_modules"), "dir");
  return path;
};

/** 隔離木を消す。git の登録も外す。 */
export const removeIsolated = (repoRoot, path) => {
  try {
    git(repoRoot, ["worktree", "remove", "--force", path]);
  } catch {
    // 登録から外せなくても、実体は消してから prune に委ねる。
    rmSync(path, { recursive: true, force: true });
    try {
      git(repoRoot, ["worktree", "prune"]);
    } catch {
      /* prune も駄目なら次回起動が拾う */
    }
  }
};

/**
 * 前の走行が SIGKILL で残した孤児の隔離木だけを片づける。
 *
 * 利用者が自分で作った worktree には触らない。片づける条件は三つ揃ったときだけ —— 一時
 * ディレクトリの下に在り、この道具の名前で始まり、名前に埋めた pid が生きていないこと。
 */
export const pruneOrphans = (repoRoot) => {
  const mine = new RegExp(`^${PREFIX}${keyOf(repoRoot)}-(\\d+)$`);
  const cleaned = [];
  let listing;
  try {
    listing = git(repoRoot, ["worktree", "list", "--porcelain"]);
  } catch {
    return cleaned;
  }
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length).trim();
    const name = path.split("/").pop() ?? "";
    const match = mine.exec(name);
    if (!match) continue;
    if (!path.startsWith(tmpdir())) continue;
    if (Number(match[1]) === process.pid) continue;
    if (alive(Number(match[1]))) continue;
    removeIsolated(repoRoot, path);
    cleaned.push(path);
  }
  return cleaned;
};
// doctrine:end SPEC-008
