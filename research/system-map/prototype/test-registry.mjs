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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

// ---- 起草者へ差し出す要件の一覧(M-Q1) ----
// なぜ要るか: 当方の器は「形(schema.json)」と「不変条件」の二層で、後者は schema に
// 書けない。上流の起草者はそれを知る術が無く、散文の手引きを写すしかなかった ——
// **写しは割れる**(実測: 上流の必須欄が当方の器と食い違い、M-18 と M-14 の両方で落ちた)。
// 要件を機械可読で差し出し、写しでなく参照にする。
//
// ここが検めるのは **一覧が過不足なく覆っているか**である。中身の正しさは各門が見る。
const reqViolations = [];
let reqChecked = 0;
const rt = (name, fn) => {
  reqChecked++;
  const before = reqViolations.length;
  try { fn(); } catch (e) { reqViolations.push({ code: "requirements.threw", message: `${name}: 検めが例外で止まった — ${String(e.message).replace(/\s+/g, " ").slice(0, 200)}` }); }
  console.log((reqViolations.length === before ? "ok   " : "NG   ") + name);
};
const rv = (code, message) => reqViolations.push({ code, message });

let REQ = null;
rt("要件の一覧を機械可読で差し出す口が在る", () => {
  const out = execFileSync(process.execPath, [join(here, "..", "gold-model", "validate.mjs"), "--requirements", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  REQ = JSON.parse(out);
  if (REQ.schema !== "system-map/requirements/1") rv("requirements.schema", `要件の一覧の schema が想定外: ${REQ.schema}`);
});

rt("差し出す器の指紋が、実物と一致する", () => {
  if (!REQ) return rv("requirements.absent", "一覧を取れていないので検められない");
  const path = join(here, "..", "gold-model", "schema.json");
  const body = readFileSync(path);
  const sha = createHash("sha256").update(body).digest("hex");
  const schema = JSON.parse(body.toString("utf8"));
  if (REQ.container?.id !== schema.$id) rv("requirements.container_id", `器の名が食い違う: ${REQ.container?.id} ≠ ${schema.$id}`);
  if (REQ.container?.sha256 !== sha) rv("requirements.container_sha", "器の指紋が食い違う(一覧が古い器を指している)");
});

rt("どの検査器も黙って消えない(要件か、理由つきの除外か)", () => {
  if (!REQ) return rv("requirements.absent", "一覧を取れていないので検められない");
  const listed = new Set((REQ.requirements ?? []).map((r) => r.checker));
  const excluded = new Set((REQ.not_covered ?? []).map((r) => r.checker));
  const all = checkers.map((c) => c.id);
  for (const id of all) {
    const inReq = listed.has(id), inEx = excluded.has(id);
    if (!inReq && !inEx) rv("requirements.dropped", `検査器 ${id} が要件にも除外にも現れない(黙って消えている)`);
    if (inReq && inEx) rv("requirements.both", `検査器 ${id} が要件と除外の両方に在る`);
  }
  for (const id of [...listed, ...excluded]) {
    if (!all.includes(id)) rv("requirements.unknown_checker", `一覧が登録されていない検査器 ${id} を挙げている`);
  }
  for (const r of REQ.not_covered ?? []) if (!r.why) rv("requirements.no_reason", `除外した ${r.checker} に理由が無い`);
});

rt("要件が名指す不変条件が、登録と一致する", () => {
  if (!REQ) return rv("requirements.absent", "一覧を取れていないので検められない");
  const byId = new Map(checkers.map((c) => [c.id, c]));
  const stmt = new Map(invariants.map((i) => [i.id, i.statement]));
  for (const r of REQ.requirements ?? []) {
    const c = byId.get(r.checker);
    if (c && r.invariant !== c.invariant) rv("requirements.invariant_mismatch", `${r.checker} の不変条件が登録と違う: ${r.invariant} ≠ ${c.invariant}`);
    if (r.statement !== stmt.get(r.invariant)) rv("requirements.statement_copy", `${r.checker} の文言が登録の写しになっている(登録から導くこと)`);
  }
});

rt("負例で裏づけた要件が、実在する負例を指す", () => {
  if (!REQ) return rv("requirements.absent", "一覧を取れていないので検められない");
  const neg = JSON.parse(readFileSync(join(here, "..", "gold-model", "negatives.json"), "utf8")).cases ?? [];
  const byCase = new Map(neg.map((n) => [n.id, n]));
  for (const r of REQ.requirements ?? []) {
    for (const p of r.proven_by ?? []) {
      const n = byCase.get(p.id);
      if (!n) { rv("requirements.no_such_negative", `${r.checker} が実在しない負例 ${p.id} を指す`); continue; }
      if (n.expect?.checker !== r.checker) rv("requirements.negative_mismatch", `負例 ${p.id} が別の検査器(${n.expect?.checker})を試している`);
    }
    // **裏づけの無い要件は、無いと言う。** 黙って「証明済み」に混ぜない。
    const proven = (r.proven_by ?? []).length > 0;
    if (r.proven !== proven) rv("requirements.proven_flag", `${r.checker} の proven が実体と違う`);
  }
});

// **両方を数える。** 片方だけ見て「全件通過」と刷ると、要約の行が嘘をつく。
const allFindings = [...violations, ...reqViolations];
console.log(
  allFindings.length === 0
    ? `\n全件通過(不変条件 ${invariants.length} 件・検査器 ${checkers.length} 件・段 ${gates.length} 件・了解 ${ACKNOWLEDGEMENTS.length} 件・要件の一覧 ${reqChecked} 検査)`
    : `\n${allFindings.length} 件の所見`,
);
for (const x of allFindings) console.log(`  - ${x.message}`);

const today = todayFrom(process.argv.slice(2));
const records = [
  verdict({
    invariant: "M-R1", checker: "meta:registry-consistent", target: "gold-model/registry.json",
    examined: checked, examined_unit: "対応の検査", violations,
  }),
  verdict({
    invariant: "M-Q1", checker: "meta:requirements-complete", target: "gold-model/registry.json",
    examined: reqChecked, examined_unit: "要件の一覧の検査", violations: reqViolations,
  }),
];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "registry", records);
process.exit(gateExitCode(records, today.date));
