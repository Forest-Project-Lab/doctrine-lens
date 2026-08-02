// 検査器の判定器を検める（SPEC-007 / TEST-007）。
//
// なぜ要るか: `npm run mutate` の結論は「試験が捕まえた／捕まえなかった」であり、それは
// 丸ごとこの判定器に乗っている。判定器が壊れていれば数字は読めない。**検査器を検める
// 試験が無いまま score を信じてはならない。** ここが赤いとき、mutate の数字は無効である。
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEST_REPORTER, capture, namesOfFailed, selfCheck, verdictOf } from "./mutate-verdict.mjs";

const withTempDir = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "mutate-verdict-test-"));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const RED = 'import { test } from "node:test";\nimport assert from "node:assert";\ntest("赤", () => { assert.equal(1, 2); });\n';
const GREEN = 'import { test } from "node:test";\ntest("緑", () => {});\n';

test("意図して落とした試験を「試験が落ちた」と読む（既定 reporter に依らない）", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "a.test.mjs"), RED, "utf8");
    const r = verdictOf(capture(`node --test-reporter=${TEST_REPORTER} --test a.test.mjs`, dir));
    assert.equal(r.verdict, "試験が落ちた");
    assert.deepEqual(r.failed, ["赤"]);
  });
});

test("通る試験を「試験は通った」と読む", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "a.test.mjs"), GREEN, "utf8");
    const r = verdictOf(capture(`node --test-reporter=${TEST_REPORTER} --test a.test.mjs`, dir));
    assert.equal(r.verdict, "試験は通った");
    assert.deepEqual(r.failed, []);
  });
});

// これが直した欠陥そのものである。以前は「試験は通った」と読んでいた。
test("束ねが無いとき「試験は通った」ではなく「検査器の異常」になる", () => {
  withTempDir((dir) => {
    const raw = capture(`node --test-reporter=${TEST_REPORTER} --test nope.test.mjs`, dir);
    assert.notEqual(raw.status, 0, "試験processは非ゼロで終わるはず");
    assert.equal(namesOfFailed(raw).length, 0, "not ok の行は出ないはず");
    assert.equal(verdictOf(raw).verdict, "検査器の異常");
  });
});

test("非ゼロなのに not ok が無い組み合わせは「検査器の異常」になる", () => {
  // reporter が spec だった場合に相当する（✖ 形式で not ok を吐かない）。
  const r = verdictOf({ status: 1, signal: null, stdout: "✖ 赤 (1.0ms)\n", stderr: "" });
  assert.equal(r.verdict, "検査器の異常");
  assert.match(r.why, /reporter/);
});

test("シグナルで死んだ走行は「検査器の異常」になる", () => {
  const r = verdictOf({ status: null, signal: "SIGKILL", stdout: "", stderr: "" });
  assert.equal(r.verdict, "検査器の異常");
  assert.match(r.why, /SIGKILL/);
});

test("終了符号 0 なのに not ok が在る矛盾は「検査器の異常」になる", () => {
  const r = verdictOf({ status: 0, signal: null, stdout: "not ok 1 - 赤\n", stderr: "" });
  assert.equal(r.verdict, "検査器の異常");
});

test("合否は not ok の件数ではなく終了符号で決まる", () => {
  // 同じ本文で終了符号だけ違えれば、判定も違う。逆に言えば、正規表現は合否を決めない。
  const body = { signal: null, stdout: "not ok 1 - 赤\n", stderr: "" };
  assert.equal(verdictOf({ ...body, status: 1 }).verdict, "試験が落ちた");
  assert.equal(verdictOf({ ...body, status: 0 }).verdict, "検査器の異常");
});

test("stderr 側の not ok も名前として拾う", () => {
  const r = verdictOf({ status: 1, signal: null, stdout: "", stderr: "not ok 1 - 赤\n" });
  assert.equal(r.verdict, "試験が落ちた");
  assert.deepEqual(r.failed, ["赤"]);
});

test("走り出す前の自己点検が、この実行環境で健全と出る", () => {
  assert.deepEqual(selfCheck(), [], "判定器が自分を検められない実行環境では score を出せない");
});
