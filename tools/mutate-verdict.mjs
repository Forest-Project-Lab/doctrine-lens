// 潰しの検査器の判定器（SPEC-007）。
//
// なぜ別のファイルにするか: この道具の結論は「試験が捕まえた／捕まえなかった」であり、
// それは丸ごとこの判定器の正しさに乗っている。判定器が試験できない場所（副作用を持つ
// 実行スクリプトの中）に居る限り、検査器自身を検める術が無い。だから判定だけを取り出し、
// tools/mutate-verdict.test.mjs が直に検める。
//
// 標準ライブラリだけで動く。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// doctrine:begin SPEC-007
// reporter を固定する。既定に委ねてはならない。
//
// 既定 reporter は「吐き出す先が端末か」と Node の版で変わる。実測: Node v22.22.3 で
// 同じ試験が、パイプ越しだと `not ok 1 - …`（tap）、端末越しだと `✖ intentional canary`
// （spec）になった。外部レビューは Node v24.14.0 の既定で後者を観測している。
// 判定の根拠が実行環境の性質で動く設計を、ここで断つ。
export const TEST_REPORTER = "tap";

/**
 * 子へ渡す環境。`NODE_TEST_CONTEXT` を落とす。
 *
 * この道具が `node --test` の中から呼ばれると（判定器を検める試験がまさにそれ）、
 * 親の試験走者が置いた `NODE_TEST_CONTEXT` が子へ伝播し、**子の `--test-reporter`
 * 指定を上書きして**子process向けの書式に切り替わる。`not ok` が一行も出なくなり、
 * 判定器を試験の中から呼べない。reporter を固定した意味が消えるので、ここで断つ。
 */
const childEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

/** 走らせて、終了符号・シグナル・吐かれた物を**捨てずに**返す。 */
export const capture = (command, cwd) => {
  try {
    const stdout = execFileSync("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      env: childEnv(),
    });
    return { status: 0, signal: null, stdout, stderr: "" };
  } catch (error) {
    return {
      // spawn 自体が失敗すると status も signal も無い。null を「不明」として運び、
      // 判定側で「異常」に倒す。0 に丸めると成功として読まれる。
      status: typeof error.status === "number" ? error.status : null,
      signal: error.signal ?? null,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
};

/** 吐かれた行から、赤くなった試験の名前を拾う。**合否には使わない**（人に見せる補助）。 */
export const namesOfFailed = (result) =>
  [...`${result.stdout ?? ""}${result.stderr ?? ""}`.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) =>
    m[1].trim(),
  );

/**
 * 試験の四つ組から判定を出す。合否は `status` と `signal` だけで決める。
 *
 * 以前はここが `failed.length > 0` で決めていた。すると `^not ok` を吐かずに非ゼロで
 * 終わる全ての場合 —— reporter の差・束ねの読み込み失敗・timeout・シグナル死 —— が
 * 「試験は通った」に落ちた。baseline なら赤い木を緑と読み、各行なら守られている直しを
 * 「守られていない」と報告する。噛み合わない組み合わせは異常として立てる。
 */
export const verdictOf = (result) => {
  const failed = namesOfFailed(result);
  if (result.signal !== null && result.signal !== undefined) {
    return { verdict: "検査器の異常", failed, why: `シグナル ${result.signal} で死んだ` };
  }
  if (result.status === 0) {
    if (failed.length > 0) {
      return { verdict: "検査器の異常", failed, why: "終了符号 0 なのに not ok の行が在る" };
    }
    return { verdict: "試験は通った", failed };
  }
  if (failed.length === 0) {
    return {
      verdict: "検査器の異常",
      failed,
      why: `終了符号 ${result.status} だが not ok の行が無い（reporter の差・束ねの読み込み失敗・timeout の疑い）`,
    };
  }
  return { verdict: "試験が落ちた", failed };
};

/**
 * 走り出す前に、判定器そのものを実測で検める。
 *
 * 落ちる canary と通る canary を、利用者のリポジトリの外（一時ディレクトリ）に書いて
 * 回し、期待どおりに読めることを見る。食い違いの一覧を返す（空なら健全）。
 */
export const selfCheck = () => {
  const dir = mkdtempSync(join(tmpdir(), "mutate-selfcheck-"));
  try {
    writeFileSync(
      join(dir, "red.test.mjs"),
      'import { test } from "node:test";\nimport assert from "node:assert";\ntest("canary must fail", () => { assert.equal(1, 2); });\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "green.test.mjs"),
      'import { test } from "node:test";\ntest("canary must pass", () => {});\n',
      "utf8",
    );
    const red = verdictOf(capture(`node --test-reporter=${TEST_REPORTER} --test red.test.mjs`, dir));
    const green = verdictOf(
      capture(`node --test-reporter=${TEST_REPORTER} --test green.test.mjs`, dir),
    );
    const faults = [];
    if (red.verdict !== "試験が落ちた") {
      faults.push(`落ちる canary を「${red.verdict}」と読んだ${red.why ? `（${red.why}）` : ""}`);
    }
    if (red.failed.length !== 1) {
      faults.push(`落ちる canary の名前を ${red.failed.length} 件拾った（1 件のはず）`);
    }
    if (green.verdict !== "試験は通った") {
      faults.push(
        `通る canary を「${green.verdict}」と読んだ${green.why ? `（${green.why}）` : ""}`,
      );
    }
    return faults;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
// doctrine:end SPEC-007
