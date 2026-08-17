// M 層検査器のうち、候補モデル(JSON)単体に適用できるものを機械判定する。
//
//   node validate.mjs <model.json> [...] [--report <path>]
//   node validate.mjs --requirements --json   →  起草者へ差し出す要件の一覧
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
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runModelCheckers, MODEL_CHECKERS } from "./check-model.mjs";
import { managedModels, REGISTRY } from "./spec.mjs";
import { verdict, reportPathFrom, writeReport, formatRecord, ackFor, gateExitCode, todayFrom } from "./report.mjs";

const argv = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * 起草者へ差し出す要件の一覧。
 *
 * なぜ要るか(doctrine#294): 当方の器は「形(schema.json)」と「不変条件」の二層で、
 * 後者は schema に書けない。上流の起草者はそれを知る術が無く、散文の手引きを写す
 * しかなかった —— **写しは割れる**(実測: 上流の必須欄が当方の器と食い違い、
 * M-18 と M-14 の両方で落ちた)。
 *
 * **ここは新しい事実を一つも持たない。** 文言は registry の不変条件から、見た単位と
 * 註釈は検査器から、裏づけは負例の表から、形は器の一枚から導く。持つのは繋ぎだけである。
 * 覆えているかは M-Q1(meta:requirements-complete)が毎回数える。
 */
if (argv.includes("--requirements")) {
  const schemaPath = join(here, "schema.json");
  const body = readFileSync(schemaPath);
  const schema = JSON.parse(body.toString("utf8"));
  const stmt = new Map((REGISTRY.invariants ?? []).map((i) => [i.id, i.statement]));
  // **負例は手書きの模型へ当てる物だった。** 模型を破棄したので負例も無い ——
  // 「裏づけが在るのに読めなかった」と「裏づけがそもそも無い」を混ぜない。
  const negPath = join(here, "negatives.json");
  const negatives = existsSync(negPath) ? (JSON.parse(readFileSync(negPath, "utf8")).cases ?? []) : [];
  const negativesNote = existsSync(negPath)
    ? null
    : "負例は手書きの模型へ当てる物であり、模型を破棄した 2026-08-17 に一緒に失われた。**この一覧のどの要件も、破ると門が鳴ることを確かめていない。**";

  // 除外の理由は綴りを増やさず、その検査器が何を判ずるかから言う。
  const WHY = {
    artifact: "生成物と実ブラウザの振る舞いを判ずる。模型だけでは判定できない",
    gate: "門そのものを見る段であり、模型が満たす要件ではない",
  };

  const requirements = [];
  const notCovered = [];
  for (const c of REGISTRY.checkers ?? []) {
    if (c.judges === "model") {
      const impl = MODEL_CHECKERS[c.id];
      const proven_by = negatives
        .filter((n) => n.expect?.checker === c.id && n.expect?.verdict !== "PASS")
        .map((n) => ({ id: n.id, why: n.why }));
      requirements.push({
        invariant: c.invariant,
        checker: c.id,
        statement: stmt.get(c.invariant) ?? null,
        ...(impl?.unit ? { unit: impl.unit } : {}),
        ...(impl?.note ? { note: impl.note } : {}),
        expressible_in_schema: c.id === "model:schema-shape",
        proven: proven_by.length > 0,
        proven_by,
      });
    } else {
      notCovered.push({ checker: c.id, judges: c.judges, why: WHY[c.judges] ?? "分類が無い" });
    }
  }

  const out = {
    schema: "system-map/requirements/1",
    $comment:
      "起草者が満たすべきこと。**形はここに写さない** —— container が指す一枚が正本である。" +
      "ここが持つのは、その一枚に書けない不変条件だけである。",
    container: {
      id: schema.$id,
      sha256: createHash("sha256").update(body).digest("hex"),
      path: "research/system-map/gold-model/schema.json",
      note: "必須欄・語彙・形はこの一枚から導くこと。写さない(写しは割れる)。",
    },
    // 起草の判断に要る政策。値も出所も registry が正本。
    policy: Object.fromEntries(
      ["realization_accepted_kinds", "max_ops", "overlay_candidate"]
        .filter((k) => REGISTRY.policy?.[k])
        .map((k) => [k, REGISTRY.policy[k]]),
    ),
    requirements,
    not_covered: notCovered,
    limits: [
      ...(negativesNote ? [negativesNote] : []),
      "意味の正しさは検めない。その要素が本当に在るか、その流れが実際に起きるかは見ていない。",
      "`proven: false` の要件は、**破ると門が鳴ることを確かめていない**。要件として述べているだけである。",
      "形(必須欄・語彙)は container の一枚が正本であり、ここには写していない。",
      "この一覧は模型を判ずる検査器だけを覆う。not_covered の検査器は別の門が見る。",
    ],
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exit(0);
}

const reportPath = reportPathFrom(argv);
const today = todayFrom(argv);
let files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--report" && argv[i - 1] !== "--today");

// **手書きの模型を持たない**(所有者決定 2026-08-17)。引数が無ければ、検める対象は
// doctrine が管理する物だけ —— `model-index/1` の捕獲から引く。
// 0 件なら**検査器ごとに「検める対象を持たない」と言う**。黙って通さない。
const managed = files.length === 0 ? managedModels() : null;
if (managed) {
  files = managed.models.map((m) => resolve(here, "..", "..", "..", "doctrine_docs", m.projection_path));
  if (files.length === 0) {
    const records0 = Object.entries(MODEL_CHECKERS).map(([id, c]) => verdict({
      invariant: c.invariant, checker: id, target: "(doctrine が管理する模型)",
      examined: 0, examined_unit: c.unit ?? "模型",
      violations: [],
    }));
    for (const r of records0) r.note = managed.reason;
    const t0 = {};
    for (const r of records0) t0[r.verdict] = (t0[r.verdict] ?? 0) + 1;
    const acked0 = records0.filter((r) => r.verdict !== "PASS" && ackFor(r, today.date)).length;
    console.log(`== doctrine が管理する模型 ==`);
    console.log(`  ${managed.reason}`);
    for (const r of records0) console.log(`  ${String(r.invariant).padEnd(6)} ${r.checker.padEnd(34)} ${r.verdict}`);
    console.log(`\n計: ${Object.entries(t0).map(([k, v]) => `${k} ${v}`).join(" / ")}(うち了解済 ${acked0})`);
    console.log("※ VACUOUS・SKIP・ERROR は PASS ではない。合計に混ぜない。");
    if (reportPath) writeReport(reportPath, "model", records0);
    process.exit(gateExitCode(records0, today.date));
  }
}
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
