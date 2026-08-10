// 同じ木で一括判定が二つ重ならないようにする錠。
//
// なぜ要るか: `verify.mjs` の build の段は、**commit 済みの `index.html` を書き換える**
// (出荷物の鮮度を CI の差分検査が見るので、そこへ書くのが正しい)。一方でブラウザの
// 三段は同じ物を読む。二つの走行が重なると、片方が読んでいる最中にもう片方が書く ——
// 落ちるとは限らず、**別の木の画面を測った結果が緑になりうる。**
//
// `mkdir` を錠に使う。既に在れば失敗するので、確かめてから作る隙間が無い。
// (`tools/mutate-worktree.mjs` の同じ作法を写した。`research/` は木の外へ依存を
// 作らない方針なので、取り込まずに写している。)
//
// **死んだ持ち主の錠は継ぐ。** 継がないと、一度の強制終了で木が永久に詰まる。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "system-map-run-";
const keyOf = (root) => createHash("sha256").update(String(root)).digest("hex").slice(0, 12);

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/**
 * 木ごとの錠を取る。取れなければ例外で止まる —— **待たない。**
 * 待つと、詰まった走行が「遅い走行」に見えて原因が読めなくなる。
 */
export function acquireLock(root) {
  const path = join(tmpdir(), `${PREFIX}${keyOf(root)}.lock`);
  const claim = () => {
    mkdirSync(path); // 既に在れば EEXIST で失敗する。これが錠である。
    writeFileSync(join(path, "pid"), String(process.pid), "utf8");
    return { path, release: () => rmSync(path, { recursive: true, force: true }) };
  };
  try {
    return claim();
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    let holder = NaN;
    try { holder = Number(readFileSync(join(path, "pid"), "utf8").trim()); } catch { /* 書く前に落ちた */ }
    if (alive(holder)) {
      throw new Error(
        `同じ木で別の走行が動いている(pid ${holder})。重ねると、片方が読んでいる生成物を` +
          `もう片方が書き換える。終わるのを待つか、その走行を止めること。錠: ${path}`,
      );
    }
    // 持ち主が死んでいる。継ぐ。
    rmSync(path, { recursive: true, force: true });
    return claim();
  }
}
