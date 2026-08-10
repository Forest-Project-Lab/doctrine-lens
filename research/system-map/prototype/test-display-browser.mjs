// 画面が、機械の検証の射程どおりに語ることを実ブラウザで検める。
//
//   node test-display-browser.mjs [--report <path>] [--today YYYY-MM-DD]
//
// 二つを見る。
//
//   M-19  生成器が出しうる状態が、**どれも別々の文**として画面に出る。
//         表に無い状態は既知の語へ黙って寄らず、語をそのまま出して「説明できない」と言う。
//   M-20  区別を色や線だけに載せない。境界の内外・候補と確認済・架空の対象・
//         門が認めなかった実現先は、**語**で分かる。
//
// 掃く状態は `policy.display` の表から採る。**この試験は語彙の綴りを持たない** ——
// 持つと正本が二つになり、片方だけ増えた日に掃引から静かに漏れる。
//
// 変種は一時の置き場にだけ出す(出荷物を書き換えない。test-labels-browser と同じ規律)。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DISPLAY, TARGETS, targetIds, loadModels } from "../gold-model/spec.mjs";
import { applyPatch } from "../lib/patch.mjs";
import { slugOf } from "../lib/target-slug.mjs";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const today = todayFrom(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "display-"));

const total = [];
const words = [];
const push = (bag, ok, what, why = "") => {
  bag.push({ what, violation: ok ? null : { code: bag === total ? "display.state_collapsed" : "display.distinction_not_in_words", message: `${what}: ${why}` } });
  console.log((ok ? "ok   " : "NG   ") + what + (ok || !why ? "" : ` — ${why}`));
};
const guard = async (bag, what, fn) => {
  try { const why = await fn(); push(bag, !why, what, why ?? ""); }
  catch (e) { push(bag, false, what, `検めが例外で止まった — ${String(e.message).replace(/\s+/g, " ").slice(0, 200)}`); }
};

const marks = (t) => Object.entries(t ?? {}).filter(([k]) => !k.startsWith("$"));

// ---- 掃く対象と、実測の記録を持つ要素を模型から選ぶ ----
const overlayTargets = TARGETS.filter((t) => t.roles.includes("overlay"));
const base = (() => {
  for (const t of overlayTargets) {
    const path = join(here, "..", "overlay", `overlay-${slugOf(t.id)}.json`);
    try {
      const o = JSON.parse(readFileSync(path, "utf8"));
      if ((o.entries ?? []).length) return { target: t.id, doc: o, path };
    } catch { /* 無ければ次 */ }
  }
  return null;
})();

const model = base ? loadModels("build").find((m) => m.target === base.target) : null;
/** 実測の記録を持つアンカーを realized_by に持つ要素。ここへ降りて 12 節を読む。 */
const subject = base && model
  ? (model.elements ?? []).find((e) => (e.realized_by ?? []).includes(base.doc.entries[0].anchor_id))
  : null;
/** 実測の候補にならないアンカー(走査の射程外)を持つ要素。 */
const outOfScope = base && model
  ? (model.elements ?? []).find((e) => (e.realized_by ?? []).some((a) => !base.doc.entries.some((x) => x.anchor_id === a)))
  : null;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => { throw new Error("pageerror: " + e.message); });

