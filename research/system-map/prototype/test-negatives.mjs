// 負例の表を回す。**門が実際に発火することを、実在の模型の変種で確かめる。**
//
//   node test-negatives.mjs [--report <path>] [--today YYYY-MM-DD]
//
// 表の正本は gold-model/negatives.json。模型は二度書かず、実在の対象へ patch を当てる。
// **patch の指す先が解けなければ ERROR にする** —— 黙って飛ばすと、当たっていない
// patch が「負例は通った」として数えられる(それは門が発火したことの証明にならない)。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeOpsRows, reachabilityVerdicts } from "./gates.mjs";
import { MAX_OPS } from "../gold-model/spec.mjs";
import { runModelCheckers } from "../gold-model/check-model.mjs";
import { schemaViolations } from "../gold-model/validate-schema.mjs";
// patch の当て方は lib/patch.mjs が一本で持つ(表示の負例も同じ物を使う)。
import { applyPatch } from "../lib/patch.mjs";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gold = join(here, "..", "gold-model");
const TABLE = JSON.parse(readFileSync(join(gold, "negatives.json"), "utf8"));

/** 指定の検査器を一つ走らせ、判定の記録を返す。 */
function runChecker(checker, model) {
  if (checker === "model:schema-shape") {
    const violations = schemaViolations(model);
    return verdict({ invariant: "M-18", checker, target: model.target, examined: 1, examined_unit: "模型", violations });
  }
  if (checker === "build:reachability") {
    const r = reachabilityVerdicts([model], MAX_OPS)[0];
    return verdict({ invariant: "M-14", checker, target: model.target, examined: r.examined, examined_unit: "到達可能な要素", violations: r.violations });
  }
  const { results } = runModelCheckers(model);
  const found = results.find((x) => x.id === checker);
  if (!found) throw new Error(`知らない検査器: ${checker}`);
  return verdict({
    invariant: found.invariant, checker, target: model.target,
    examined: found.examined, examined_unit: found.unit, violations: found.violations,
    error: found.error ? found.error.message : null,
  });
}

let checked = 0;
const violations = [];
for (const c of TABLE.cases) {
  checked++;
  let got, why = "";
  try {
    const base = JSON.parse(readFileSync(join(gold, c.base), "utf8"));
    got = runChecker(c.expect.checker, applyPatch(base, c.patch));
  } catch (e) {
    violations.push({ code: "negatives.error", message: `${c.id}: ${e.message}` });
    console.log(`NG   ${c.id} — ${e.message}`);
    continue;
  }
  if (got.verdict !== c.expect.verdict) why = `判定が ${got.verdict}(期待 ${c.expect.verdict})`;
  else if (c.expect.code && got.code !== c.expect.code) why = `符丁が ${got.code}(期待 ${c.expect.code})`;
  else if (c.expect.message_match && !new RegExp(c.expect.message_match).test(got.message ?? "")) {
    why = `文言が咎める先を名指していない(/${c.expect.message_match}/ に合わない): ${(got.message ?? "").slice(0, 120)}`;
  }
  if (why) {
    violations.push({ code: "negatives.mismatch", message: `${c.id}: ${why}` });
    console.log(`NG   ${c.id} — ${why}`);
  } else {
    console.log(`ok   ${c.id} — ${c.why}`);
  }
}

console.log(violations.length === 0 ? `\n全件通過(${checked} 例)` : `\n${violations.length} 件の所見`);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-N2", checker: "meta:negatives-fire", target: "gold-model/negatives.json",
  examined: checked, examined_unit: "負例", violations,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "negatives", records);
process.exit(gateExitCode(records, today.date));
