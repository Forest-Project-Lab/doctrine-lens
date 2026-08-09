// M 層検査器(Phase 0 版)。台帳 v3.2-3 と INVARIANTS.md の M-01〜M-12 のうち、
// 候補モデル(JSON)単体に適用可能なものを機械判定する。
//
// 判定は PASS / FAIL / SKIP の三値。SKIP は「この版では判定不能」であり合格ではない
// (発火しない門を緑と呼ばない)。SKIP には理由を必ず付ける。
//
//   node validate.mjs target-*.json
import { readFileSync } from "node:fs";
// 語彙は schema.json が正本。ここでは持たない(spec.mjs が導いて突き合わせる)。
import { STATES, EVIDENCE_KEYS, REVIEW_STATUSES, AUTHORITIES } from "./spec.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node validate.mjs <model.json> [...]");
  process.exit(2);
}

let anyFail = false;

for (const file of files) {
  const m = JSON.parse(readFileSync(file, "utf8"));
  const results = [];
  const fail = (id, msg) => results.push(["FAIL", id, msg]);
  const pass = (id, msg = "") => results.push(["PASS", id, msg]);
  const skip = (id, why) => results.push(["SKIP", id, why]);

  const elements = m.elements ?? [];
  const flows = m.flows ?? [];
  const contracts = m.contracts ?? [];
  const scenarios = m.scenarios ?? [];
  const anchors = m.anchors ?? [];
  const eById = new Map(elements.map((e) => [e.id, e]));
  const fById = new Map(flows.map((f) => [f.id, f]));

  // M-01 id の一意性(全エンティティ横断)
  {
    const all = [...elements, ...flows, ...contracts, ...scenarios, ...anchors].map((x) => x.id);
    const dup = all.filter((id, i) => all.indexOf(id) !== i);
    dup.length ? fail("M-01", `id 重複: ${[...new Set(dup)].join(", ")}`) : pass("M-01");
  }

  // M-02 親は 0 または 1、実在、循環なし
  {
    let ok = true;
    for (const e of elements) {
      const p = e.parent ?? null;
      if (p !== null && !eById.has(p)) { fail("M-02", `${e.id} の親 ${p} が実在しない`); ok = false; }
      const seen = new Set([e.id]);
      let cur = p;
      while (cur !== null && cur !== undefined) {
        if (seen.has(cur)) { fail("M-02", `${e.id} から親を辿ると循環する`); ok = false; break; }
        seen.add(cur);
        cur = eById.get(cur)?.parent ?? null;
      }
    }
    if (ok) pass("M-02");
  }

  // M-03 Flow の端点は実在、各1。自己ループは理由必須
  {
    let ok = true;
    for (const f of flows) {
      if (!eById.has(f.from) || !eById.has(f.to)) { fail("M-03", `${f.id} の端点が実在しない`); ok = false; }
      if (f.from === f.to && !f.self_loop_reason) { fail("M-03", `${f.id} は自己ループだが self_loop_reason が無い`); ok = false; }
    }
    if (ok) pass("M-03");
  }

  // M-04 子の越境 Flow は親の外部 I/O へ集約できる
  {
    const top = (id) => {
      let cur = id;
      while ((eById.get(cur)?.parent ?? null) !== null) cur = eById.get(cur).parent;
      return cur;
    };
    const topPairs = new Set(
      flows.filter((f) => (eById.get(f.from)?.parent ?? null) === null && (eById.get(f.to)?.parent ?? null) === null)
        .map((f) => `${f.from}→${f.to}`),
    );
    let checked = 0, ok = true;
    for (const f of flows) {
      const fromTop = top(f.from), toTop = top(f.to);
      const involvesChild = f.from !== fromTop || f.to !== toTop;
      if (involvesChild && fromTop !== toTop) {
        checked++;
        if (!topPairs.has(`${fromTop}→${toTop}`)) {
          fail("M-04", `${f.id}(子の越境)に対応する親レベルの Flow ${fromTop}→${toTop} が無い`);
          ok = false;
        }
      }
    }
    if (ok) pass("M-04", checked === 0 ? "子の越境 Flow なし(空対象で成立)" : `${checked} 本を照合`);
  }

  // M-05 Contract: assumptions ≥1、response_measure 非空
  {
    let ok = true;
    for (const c of contracts) {
      if (!Array.isArray(c.assumptions) || c.assumptions.length < 1) { fail("M-05", `${c.id} に assumptions が無い`); ok = false; }
      if (!c.response_measure) { fail("M-05", `${c.id} に response_measure が無い`); ok = false; }
      if (!STATES.includes(c.verification_status)) { fail("M-05", `${c.id} の状態 ${c.verification_status} は七状態に無い`); ok = false; }
    }
    if (ok) pass("M-05", "判定可能性そのものは機械で測れない(非空+七状態のみ検査)");
  }

  // M-06 verified は証跡最小形つきの Evidence 必須
  {
    let ok = true;
    for (const c of contracts.filter((c) => c.verification_status === "verified")) {
      if (!Array.isArray(c.evidence) || c.evidence.length < 1) { fail("M-06", `${c.id} が verified なのに evidence が無い`); ok = false; continue; }
      for (const ev of c.evidence) {
        const missing = EVIDENCE_KEYS.filter((k) => !ev[k]);
        if (missing.length) { fail("M-06", `${c.id} の evidence に ${missing.join("/")} が無い`); ok = false; }
      }
    }
    if (ok) pass("M-06");
  }

  // M-07 全エンティティが review_status を持つ(表示側の混入検査は Phase 1)
  {
    const bad = [...elements, ...flows, ...contracts, ...scenarios].filter((x) => !REVIEW_STATUSES.includes(x.review_status));
    bad.length ? fail("M-07", `review_status の無い/不正な項: ${bad.map((x) => x.id).join(", ")}`)
      : pass("M-07", "正本表示への混入検査はプロトタイプ側(Phase 1)");
  }

  // M-08 文書辺の自動変換の禁止(補助的な検査)
  {
    const bad = flows.filter((f) => (f.provenance ?? []).some((p) => /dep-graph|depends_on|impacts/.test(p.source)));
    bad.length ? fail("M-08", `文書辺由来の疑いがある Flow: ${bad.map((f) => f.id).join(", ")}`)
      : pass("M-08", "出所の字面検査のみ(過程の検査は人の規律)");
  }

  // M-09 全辺ラベル
  {
    const bad = flows.filter((f) => !f.label);
    bad.length ? fail("M-09", `label の無い Flow: ${bad.map((f) => f.id).join(", ")}`) : pass("M-09");
  }

  // M-10 鮮度判定の権威はちょうど一つ
  {
    const bad = anchors.filter((a) => !AUTHORITIES.includes(a.authority));
    bad.length ? fail("M-10", `authority が不正な anchor: ${bad.map((a) => a.id).join(", ")}`) : pass("M-10");
  }

  // M-11 unknown は負の出所(verdict=silent)必須
  {
    let ok = true;
    for (const c of contracts.filter((c) => c.verification_status === "unknown")) {
      const negs = (c.provenance ?? []).filter((p) => p.verdict === "silent" && p.source && p.checked_at);
      if (negs.length < 1) { fail("M-11", `${c.id} が unknown なのに負の出所が無い`); ok = false; }
    }
    if (ok) pass("M-11");
  }

  // M-12 シナリオの幽霊要素なし+Flow 端点一致
  {
    let ok = true;
    for (const s of scenarios) {
      for (const st of s.steps ?? []) {
        if (!eById.has(st.actor) || !eById.has(st.receiver)) { fail("M-12", `${s.id} に幽霊要素`); ok = false; }
        if (st.flow) {
          const f = fById.get(st.flow);
          if (!f) { fail("M-12", `${s.id} が幽霊 Flow ${st.flow} を指す`); ok = false; }
          else if (st.actor !== f.from || st.receiver !== f.to) { fail("M-12", `${s.id} の step と ${st.flow} の端点が一致しない`); ok = false; }
        }
      }
      if (s.kind === "exception" && s.exception_of && !scenarios.some((x) => x.id === s.exception_of)) {
        fail("M-12", `${s.id} の exception_of が実在しない`); ok = false;
      }
    }
    if (ok) pass("M-12");
  }

  // M-15 not_applicable は理由(+出所)必須(doctrine S1 → 登載)
  {
    let ok = true;
    for (const c of contracts.filter((c) => c.verification_status === "not_applicable")) {
      if (!c.na_reason) { fail("M-15", `${c.id} が not_applicable なのに na_reason が無い`); ok = false; }
      if (!(c.provenance ?? []).some((p) => p.verdict === "present")) {
        fail("M-15", `${c.id} の理由に present の出所が無い`); ok = false;
      }
    }
    if (ok) pass("M-15");
  }

  // M-16 証跡最小形は五項 — fingerprint、または version の SHA が指紋を兼ねる(doctrine S2 → 登載)
  {
    const shaLike = /\b[0-9a-f]{7,40}\b/;
    let ok = true;
    for (const c of contracts.filter((c) => c.verification_status === "verified")) {
      for (const ev of c.evidence ?? []) {
        if (!ev.fingerprint && !shaLike.test(ev.version ?? "")) {
          fail("M-16", `${c.id} の evidence に指紋が無く、version も SHA でない(黙った省略)`); ok = false;
        }
      }
    }
    if (ok) pass("M-16", "等価規則: version の commit SHA は内容の指紋を兼ねる");
  }

  // モデル単体では判定できないもの(合格ではない)
  skip("M-13", "宣言済み CLI 限定は道具側の検査(Phase 1 のプロトタイプで判定)");
  skip("M-14", "3 操作以内の到達はプロトタイプの検査(Phase 1 で判定)");

  // 出力
  console.log(`\n== ${file} (target: ${m.target}) ==`);
  for (const [st, id, msg] of results) console.log(`  ${st}  ${id}${msg ? `  — ${msg}` : ""}`);
  const f = results.filter(([s]) => s === "FAIL").length;
  const p = results.filter(([s]) => s === "PASS").length;
  const k = results.filter(([s]) => s === "SKIP").length;
  console.log(`  計: PASS ${p} / FAIL ${f} / SKIP ${k}`);
  if (f > 0) anyFail = true;
}

process.exit(anyFail ? 1 : 0);