/** 変種を組んで開く。overlay を渡さないときは既定の build(出荷物と同じ形)。 */
async function open(id, overlayDoc = null) {
  const out = join(work, `${id}.html`);
  const args = [join(here, "build.mjs"), "--out", out, "--today", today.date];
  if (overlayDoc) {
    const dir = join(work, `ov-${id}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.json"), JSON.stringify(overlayDoc, null, 2), "utf8");
    args.push("--overlay-dir", dir);
  }
  execFileSync(process.execPath, args, { cwd: here, stdio: "pipe" });
  await page.goto("file://" + out, { waitUntil: "load" });
  return out;
}

/** 対象を選び、必要なら内部へ降りて、要素の詳細を開く。 */
async function focus(targetId, element) {
  await page.selectOption("#target", targetId);
  if ((element.parent ?? null) !== null) await page.locator(`[data-drill="${element.parent}"]`).click();
  await page.locator(`svg g[data-el="${element.id}"]`).click();
}

// ---------------------------------------------------- M-19: 状態が別々の文になる

if (!base || !subject) {
  push(total, false, "実測の記録を持つ対象と要素が在る",
    "overlay の記録を持つ対象、またはそれを実現先に持つ要素が見つからない(掃引の穴)");
} else {
  const anchorId = base.doc.entries[0].anchor_id;
  const at = (field) => `/entries/@anchor_id=${anchorId}/${field}`;

  // 生成器が出しうるアンカー状態を、表から一つずつ当てて掃く。
  for (const [status, d] of marks(DISPLAY.overlay_status_entry)) {
    await guard(total, `overlay の状態「${status}」が固有の文で出る`, async () => {
      const patch = [
        { op: "replace", path: at("status"), value: status },
        { op: "replace", path: at("reason"), value: `合成の理由(${status})` },
      ];
      if (!d.has_ranges) patch.push({ op: "replace", path: at("ranges_now"), value: [] });
      await open(`ov-${status}`, applyPatch(base.doc, patch));
      await focus(base.target, subject);
      const line = page.locator(`#detail [data-ov="${status}"]`);
      if ((await line.count()) !== 1) return `#detail に data-ov="${status}" の行が 1 件無い(${await line.count()} 件)`;
      const text = (await line.first().textContent()) ?? "";
      if (!text.includes(d.mark)) return `印「${d.mark}」が出ていない(実際: ${text.replace(/\s+/g, " ").slice(0, 80)})`;
      if (!text.includes(`合成の理由(${status})`)) return "理由が落ちている";
      // 実測と名乗ってよいのは表がそう言う状態だけ。
      const claimsMeasured = /実測/.test(text.split("—")[0]);
      if (claimsMeasured !== (d.counts_as_measured === true)) {
        return d.counts_as_measured ? "実測と名乗っていない" : `実測でない状態が実測と名乗っている: ${text.slice(0, 60)}`;
      }
      const ranges = await page.locator(`#detail [data-ov="${status}"] [data-range]`).count();
      if ((ranges > 0) !== (d.has_ranges === true)) return `範囲の行が ${ranges} 件(has_ranges=${d.has_ranges})`;
      return null;
    });
  }

  // 表に無い状態は、既知の語へ黙って寄らない。
  await guard(total, "表に無い状態を、黙って既知の語へ読み替えない", async () => {
    await open("ov-unknown-token", applyPatch(base.doc, [{ op: "replace", path: at("status"), value: "zzz-future" }]));
    await focus(base.target, subject);
    const line = page.locator('#detail [data-ov="zzz-future"]');
    if ((await line.count()) !== 1) return "未知の状態の行が出ていない(黙って消えている)";
    const text = (await line.first().textContent()) ?? "";
    if (!text.includes(DISPLAY.unknown_token.mark)) return `「${DISPLAY.unknown_token.mark}」と言っていない`;
    if (!text.includes("zzz-future")) return "読めなかった語そのものを出していない(報告できない)";
    if (/実測/.test(text.split("—")[0])) return "未知の状態が実測と名乗っている";
    return null;
  });

  // rev_state の三値。**二値の分岐だと `unknown` が肯定として出る。**
  for (const [state, d] of marks(DISPLAY.rev_state)) {
    await guard(total, `rev_state「${state}」が固有の文で出る`, async () => {
      await open(`rev-${state}`, applyPatch(base.doc, [{ op: "replace", path: at("rev_state"), value: state }]));
      await focus(base.target, subject);
      const line = page.locator(`#detail [data-rev="${state}"]`);
      if ((await line.count()) < 1) return `data-rev="${state}" の行が出ていない`;
      const text = (await line.first().textContent()) ?? "";
      if (!text.includes(d.mark)) return `印「${d.mark}」が出ていない(実際: ${text.replace(/\s+/g, " ").slice(0, 80)})`;
      // 他の二つの印が混ざっていないこと(取り違えの検出)。
      const others = marks(DISPLAY.rev_state).filter(([k]) => k !== state).map(([, v]) => v.mark);
      const bleed = others.filter((m) => text.includes(m));
      return bleed.length ? `別の状態の印が混ざっている: ${bleed.join(", ")}` : null;
    });
  }

  // 上流が自ら書いた射程の限界を、実測の隣に出す。**綴りは overlay から読む。**
  await guard(total, "実測が言っていないことを、実測の隣に出す", async () => {
    await open("limits", base.doc);
    await focus(base.target, subject);
    const t = (await page.locator("#detail").textContent()) ?? "";
    if (!t.includes(base.doc.source_limits)) return "source_limits が画面のどこにも無い(射程を偽っている)";
    if (!t.includes(base.doc.status)) return `総括の状態(${base.doc.status})が出ていない`;
    return null;
  });

  // 走査の射程外のアンカーが、黙って消えない。
  if (outOfScope) {
    await guard(total, "走査の射程外のアンカーを、黙って落とさない", async () => {
      await open("out-of-scope", base.doc);
      await focus(base.target, outOfScope);
      const n = await page.locator('#detail [data-ov="__out-of-scope"]').count();
      return n >= 1 ? null : "射程外のアンカーについて画面が何も言っていない(測って無かったのと同じ空白になる)";
    });
  } else {
    push(total, false, "走査の射程外のアンカーを持つ要素が在る", "掃引の穴(この形を検められていない)");
  }
}

