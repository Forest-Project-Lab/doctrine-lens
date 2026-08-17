// 模型単体で判定できる不変条件の検査器の表。
//
// 各検査器は `{ examined, examined_unit, violations }` を返す。**見た件数を必ず返す。**
// 見た件数が 0 のとき合格は名乗れない(report.mjs が VACUOUS にする)。以前は
// 「絞った集合を回し、違反が無ければ合格」だったので、集合が空でも合格が出ていた。
//
// 語彙は schema.json、政策は registry.json が正本(spec.mjs 経由)。ここでは持たない。
import { STATES, EVIDENCE_KEYS, REVIEW_STATUSES, AUTHORITIES, REALIZATION_KINDS } from "./spec.mjs";
import { anchorTargetViolations } from "../lib/anchor-target.mjs";
import { schemaViolations } from "./validate-schema.mjs";

const v = (code, message) => ({ code, message });

/** 検査器の表。鍵は registry.json の checkers[].id と一致すること(test-registry.mjs が検める)。 */
export const MODEL_CHECKERS = {
  "model:schema-shape": {
    invariant: "M-18",
    unit: "模型",
    note: "schema.json をそのまま実行する。以前は一度も実行されておらず、required も enum も minItems も誰も検めていなかった",
    run(m, ctx) {
      return { examined: 1, violations: schemaViolations(ctx.raw) };
    },
  },

  "model:id-unique": {
    invariant: "M-01",
    unit: "id",
    run(m) {
      const all = [...m.elements, ...m.flows, ...m.contracts, ...m.scenarios, ...m.anchors].map((x) => x.id);
      const dup = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))];
      return {
        examined: all.length,
        violations: dup.length ? [v("model.id_duplicate", `id 重複: ${dup.join(", ")}`)] : [],
      };
    },
  },

  "model:parent-acyclic": {
    invariant: "M-02",
    unit: "要素",
    run(m, ctx) {
      const violations = [];
      for (const e of m.elements) {
        const p = e.parent ?? null;
        if (p !== null && !ctx.eById.has(p)) violations.push(v("model.parent_missing", `${e.id} の親 ${p} が実在しない`));
        const seen = new Set([e.id]);
        let cur = p;
        while (cur !== null && cur !== undefined) {
          if (seen.has(cur)) { violations.push(v("model.parent_cycle", `${e.id} から親を辿ると循環する`)); break; }
          seen.add(cur);
          cur = ctx.eById.get(cur)?.parent ?? null;
        }
      }
      return { examined: m.elements.length, violations };
    },
  },

  "model:flow-endpoints": {
    invariant: "M-03",
    unit: "Flow",
    run(m, ctx) {
      const violations = [];
      for (const f of m.flows) {
        if (!ctx.eById.has(f.from) || !ctx.eById.has(f.to)) violations.push(v("model.flow_endpoint_missing", `${f.id} の端点が実在しない`));
        if (f.from === f.to && !f.self_loop_reason) violations.push(v("model.self_loop_no_reason", `${f.id} は自己ループだが self_loop_reason が無い`));
      }
      return { examined: m.flows.length, violations };
    },
  },

  "model:child-crossing-aggregated": {
    invariant: "M-04",
    unit: "子の越境 Flow",
    run(m, ctx) {
      const top = (id) => {
        let cur = id;
        while ((ctx.eById.get(cur)?.parent ?? null) !== null) cur = ctx.eById.get(cur).parent;
        return cur;
      };
      const topPairs = new Set(
        m.flows.filter((f) => (ctx.eById.get(f.from)?.parent ?? null) === null && (ctx.eById.get(f.to)?.parent ?? null) === null)
          .map((f) => `${f.from}→${f.to}`),
      );
      let examined = 0;
      const violations = [];
      for (const f of m.flows) {
        const fromTop = top(f.from), toTop = top(f.to);
        if ((f.from !== fromTop || f.to !== toTop) && fromTop !== toTop) {
          examined++;
          if (!topPairs.has(`${fromTop}→${toTop}`)) {
            violations.push(v("model.crossing_not_aggregated", `${f.id}(子の越境)に対応する親レベルの Flow ${fromTop}→${toTop} が無い`));
          }
        }
      }
      return { examined, violations };
    },
  },

  "model:contract-shape": {
    invariant: "M-05",
    unit: "契約",
    note: "判定可能性そのものは機械で測れない(非空+七状態のみ検査)",
    run(m) {
      const violations = [];
      for (const c of m.contracts) {
        if (!Array.isArray(c.assumptions) || c.assumptions.length < 1) violations.push(v("model.no_assumptions", `${c.id} に assumptions が無い`));
        if (!c.response_measure) violations.push(v("model.no_response_measure", `${c.id} に response_measure が無い`));
        if (!STATES.includes(c.verification_status)) violations.push(v("model.unknown_state", `${c.id} の状態 ${c.verification_status} は七状態に無い`));
      }
      return { examined: m.contracts.length, violations };
    },
  },

  "model:verified-has-evidence": {
    invariant: "M-06",
    unit: "verified な契約",
    run(m) {
      const subject = m.contracts.filter((c) => c.verification_status === "verified");
      const violations = [];
      for (const c of subject) {
        if (!Array.isArray(c.evidence) || c.evidence.length < 1) {
          violations.push(v("model.verified_no_evidence", `${c.id} が verified なのに evidence が無い`));
          continue;
        }
        for (const ev of c.evidence) {
          // 空文字と 0 を「欠落」と読まない。持っているかどうかだけを見る。
          const missing = EVIDENCE_KEYS.filter((k) => ev[k] === undefined || ev[k] === null || ev[k] === "");
          if (missing.length) violations.push(v("model.evidence_incomplete", `${c.id} の evidence に ${missing.join("/")} が無い`));
        }
      }
      return { examined: subject.length, violations };
    },
  },

  "model:review-status-present": {
    invariant: "M-07a",
    unit: "実体",
    run(m) {
      const all = [...m.elements, ...m.flows, ...m.contracts, ...m.scenarios];
      const bad = all.filter((x) => !REVIEW_STATUSES.includes(x.review_status));
      return {
        examined: all.length,
        violations: bad.length ? [v("model.review_status_missing", `review_status の無い/不正な項: ${bad.map((x) => x.id).join(", ")}`)] : [],
      };
    },
  },

  "model:no-proposed-in-canonical": {
    invariant: "M-07b",
    unit: "confirmed の実体",
    note: "confirmed が現れるまで検めるものが無い。正本表示(confirmed のみの投影)は未実装",
    run(m) {
      // 正本表示は「confirmed だけを写した投影」である。まだ一つも存在しない。
      // confirmed の実体が現れた時点で、投影が在ることと proposed を含まないことを
      // 検める必要が生じる。いまは見る対象が 0 件であり、それを VACUOUS として言う。
      const all = [...m.elements, ...m.flows, ...m.contracts, ...m.scenarios];
      const confirmed = all.filter((x) => x.review_status === "confirmed");
      const violations = confirmed.length
        ? [v("model.canonical_projection_missing", `confirmed の実体が ${confirmed.length} 件あるが、confirmed だけを写した正本表示が実装されていない(混入を検めようがない)`)]
        : [];
      return { examined: confirmed.length, violations };
    },
  },

  "model:no-doc-edge-flows": {
    invariant: "M-08",
    unit: "Flow",
    note: "出所の字面検査のみ(過程の検査は人の規律)",
    run(m) {
      const bad = m.flows.filter((f) => (f.provenance ?? []).some((p) => /dep-graph|depends_on|impacts/.test(p.source)));
      return {
        examined: m.flows.length,
        violations: bad.length ? [v("model.flow_from_doc_edge", `文書辺由来の疑いがある Flow: ${bad.map((f) => f.id).join(", ")}`)] : [],
      };
    },
  },

  "model:flow-labelled": {
    invariant: "M-09",
    unit: "Flow",
    run(m) {
      const bad = m.flows.filter((f) => !f.label);
      return {
        examined: m.flows.length,
        violations: bad.length ? [v("model.flow_unlabelled", `label の無い Flow: ${bad.map((f) => f.id).join(", ")}`)] : [],
      };
    },
  },

  "model:single-freshness-authority": {
    invariant: "M-10",
    unit: "アンカー",
    run(m) {
      const bad = m.anchors.filter((a) => !AUTHORITIES.includes(a.authority));
      return {
        examined: m.anchors.length,
        violations: bad.length ? [v("model.bad_authority", `authority が不正な anchor: ${bad.map((a) => a.id).join(", ")}`)] : [],
      };
    },
  },

  "model:unknown-has-negative-source": {
    invariant: "M-11",
    unit: "unknown な契約",
    run(m) {
      const subject = m.contracts.filter((c) => c.verification_status === "unknown");
      const violations = [];
      for (const c of subject) {
        const negs = (c.provenance ?? []).filter((p) => p.verdict === "silent" && p.source && p.checked_at);
        if (negs.length < 1) violations.push(v("model.unknown_no_negative_source", `${c.id} が unknown なのに負の出所が無い`));
      }
      return { examined: subject.length, violations };
    },
  },

  "model:no-ghost-in-scenarios": {
    invariant: "M-12",
    unit: "シナリオの段",
    run(m, ctx) {
      const violations = [];
      let examined = 0;
      for (const s of m.scenarios) {
        for (const st of s.steps ?? []) {
          examined++;
          if (!ctx.eById.has(st.actor) || !ctx.eById.has(st.receiver)) violations.push(v("model.ghost_element", `${s.id} に幽霊要素`));
          if (st.flow) {
            const f = ctx.fById.get(st.flow);
            if (!f) violations.push(v("model.ghost_flow", `${s.id} が幽霊 Flow ${st.flow} を指す`));
            else if (st.actor !== f.from || st.receiver !== f.to) violations.push(v("model.step_endpoint_mismatch", `${s.id} の step と ${st.flow} の端点が一致しない`));
          }
        }
        if (s.kind === "exception" && s.exception_of && !m.scenarios.some((x) => x.id === s.exception_of)) {
          violations.push(v("model.exception_of_missing", `${s.id} の exception_of が実在しない`));
        }
      }
      return { examined, violations };
    },
  },

  "model:na-has-reason": {
    invariant: "M-15",
    unit: "not_applicable な契約",
    run(m) {
      const subject = m.contracts.filter((c) => c.verification_status === "not_applicable");
      const violations = [];
      for (const c of subject) {
        if (!c.na_reason) violations.push(v("model.na_no_reason", `${c.id} が not_applicable なのに na_reason が無い`));
        if (!(c.provenance ?? []).some((p) => p.verdict === "present")) violations.push(v("model.na_no_present_source", `${c.id} の理由に present の出所が無い`));
      }
      return { examined: subject.length, violations };
    },
  },

  "model:supports-names-real-fields": {
    invariant: "M-P1",
    unit: "支える欄を名乗った出所",
    note: "名指した欄がその記録に無ければ、画面は主張の下へ何も出せないのに『出所つき』と数える",
    run(m) {
      // 出所を持ちうる記録は四種(器の $defs で provenance を持つ物)。
      const bearers = [
        ...(m.elements ?? []).map((r) => ["elements", r]),
        ...(m.flows ?? []).map((r) => ["flows", r]),
        ...(m.contracts ?? []).map((r) => ["contracts", r]),
        ...(m.scenarios ?? []).map((r) => ["scenarios", r]),
      ];
      let examined = 0;
      const violations = [];
      for (const [where, rec] of bearers) {
        for (const [i, src] of (rec.provenance ?? []).entries()) {
          if (!Array.isArray(src.supports)) continue; // 任意欄。書かない自由が在る
          examined++;
          // **書かないことと、空を書くことを同じにしない。** 空配列は「支える欄が無い」
          // ではなく「名乗りかけてやめた」であり、器の側では落とせない(制約を足すと
          // 受け入れる集合が狭まり版が上がる)。ここで落とす。
          if (src.supports.length === 0) {
            violations.push(v("model.supports_empty", `${where}/${rec.id} の出所[${i}] の supports が空である。書かないのと空を書くのは別である`));
          }
          for (const name of src.supports) {
            if (typeof name !== "string" || name.trim() === "") {
              violations.push(v("model.supports_blank_name", `${where}/${rec.id} の出所[${i}] の supports に空の名が在る`));
              continue;
            }
            // **その記録に実在する欄だけを名乗れる。** 出所そのものの欄
            // (provenance)を名指すのは自己言及なので認めない。
            if (name === "provenance") {
              violations.push(v("model.supports_self_reference", `${where}/${rec.id} の出所[${i}] が provenance を支えると名乗っている`));
            } else if (!Object.hasOwn(rec, name)) {
              violations.push(v("model.supports_unknown_field", `${where}/${rec.id} の出所[${i}] が名乗る欄 "${name}" がその記録に無い`));
            }
          }
        }
      }
      return { examined, violations };
    },
  },

  "model:anchor-target-grammar": {
    invariant: "M-17",
    unit: "実現先になりうるアンカー",
    note: "接頭は照合の鍵であって飾りではない。剥がすと跨リポジトリの偽陽性が『実測』として出る",
    run(m) {
      const subject = (m.anchors ?? []).filter((a) => REALIZATION_KINDS.includes(a.target_kind));
      return { examined: subject.length, violations: anchorTargetViolations(m, REALIZATION_KINDS) };
    },
  },

  "model:evidence-fingerprinted": {
    invariant: "M-16",
    unit: "verified な契約の証跡",
    note: "等価規則: version の commit SHA は内容の指紋を兼ねる",
    run(m) {
      const shaLike = /\b[0-9a-f]{7,40}\b/;
      let examined = 0;
      const violations = [];
      for (const c of m.contracts.filter((c) => c.verification_status === "verified")) {
        for (const ev of c.evidence ?? []) {
          examined++;
          if (!ev.fingerprint && !shaLike.test(ev.version ?? "")) {
            violations.push(v("model.evidence_no_fingerprint", `${c.id} の evidence に指紋が無く、version も SHA でない(黙った省略)`));
          }
        }
      }
      return { examined, violations };
    },
  },
};

/** 一つの模型に全検査器を当てる。ctx は検査器の間で共有する索引。 */
export function runModelCheckers(model) {
  const m = {
    target: model.target,
    elements: model.elements ?? [],
    flows: model.flows ?? [],
    contracts: model.contracts ?? [],
    scenarios: model.scenarios ?? [],
    anchors: model.anchors ?? [],
  };
  const ctx = {
    raw: model,
    eById: new Map(m.elements.map((e) => [e.id, e])),
    fById: new Map(m.flows.map((f) => [f.id, f])),
  };
  const out = [];
  for (const [id, c] of Object.entries(MODEL_CHECKERS)) {
    let result;
    try {
      result = c.run(m, ctx);
    } catch (e) {
      out.push({ id, invariant: c.invariant, unit: c.unit, error: e });
      continue;
    }
    out.push({ id, invariant: c.invariant, unit: c.unit, note: c.note, ...result });
  }
  return { target: m.target, results: out };
}
