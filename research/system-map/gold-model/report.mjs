// 判定の記録の形と、集計・終了コードの規則。**合格の桶に入るのは PASS だけである。**
//
// なぜ要るか(ADR-031 決定5): 検査の形が「絞った集合を回し、違反が無ければ合格」
// だったため、集合が空でも合格が出ていた。開始時点で 10 件がそれだった —— celery は
// verified な契約を一件も持たないのに「verified の契約はすべて証跡が揃っている」で
// 合格していた。**何も検めていない合格を合格と呼ばない。**
//
// SKIP も同じである。「この版では判定不能」は不合格であって合格ではない。
// 以前は終了コードに影響しなかった(validate.mjs が FAIL だけを数えていた)。
import { writeFileSync } from "node:fs";
import { REGISTRY } from "./spec.mjs";

const VERDICT_RULES = REGISTRY.verdicts ?? (() => { throw new Error("registry.json に verdicts が無い"); })();

/** 判定の名。正本は registry.json。`$comment` は説明であって判定ではない。 */
export const VERDICTS = Object.freeze(Object.keys(VERDICT_RULES).filter((k) => !k.startsWith("$")));

/** 合格の桶に入るか。 */
export const countsAsPass = (v) => VERDICT_RULES[v]?.counts_as_pass === true;

const need = (cond, msg) => { if (!cond) throw new Error(`判定の記録が壊れている: ${msg}`); };

/**
 * 一件の判定の記録を作る。
 *
 * `examined` は「実際に見た件数」である。0 のとき PASS は名乗れない —— VACUOUS になる。
 * 呼び手が数え忘れたら例外で止まる(既定 0 にして黙って空判定にしない)。
 */
export function verdict({ invariant, checker, target, examined, examined_unit, violations = [], skip = null, error = null }) {
  need(invariant, "invariant が無い");
  need(checker, "checker が無い");
  need(target !== undefined, `${checker} に target が無い`);
  if (error) return { invariant, checker, target, verdict: "ERROR", examined: examined ?? 0, examined_unit, code: "meta.error", message: String(error) };
  if (skip) return { invariant, checker, target, verdict: "SKIP", examined: examined ?? 0, examined_unit, code: "meta.skip", message: String(skip) };
  need(Number.isInteger(examined), `${checker} が examined を数えていない(見た件数を必ず返す)`);
  need(examined_unit, `${checker} が examined_unit を持たない(何を数えたかを言う)`);
  if (violations.length > 0) {
    return {
      invariant, checker, target, verdict: "FAIL", examined, examined_unit,
      code: violations[0].code ?? "model.violation",
      message: violations.map((v) => v.message).join(" / "),
      violations,
    };
  }
  if (examined === 0) {
    return {
      invariant, checker, target, verdict: "VACUOUS", examined: 0, examined_unit,
      code: "meta.vacuous", message: `${examined_unit} が 0 件。何も検めていない`,
    };
  }
  return { invariant, checker, target, verdict: "PASS", examined, examined_unit, code: null, message: "" };
}

/** `--report <path>` を argv から取る。無ければ null。 */
export function reportPathFrom(argv) {
  const i = argv.indexOf("--report");
  if (i < 0) return null;
  const p = argv[i + 1];
  if (!p || p.startsWith("--")) throw new Error("--report の後ろに書き出す先が無い");
  return p;
}

/** 判定の記録を書き出す。段が黙って終わらないための唯一の証拠になる。 */
export function writeReport(path, gateId, records) {
  writeFileSync(path, JSON.stringify({ schema: "system-map/verdicts/1", gate: gateId, records }, null, 2) + "\n", "utf8");
}

/**
 * この判定を個別に許す了解の記録。無ければ null。
 *
 * 了解は「何を検めていないか」を出所つきで名指したものだけを認める(ADR-031 決定5)。
 * 期限を持たない了解は認めない —— 一覧が恒久化するのを防ぐ唯一の歯止めである。
 */
const ACK_KEYS = ["invariant", "target", "verdict", "reason", "source", "checked_at", "recorded_by", "expires_at"];

/** 了解の記録の一覧(形の検査つき)。$comment だけの行は説明であって記録ではない。 */
export const ACKNOWLEDGEMENTS = Object.freeze(
  (REGISTRY.acknowledgements ?? []).filter((a) => !(Object.keys(a).length === 1 && a.$comment)).map((a) => {
    const missing = ACK_KEYS.filter((k) => !a[k]);
    if (missing.length) throw new Error(`了解の記録に ${missing.join("/")} が無い: ${JSON.stringify(a)}`);
    return Object.freeze({ ...a });
  }),
);

/** 走行が使う日付。`--today YYYY-MM-DD` があればそれ、無ければ壁時計。**必ず印字する。** */
export function todayFrom(argv) {
  const i = argv.indexOf("--today");
  if (i >= 0) {
    const d = argv[i + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) throw new Error("--today は YYYY-MM-DD で渡す");
    return { date: d, source: "--today" };
  }
  return { date: new Date().toISOString().slice(0, 10), source: "壁時計" };
}

export function ackFor(record, today = null) {
  if (record.verdict === "PASS" || record.verdict === "FAIL") return null;
  const a = ACKNOWLEDGEMENTS.find(
    (x) => x.invariant === record.invariant && x.target === record.target && x.verdict === record.verdict,
  );
  if (!a) return null;
  // 期限を過ぎた了解は了解ではない。過ぎたことを黙って通さない。
  if (today && a.expires_at < today) return null;
  return a;
}

/**
 * 了解の記録のうち、もう成り立っていないもの。二種類ある。
 *   期限切れ  ——  再点検の期限を過ぎた
 *   前提消滅  ——  対応する判定がもう出ていない(対象が実データを持った等)
 * どちらも、了解の側が所見になる。一覧が恒久化するのを防ぐ歯止めである。
 */
export function unsoundAcks(records, today) {
  const out = [];
  for (const a of ACKNOWLEDGEMENTS) {
    if (today && a.expires_at < today) {
      out.push({ ack: a, code: "meta.acknowledgement_expired", message: `了解の期限 ${a.expires_at} を過ぎている(再点検する)` });
      continue;
    }
    const matched = records.some((r) => r.invariant === a.invariant && r.target === a.target && r.verdict === a.verdict);
    if (!matched) out.push({ ack: a, code: "meta.acknowledgement_stale", message: "対応する判定がもう出ていない(了解の前提が消えている)" });
  }
  return out;
}

/**
 * 一つの段の終了コード。
 *   2  ERROR が在る(検査器の異常。数字を出す資格が無い)
 *   1  FAIL が在る／了解の無い VACUOUS・SKIP が在る
 *   0  上記が無い
 */
export function gateExitCode(records, today = null) {
  if (records.some((r) => r.verdict === "ERROR")) return 2;
  if (records.some((r) => r.verdict === "FAIL")) return 1;
  if (records.some((r) => !countsAsPass(r.verdict) && !ackFor(r, today))) return 1;
  return 0;
}

/** 一行の表示。合格でないものは理由を必ず添える。 */
export function formatRecord(r, ack) {
  const head = `  ${r.invariant.padEnd(6)} ${r.checker.padEnd(34)} ${String(r.target).padEnd(26)} ${r.verdict.padEnd(8)}`;
  const detail = r.verdict === "PASS"
    ? `(${r.examined_unit} ${r.examined} 件)`
    : `(${r.examined_unit ?? "?"} ${r.examined} 件) ${r.message}`;
  return head + detail + (ack ? `  ← 了解済: ${ack.reason}` : "");
}