// 12 節の固定と、操作を増やさないことの構造的な保証。
await guard(total, "詳細は 12 節のまま・畳んだ中身を作らない", async () => {
  await open("shape");
  const m = loadModels("build").find((x) => (x.elements ?? []).some((e) => (e.parent ?? null) === null));
  await focus(m.target, m.elements.find((e) => (e.parent ?? null) === null));
  const h3 = await page.locator("#detail h3").count();
  if (h3 !== 12) return `12 節でない: ${h3}`;
  const folded = await page.locator("#detail details, #detail summary, #detail [hidden]").count();
  return folded === 0 ? null : `畳んだ中身が ${folded} 件ある(実装・証拠へ行くのに操作が増える)`;
});

// ------------------------------------------ M-20: 区別が語で分かる(色や線に載せない)

await guard(words, "境界の外を、線ではなく語で言う", async () => {
  await open("boundary");
  const outside = marks(DISPLAY.element_kind).filter(([, v]) => v.outside_boundary === true).map(([k]) => k);
  const bad = [];
  for (const id of targetIds("build")) {
    const m = loadModels("build").find((x) => x.target === id);
    await page.selectOption("#target", id);
    for (const e of (m.elements ?? []).filter((x) => (x.parent ?? null) === null)) {
      const box = page.locator(`svg g[data-el="${e.id}"]`);
      const t = (await box.textContent()) ?? "";
      const want = DISPLAY.element_kind[e.kind];
      if (!want) { bad.push(`${id}/${e.id}: 種別 ${e.kind} が表に無い`); continue; }
      if (!t.includes(want.mark)) bad.push(`${id}/${e.id}: 種別の語「${want.mark}」が箱に無い`);
      if (outside.includes(e.kind) && !t.includes("境界の外")) bad.push(`${id}/${e.id}: 境界の外だと語で言っていない(${e.kind})`);
    }
  }
  return bad.length ? bad.slice(0, 4).join(" / ") + (bad.length > 4 ? ` ほか ${bad.length - 4} 件` : "") : null;
});

await guard(words, "候補と確認済を、項目ごとに語で言う", async () => {
  await open("review");
  const m = loadModels("build")[0];
  const e = (m.elements ?? []).find((x) => (x.parent ?? null) === null);
  await focus(m.target, e);
  const want = DISPLAY.review_status[e.review_status];
  if (!want) return `要素の review_status(${e.review_status})が表に無い`;
  const n = await page.locator(`#detail [data-review="${e.review_status}"]`).count();
  if (n < 1) return "詳細の見出しに候補の印が無い";
  const t = (await page.locator("#detail").textContent()) ?? "";
  return t.includes(want.mark) ? null : `印「${want.mark}」が出ていない`;
});

await guard(words, "帯をデータから作る(混ざったら帯が変わる)", async () => {
  await open("banner");
  const before = (await page.locator(".banner").textContent()) ?? "";
  const confirmed = DISPLAY.review_status.confirmed.mark;
  if (before.includes(confirmed)) return "候補だけの対象で、確認済が帯に出ている";
  // 一件だけ確認済へ変えて描き直す。**帯が文字の飾りなら、ここで変わらない。**
  await page.evaluate(() => {
    const m = MODELS[0];
    (m.contracts ?? [])[0].review_status = "confirmed";
    tid = m.target;
    document.getElementById("target").value = m.target;
    render();
  });
  const after = (await page.locator(".banner").textContent()) ?? "";
  if (after === before) return "一件が確認済になっても帯が変わらない(帯が字の飾りである)";
  if (!after.includes(confirmed)) return "混ざったのに確認済を言っていない";
  return after.includes("正本表示") ? null : "確認済だけを写した正本表示が無いことを言っていない";
});

