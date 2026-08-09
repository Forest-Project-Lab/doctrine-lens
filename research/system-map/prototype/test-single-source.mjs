// M 層の事実が二箇所以上に手書きされていないことを検める。
//
//   node test-single-source.mjs
//
// なぜ要るか: 同じ事実(模型の一覧・実現先の種別・証跡の必須属性・七状態・操作数の上限)が
// 六箇所以上に手書きされていた。増やすときに一箇所を忘れても、**落ちずに黙って外れる**もの
// が在る —— 静止画は別の対象を撮り、ラベルの掃引は別の対象を掃く。落ちないので気付かない。
//
// ここは「正本(registry.json / schema.json)以外に事実の綴りが無い」ことだけを検める。
// 判定そのものは見ない(それは validate.mjs と gates.mjs の務め)。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** 正本そのもの。ここだけは事実を持ってよい。 */
const CANON = new Set(["gold-model/registry.json", "gold-model/schema.json"]);

/** 正本から導くだけの層。綴りは持たないが、正本のファイル名は名指してよい。 */
const DERIVER = "gold-model/spec.mjs";

const RULES = [
  {
    id: "模型のファイル名",
    why: "対象を増やすとき、ここを直し忘れた箇所は黙って掃引から外れる",
    re: /(?:target-\d+-[\w-]+|fixture-[\w-]+)\.json/g,
    allow: (rel) => rel === DERIVER,
  },
  {
    id: "対象を位置で指す",
    why: "模型の並び順が意味を持ってしまう。並べ替えると静止画が別の対象を撮る",
    re: /selectOption\(\s*["']#target["']\s*,\s*["']\d+["']/g,
  },
  {
    id: "対象の添字の一覧",
    why: "同上。対象を増やしても掃引の範囲が増えない",
    re: /\[\s*"0"\s*,\s*"1"\s*,\s*"2"\s*,\s*"3"\s*\]/g,
  },
  {
    id: "実現先として認める種別",
    why: "validate 側と build 側で食い違ったまま気付けない(上流 #212 ギャップ7 の形)",
    re: /\[\s*"code_range"\s*,\s*"test"\s*\]/g,
  },
  {
    id: "証跡の必須属性",
    why: "schema.json の Evidence.required と二重定義になり、片方だけ動く",
    re: /"ref"\s*,\s*"environment"\s*,\s*"version"\s*,\s*"exit_status"\s*,\s*"observed_at"/g,
  },
  {
    id: "七状態",
    why: "schema.json の VerificationStatus.enum と二重定義になる",
    re: /"unknown"\s*,\s*"claimed"\s*,\s*"planned"\s*,\s*"verified"/g,
  },
  {
    id: "操作数の上限",
    why: "台帳 v3.2-16 が決めた値。呼ぶ側それぞれが持つと、片方だけ緩められる",
    re: /assertM14\s*\([^)]*,\s*3\s*\)/g,
  },
];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "shots" || name === "node_modules") continue;
      walk(p);
    } else if (name.endsWith(".mjs")) {
      files.push(p);
    }
  }
})(root);

const hits = [];
for (const p of files) {
  const rel = relative(root, p).split("\\").join("/");
  if (CANON.has(rel)) continue;
  const lines = readFileSync(p, "utf8").split("\n");
  for (const rule of RULES) {
    if (rule.allow?.(rel)) continue;
    lines.forEach((line, i) => {
      // 自分自身の規則の綴りは数えない(この検査器は綴りを持つのが仕事である)
      if (rel === "prototype/test-single-source.mjs") return;
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) hits.push({ rel, line: i + 1, rule, text: line.trim().slice(0, 96) });
    });
  }
}

const byRule = new Map();
for (const h of hits) byRule.set(h.rule.id, [...(byRule.get(h.rule.id) ?? []), h]);

for (const rule of RULES) {
  const hs = byRule.get(rule.id) ?? [];
  if (hs.length === 0) {
    console.log(`ok   ${rule.id} — 正本の外に綴りが無い`);
    continue;
  }
  console.log(`NG   ${rule.id} — ${hs.length} 箇所に手書きされている(${rule.why})`);
  for (const h of hs) console.log(`       ${h.rel}:${h.line}  ${h.text}`);
}

console.log(
  hits.length === 0
    ? `\n全件通過(${files.length} 本の .mjs を見た)`
    : `\n${hits.length} 箇所が正本の外に事実を持っている`,
);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-S1", checker: "meta:single-source", target: "research/system-map",
  examined: files.length, examined_unit: "走査した .mjs",
  violations: hits.map((h) => ({ code: "meta.duplicated_fact", message: `${h.rel}:${h.line} に ${h.rule.id} が手書きされている` })),
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "single-source", records);
process.exit(gateExitCode(records, today.date));
