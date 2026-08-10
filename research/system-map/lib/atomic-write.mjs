// 成果物を原子的に置き換える。
//
// なぜ要るか: 生成の途中で殺されると、切れた `index.html` や overlay が置き場に残る。
// 残った物は「壊れている」とは名乗らない —— 次に読む者は、それを正しい成果物として
// 読む。CI の差分検査は「汚れた木」と報告するだけで、**壊れたのか作業中なのかを
// 言えない。**
//
// 手: 同じ置き場(= 同じファイルシステム)へ書いてから名前を付け替える。付け替えは
// 原子的なので、どの瞬間に殺されても残るのは「古い中身のまま」か「新しい中身」の
// どちらかである。
//
// **保証の限界を書いておく。** これは **プロセスが死んだとき**の保証である。機械ごと
// 落ちたときの耐久性は `fsync` が要る。ここで買っているのは前者だけであり、後者は
// 主張しない。
import { renameSync, rmSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

const MARK = ".tmp-";

/** 同じ置き場に作る一時の名前。走行ごとに違う(並行しても奪い合わない)。 */
export const tempPathFor = (path) => `${path}${MARK}${process.pid}-${randomBytes(6).toString("hex")}`;

/**
 * 書いてから付け替える。失敗したら一時の物を片付けて、例外をそのまま上げる。
 *
 * `write` と `rename` を差し替えられるのは試験のためである —— **信号を送って
 * 競合を再現するのではなく、「書けたが付け替える前」という瞬間を直に作り、
 * どの瞬間にも成り立つ不変条件を確かめる。**
 */
export function writeAtomic(path, body, { write = writeFileSync, rename = renameSync } = {}) {
  const tmp = tempPathFor(path);
  try {
    write(tmp, body, "utf8");
    rename(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * 死んだ走行が残した一時の物を片付ける。
 *
 * 生きている走行の物には触れない —— 触れると、並行して走っている生成を壊す。
 */
export function sweepStale(path) {
  const d = dirname(path);
  const prefix = basename(path) + MARK;
  let names = [];
  try { names = readdirSync(d); } catch { return 0; }
  let swept = 0;
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const pid = Number(n.slice(prefix.length).split("-")[0]);
    if (!Number.isInteger(pid)) continue;
    try { process.kill(pid, 0); continue; } catch { /* 死んでいる */ }
    try { unlinkSync(join(d, n)); swept++; } catch { /* 競合したなら任せる */ }
  }
  return swept;
}