await guard(words, "架空の対象を、画面が架空と言う", async () => {
  await open("fictional");
  const fict = TARGETS.filter((t) => t.fictional);
  if (!fict.length) return "架空の対象が目録に無い(この検めは成り立たない)";
  const bad = [];
  for (const t of TARGETS) {
    await page.selectOption("#target", t.id);
    const n = await page.locator("[data-fictional]").count();
    if (t.fictional && n < 1) bad.push(`${t.id}: 架空なのに帯が出ない`);
    if (!t.fictional && n > 0) bad.push(`${t.id}: 架空でないのに帯が出る`);
  }
  return bad.length ? bad.join(" / ") : null;
});

await guard(words, "門が認めなかった実現先を、リンクとして出さない", async () => {
  await open("broken");
  const m = loadModels("build")[0];
  const e = (m.elements ?? []).find((x) => (x.parent ?? null) === null);
  await focus(m.target, e);
  // 判定器が出しうる状態を画面へ与える(**判定器へ結果を渡すのではない** —— 描き手の側だけを試す)。
  // 模型にも合成のアンカーを置く。判定の行は id しか持たず、中身は模型が正本だからである。
  const injected = await page.evaluate(({ t, el }) => {
    const row = M14.rows.find((r) => r.target === t && r.element === el);
    const model = MODELS.find((x) => x.target === t);
    if (!row || !model) return null;
    (model.anchors ??= []).push({
      id: "a-synthetic", target: "合成の成果物", target_kind: "artifact",
      url: "https://example.invalid/tree/0000000", source_revision: "0".repeat(40),
      observed_at: "2026-01-01", authority: "gold_model",
    });
    row.status = "broken";
    row.note = "anchor a-synthetic の種別 artifact は実現先にならない";
    row.anchors = [{ id: "a-synthetic", verdict: "wrong_kind", reason: row.note }];
    render();
    return true;
  }, { t: m.target, el: e.id });
  if (!injected) return "到達の行が見つからない";
  const t = (await page.locator("#detail").textContent()) ?? "";
  const want = DISPLAY.anchor_verdict.wrong_kind.mark;
  if (!t.includes(want)) return `「${want}」と言っていない`;
  if (!t.includes(DISPLAY.reachability_status.broken.mark)) return "到達の状態を語で言っていない";
  const links = await page.locator('#detail a[href="https://example.invalid/tree/0000000"]').count();
  return links === 0 ? null : "門が認めなかった先を、開けるリンクとして出している";
});

await guard(words, "検査画面が「何を検めていないか」を出す", async () => {
  await open("inspect");
  await page.locator('nav button[data-v="inspect"]').click();
  const t = (await page.locator("#left").textContent()) ?? "";
  const n = await page.locator("[data-ack]").count();
  if (n < 1) return "了解の記録が画面のどこにも無い(緑の意味が読めない)";
  return /期限/.test(t) ? null : "了解の期限を出していない";
});

await b.close();

const failed = [...total, ...words].filter((x) => x.violation).length;
console.log(failed === 0
  ? `\n全件通過(状態の掃引 ${total.length} 件・語での区別 ${words.length} 件)`
  : `\n${failed} 件の所見(状態の掃引 ${total.length} 件・語での区別 ${words.length} 件)`);

const records = [
  verdict({
    invariant: "M-19", checker: "browser:display-total", target: "index.html",
    examined: total.length, examined_unit: "状態の掃引",
    violations: total.map((x) => x.violation).filter(Boolean),
  }),
  verdict({
    invariant: "M-20", checker: "browser:distinction-in-words", target: "index.html",
    examined: words.length, examined_unit: "語での区別",
    violations: words.map((x) => x.violation).filter(Boolean),
  }),
];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "browser-display", records);
process.exit(gateExitCode(records, today.date));
