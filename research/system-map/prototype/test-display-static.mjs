// 画面の語が、生成器の出しうる語を過不足なく覆っていることを検める(ブラウザ不要)。
//
//   node test-display-static.mjs [--report <path>] [--today YYYY-MM-DD]
//
// なぜ要るか: `rev_state` は生成器が三つ出すのに、画面の分岐は二つだった。三つ目
// (`unknown` = 記録した rev が履歴に無い)は **「記録時 rev と同一」という肯定**として
// 印字されていた。表を持ち、表と生成器を機械で突き合わせないと、この取りこぼしは落ちない。
//
// **語を採れなかったときは FAIL でなく ERROR にする。** 走査が静かに壊れると、
// 「採れなかった回」が「合っていた回」に化ける —— それは最も気付けない緑である。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DISPLAY } from "../gold-model/spec.mjs";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = (rel) => readFileSync(join(root, rel), "utf8");

/**
 * 生成器の綴りから語を採る。**規則は狭く保つ** —— 広げると関係の無い字を拾い、
 * 「表に無い語が在る」と誤って言い出す。`<欄>:` の右側の、引用符に囲まれた小文字の語だけ。
 *
 * 下線を字の集合へ入れ忘れて `not_applicable` を落としていた。件数の下限を置いて
 * ERROR にしていたので気付けた —— **採れなかった回を、合っていた回に化けさせない。**
 */
const tokensOf = (text, prop) => {
  const out = new Set();
  for (const m of text.matchAll(new RegExp(`${prop}\\s*:([^\\n]*)`, "g"))) {
    for (const q of (m[1] ?? "").matchAll(/"([a-z][a-z0-9_-]{2,})"/g)) out.add(q[1]);
  }
  return out;
};

const marks = (table) => Object.entries(table ?? {}).filter(([k]) => !k.startsWith("$"));
const keys = (table) => marks(table).map(([k]) => k);

const checks = [];
const violations = [];
const errors = [];
const ok = (what) => { checks.push(what); console.log(`ok   ${what}`); };
const ng = (what, why) => { checks.push(what); violations.push({ code: "display.vocabulary_gap", message: `${what}: ${why}` }); console.log(`NG   ${what} — ${why}`); };
const err = (what, why) => { checks.push(what); errors.push(`${what}: ${why}`); console.log(`ERR  ${what} — ${why}`); };

/** 採った語と表を突き合わせる。採れた数が下限に満たなければ ERROR。 */
function compare(what, got, table, min) {
  if (got.size < min) {
    err(what, `生成器から採れた語が ${got.size} 件しかない(下限 ${min})。走査が壊れている疑いがある —— 一致と読み替えない`);
    return;
  }
  const have = new Set(keys(table));
  const missing = [...got].filter((t) => !have.has(t));
  const extra = [...have].filter((t) => !got.has(t));
  if (missing.length || extra.length) {
    ng(what, [
      missing.length ? `画面が説明できない語: ${missing.join(", ")}` : "",
      extra.length ? `生成器がもう出さない語が表に残っている: ${extra.join(", ")}` : "",
    ].filter(Boolean).join(" / "));
    return;
  }
  ok(`${what}(${got.size} 語)`);
}

const overlaySrc = src("overlay/build-overlay.mjs");
const gatesSrc = src("prototype/gates.mjs");

compare("overlay のアンカー状態が表と一致する", tokensOf(overlaySrc, "status"), DISPLAY.overlay_status_entry, 6);
compare("rev_state が表と一致する", tokensOf(overlaySrc, "rev_state"), DISPLAY.rev_state, 3);
compare("到達の状態が表と一致する", tokensOf(gatesSrc, "status"), DISPLAY.reachability_status, 4);

// 「実測」と名乗れる状態はちょうど二つである(spec.mjs が読み込みで検めるが、
// **この段でも数える** —— 片方だけ緩めたときに、どちらかが必ず鳴る)。
{
  const spend = marks(DISPLAY.overlay_status_entry).filter(([, v]) => v.counts_as_measured === true).map(([k]) => k);
  if (spend.length === 2) ok(`「実測」と名乗れる状態がちょうど二つ(${spend.join(", ")})`);
  else ng("「実測」と名乗れる状態がちょうど二つ", `${spend.length} 件: ${spend.join(", ")}`);
}

// 表を画面が実際に読んでいるか。**読まれない表は飾りである。**
//
// 「印が生成物の字面に在るか」では答えにならない —— 表そのものを JSON として
// 埋め込んでいるので、誰も読まなくても字面には在る。**問うべきは読み手の有無**である。
{
  const build = src("prototype/build.mjs");
  const tables = Object.keys(DISPLAY).filter((k) => !k.startsWith("$") && k !== "source" && k !== "unknown_token");
  const unread = tables.filter((name) => !build.includes(`look("${name}"`));
  if (unread.length) ng("表を画面が読んでいる", `読み手の無い表: ${unread.join(", ")}`);
  else ok(`表を画面が読んでいる(${tables.length} 表)`);
}

// 未知の語の落とし所が在るか。**無ければ、表に無い状態は黙って消えるか、既知の語になる。**
{
  const build = src("prototype/build.mjs");
  const has = build.includes("D.unknown_token") && /return\s*\{\s*\.\.\.D\.unknown_token/.test(build);
  if (has) ok("表に無い語の落とし所が在る");
  else ng("表に無い語の落とし所が在る", "未知の語を受けたときに unknown_token へ落とす経路が見つからない");
}

// 生の英語字句を、**表示の内容として**落とすだけの経路が残っていないか。
//
// 機械が読む属性(`data-reach` など)に字句が在るのは構わない —— 掃引の手掛かりであり、
// 人へ向けた説明ではない。ここが見るのは「語の代わりに字句が出る」経路だけである。
// **この検めは字面であり、届く範囲は狭い。** 実際に語が出ることは browser-display が見る。
{
  const build = src("prototype/build.mjs");
  const raw = [
    ["esc(r.status)}</td>", "到達の状態を、語ではなく生の字句のまま升へ出す経路"],
    ["'<span class=\"st st-' + s + '\">' + s + \"</span>\"", "保証の状態を生の字句だけで出す経路"],
  ].filter(([needle]) => build.includes(needle));
  if (raw.length) ng("生の字句を内容として出す経路が無い", raw.map(([, why]) => why).join(" / "));
  else ok("生の字句を内容として出す経路が無い");
}

console.log(violations.length === 0 && errors.length === 0
  ? `\n全件通過(${checks.length} 件の突き合わせ)`
  : `\n${violations.length} 件の所見 / ${errors.length} 件の異常`);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-19", checker: "build:display-vocabulary", target: "research/system-map",
  examined: checks.length, examined_unit: "語彙の突き合わせ",
  violations, error: errors.length ? errors.join(" / ") : null,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "display-static", records);
process.exit(gateExitCode(records, today.date));
