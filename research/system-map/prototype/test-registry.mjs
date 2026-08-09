// 不変条件と検査器の対応を検める。
//
//   node test-registry.mjs
//
// なぜ要るか(ADR-031 決定8): 判定は三門(模型・build・ブラウザ)に分かれているのに、
// `INVARIANTS.md` は二つの仕掛けしか名指していなかった。上流の配布技能の文書は
// 「二門」と書いている。どこにも全体の対応が無いので、**検査器を持たない不変条件**が
// 在っても気付けなかった —— 実際 M-07 の後半(proposed が正本表示に混ざらない)は
// どこにも実装が無いまま、validate.mjs が「プロトタイプ側で検める」と印字していた。
//
// ここが検めるのは対応そのものであり、判定の中身ではない。中身は各門が見る。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY, TARGETS } from "../gold-model/spec.mjs";
import { MODEL_CHECKERS } from "../gold-model/check-model.mjs";
import { VERDICTS, ACKNOWLEDGEMENTS, verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const invariants = REGISTRY.invariants ?? [];
const checkers = REGISTRY.checkers ?? [];
const gates = REGISTRY.gates ?? [];

const violations = [];
const v = (code, message) => violations.push({ code, message });
let checked = 0;
const t = (name, fn) => {
  checked++;
  const before = violations.length;
  fn();
  console.log((violations.length === before ? "ok   " : "NG   ") + name);
};

t("不変条件が名指す検査器はすべて登録されている", () => {
  const known = new Set(checkers.map((c) => c.id));
  for (const inv of invariants) {
    for (const id of inv.checkers ?? []) {
      if (!known.has(id)) v("registry.checker_missing", `${inv.id} が名指す検査器 ${id} が checkers に無い`);
    }
  }
});

t("検査器はすべてちょうど一つの不変条件に属する", () => {
  const known = new Set(invariants.map((i) => i.id));
  for (const c of checkers) {
    if (!known.has(c.invariant)) v("registry.invariant_missing", `検査器 ${c.id} の不変条件 ${c.invariant} が invariants に無い`);
    const owners = invariants.filter((i) => (i.checkers ?? []).includes(c.id));
    if (owners.length === 0) v("registry.checker_unreferenced", `検査器 ${c.id} をどの不変条件も名指していない`);
    if (owners.length > 1) v("registry.checker_shared", `検査器 ${c.id} を ${owners.length} 個の不変条件が名指している`);
  }
});

t("検査器を持たない不変条件が無い", () => {
  for (const inv of invariants) {
    if (!(inv.checkers ?? []).length) v("registry.invariant_unchecked", `不変条件 ${inv.id} に検査器が無い(誰も検めない不変条件を置かない)`);
    if (!inv.statement) v("registry.invariant_no_statement", `不変条件 ${inv.id} に文が無い`);
    if (!inv.source) v("registry.invariant_no_source", `不変条件 ${inv.id} に出所が無い`);
  }
});

t("id が一意である", () => {
  for (const [what, ids] of [["不変条件", invariants.map((i) => i.id)], ["検査器", checkers.map((c) => c.id)], ["段", gates.map((g) => g.id)]]) {
    const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    if (dup.length) v("registry.duplicate_id", `${what}の id が重複: ${dup.join(", ")}`);
  }
});

t("検査器の属する段が実在する", () => {
  const known = new Set(gates.map((g) => g.id));
  for (const c of checkers) {
    if (!c.gate) v("registry.checker_no_gate", `検査器 ${c.id} に段が無い`);
    else if (!known.has(c.gate)) v("registry.gate_missing", `検査器 ${c.id} の段 ${c.gate} が gates に無い`);
    if (!c.module) v("registry.checker_no_module", `検査器 ${c.id} に実装の場所が無い`);
  }
});

t("模型の門の検査器が、登録と実装で一致する(集合として)", () => {
  // 登録されているのに実装が無い／実装が在るのに登録が無い、のどちらも落とす。
  const registered = new Set(checkers.filter((c) => c.gate === "model").map((c) => c.id));
  const implemented = new Set(Object.keys(MODEL_CHECKERS));
  for (const id of registered) if (!implemented.has(id)) v("registry.checker_not_implemented", `検査器 ${id} が登録されているが check-model.mjs に無い`);
  for (const id of implemented) if (!registered.has(id)) v("registry.checker_not_registered", `check-model.mjs の ${id} が registry.json に登録されていない`);
  // 表の側が名乗る不変条件も一致すること
  for (const [id, c] of Object.entries(MODEL_CHECKERS)) {
    const reg = checkers.find((x) => x.id === id);
    if (reg && reg.invariant !== c.invariant) v("registry.invariant_mismatch", `${id} の不変条件が登録(${reg.invariant})と実装(${c.invariant})で食い違う`);
  }
});

t("INVARIANTS.md の表が登録と一致する", () => {
  // 文書が仕掛けを落とせないようにする。以前は gates.mjs と全ブラウザ試験が
  // 表から落ちていた(「二門」と書かれていた原因の半分)。
  const md = readFileSync(join(here, "..", "gold-model", "INVARIANTS.md"), "utf8");
  const inDoc = [...md.matchAll(/^\|\s*(M-[\w-]+)\s*\|/gm)].map((m) => m[1]);
  const inReg = invariants.map((i) => i.id);
  const missing = inReg.filter((id) => !inDoc.includes(id));
  const extra = inDoc.filter((id) => !inReg.includes(id));
  if (missing.length) v("registry.doc_missing", `INVARIANTS.md に ${missing.join(", ")} の行が無い`);
  if (extra.length) v("registry.doc_extra", `INVARIANTS.md の ${extra.join(", ")} が registry.json に無い`);
});

t("判定の語彙に、合格の桶が一つだけ在る", () => {
  const passes = VERDICTS.filter((x) => REGISTRY.verdicts[x]?.counts_as_pass === true);
  if (passes.length !== 1) v("registry.pass_bucket", `合格の桶が ${passes.length} 個ある(${passes.join(", ")})。一つであること`);
  for (const x of VERDICTS) if (!REGISTRY.verdicts[x]?.note) v("registry.verdict_no_note", `判定 ${x} に説明が無い`);
});

t("了解の記録が実在する不変条件と対象を指す", () => {
  const invIds = new Set(invariants.map((i) => i.id));
  const targetIds = new Set([...TARGETS.map((x) => x.id), "index.html", "research/system-map", "M-13/M-14 の計算経路"]);
  for (const a of ACKNOWLEDGEMENTS) {
    if (!invIds.has(a.invariant)) v("registry.ack_unknown_invariant", `了解の記録が知らない不変条件 ${a.invariant} を指す`);
    if (!targetIds.has(a.target)) v("registry.ack_unknown_target", `了解の記録が知らない対象 ${a.target} を指す`);
    if (VERDICTS.indexOf(a.verdict) < 0) v("registry.ack_unknown_verdict", `了解の記録が知らない判定 ${a.verdict} を指す`);
    if (REGISTRY.verdicts[a.verdict]?.counts_as_pass) v("registry.ack_on_pass", `合格に了解の記録を付けている(${a.invariant} / ${a.target})`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.expires_at)) v("registry.ack_bad_expiry", `了解の期限の形が不正: ${a.expires_at}`);
    if (a.expires_at <= a.checked_at) v("registry.ack_expiry_not_after", `了解の期限が確認日より後でない(${a.invariant} / ${a.target})`);
  }
});

console.log(
  violations.length === 0
    ? `\n全件通過(不変条件 ${invariants.length} 件・検査器 ${checkers.length} 件・段 ${gates.length} 件・了解 ${ACKNOWLEDGEMENTS.length} 件)`
    : `\n${violations.length} 件の所見`,
);
for (const x of violations) console.log(`  - ${x.message}`);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-R1", checker: "meta:registry-consistent", target: "gold-model/registry.json",
  examined: checked, examined_unit: "対応の検査", violations,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "registry", records);
process.exit(gateExitCode(records, today.date));
