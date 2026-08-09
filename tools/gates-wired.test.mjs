// 門が経路に結ばれていることを凍結する。
//
// なぜ要るか: lens#12 は「上流に在る全件のリンタを、こちらのどの経路も呼んでいない」
// という欠陥だった。監査だけが緑で、リンタは一度も走っていなかった。610387d
// (CHANGE-023・024)が package.json の check と CI の両方へ配線し、同じ変更で
// 241 件を 0 件にした。**いま 0 件なのは、門が走っているからである。**
//
// その事実を守るものが無かった。段を一つ消しても、命令の連なりから一つ落としても、
// 誰も気付かないまま「所見 0」に戻る —— 走っていないから 0 なのか、守れているから
// 0 なのかを、区別できない状態に戻る。ここはその区別を凍結する。
//
// これは欠陥の再現ではない(書いた時点で通る)。**回帰の門**である。
// 発火することは、段を消して落ちることを実測して確かめた
// (research/system-map/decisions/phase-2-baseline/issue-12/)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8"));
const checkYml = readFileSync(join(PROJECT, ".github/workflows/check.yml"), "utf8");

/** 手元の `npm run check` が必ず通す段。落とすとその門は誰も呼ばなくなる。 */
const IN_CHECK = ["typecheck", "test", "compile", "docs:check", "docs:lint", "docs:terms", "docs:measured"];

/** CI が必ず回す命令。手元より広い(拡張機能ホスト・実物の画面・配布物を足す)。 */
const IN_CI = [...IN_CHECK, "test:integration", "preview", "package"];

test("#12. 手元の check が全件のリンタを含む七段を通す", () => {
  const check = manifest.scripts?.["check"] ?? "";
  for (const s of IN_CHECK) {
    assert.ok(
      check.includes(`npm run ${s}`) || (s === "test" && /(^|&&)\s*npm test\b/.test(check)),
      `check から ${s} が落ちている。落とすとその門は手元で一度も走らない(#12 の形)`,
    );
  }
});

test("#12. CI が同じ七段に加えてホスト試験・画面・配布物を回す", () => {
  for (const s of IN_CI) {
    const called = new RegExp(`run:.*npm (run )?${s.replace(":", ":")}\\b`).test(checkYml);
    assert.ok(called, `check.yml が ${s} を呼んでいない。手元と CI で守る範囲がずれる`);
  }
});

test("#12. docs:lint は全件走査の口を叩く(一件検査の口ではない)", () => {
  // 上流のリンタは二つの口を持つ。--batch は統治木の全件を見て所見があれば
  // 終了コード 1 を返す。もう一方(PostToolUse の一件検査)は常に 0 を返すので、
  // 門として結ぶと必ず緑になる。#12 が言った「受け皿が無い」状態へ戻る。
  const lint = manifest.scripts?.["docs:lint"] ?? "";
  assert.match(lint, /docs-linter\.py/, "docs:lint がリンタを呼んでいない");
  assert.match(lint, /--batch\b/, "--batch が無いと一件検査になり、終了コードが常に 0 になる");
});

test("#12. docs:check は所見の重さで落ちる", () => {
  // --fail-on error が無いと、監査は所見を並べたうえで終了コード 0 を返す。
  const audit = manifest.scripts?.["docs:check"] ?? "";
  assert.match(audit, /docs-audit\.py/, "docs:check が監査を呼んでいない");
  assert.match(audit, /--fail-on\s+error\b/, "--fail-on error が無いと所見があっても緑になる");
});

test("#12. 門はどれも上流の実体を doctrine-path.mjs 経由で引く", () => {
  // 版つきの置き場を直書きすると、上流が版を上げた日に静かに壊れる。
  for (const s of ["docs:check", "docs:lint"]) {
    const cmd = manifest.scripts?.[s] ?? "";
    assert.match(cmd, /node tools\/doctrine-path\.mjs/, `${s} が上流の実体を直書きしている`);
  }
});
