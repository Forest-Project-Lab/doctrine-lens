// M 層検査器のうち、候補モデル(JSON)単体に適用できるものを機械判定する。
//
//   node validate.mjs <model.json> [...] [--report <path>]
//
// 判定は五値。**合格の桶に入るのは PASS だけである。**
//   PASS     見た件数が 1 以上で、違反が無い
//   FAIL     違反が在る
//   VACUOUS  見た件数が 0。何も検めていない(合格ではない)
//   SKIP     この走行では判定不能(合格ではない)。理由を必ず持つ
//   ERROR    検査器が落ちた。数字を出す資格が無い
//
// 検査の本体は check-model.mjs、判定の規則は report.mjs、語彙と政策は
// schema.json / registry.json が正本である。ここはそれらを繋いで印字するだけ。
//
// 以前ここに在った M-13/M-14 の無条件 SKIP(模型を一切見ない二行)は消した。
// 委譲は印字された言い訳ではなく registry.json の checkers が持つ事実であり、
// その検査器が実際に判定を出したかは verify.mjs が検める。
import { readFileSync } from "node:fs";
import { runModelCheckers } from "./check-model.mjs";
import { verdict, reportPathFrom, writeReport, formatRecord, ackFor, gateExitCode, todayFrom } from "./report.mjs";

const argv = process.argv.slice(2);
const reportPath = reportPathFrom(argv);
const today = todayFrom(argv);
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--report" && argv[i - 1] !== "--today");
if (files.length === 0) {
  console.error("usage: node validate.mjs <model.json> [...] [--report <path>]");
  process.exit(2);
}

const records = [];
for (const file of files) {
  let model;
  try {
    model = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // 読めないことを「所見なし」にしない。対象が壊れているという判定を出す。
    records.push(verdict({ invariant: "M-00", checker: "model:readable", target: file, error: `模型を読めない — ${e.message}` }));
    continue;
  }
  const { target, results } = runModelCheckers(model);
  console.log(`\n== ${file} (target: ${target}) ==`);
  for (const r of results) {
    const rec = verdict({
      invariant: r.invariant,
      checker: r.id,
      target,
      examined: r.examined,
      examined_unit: r.unit,
      violations: r.violations,
      error: r.error ? `検査器が落ちた — ${r.error.message}` : null,
    });
    if (r.note && rec.verdict === "PASS") rec.note = r.note;
    records.push(rec);
    console.log(formatRecord(rec, ackFor(rec, today.date)));
  }
}

const tally = {};
for (const r of records) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
const acked = records.filter((r) => r.verdict !== "PASS" && ackFor(r, today.date)).length;
console.log(
  `\n計: ` +
    ["PASS", "FAIL", "VACUOUS", "SKIP", "ERROR"].map((v) => `${v} ${tally[v] ?? 0}`).join(" / ") +
    (acked ? `(うち了解済 ${acked})` : "") +
    `\n※ VACUOUS・SKIP・ERROR は PASS ではない。合計に混ぜない。` +
    `\n判定に使った日付: ${today.date}(${today.source})`,
);

if (reportPath) writeReport(reportPath, "model", records);
process.exit(gateExitCode(records, today.date));
