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

// 表の語が生成物へ実際に届いているか。**表を作っただけで画面が使っていない**なら、
// 表は飾りである。
{
  const html = src("prototype/index.html");
  const tables = ["review_status", "verification_status", "reachability_status", "anchor_verdict", "overlay_status_entry", "rev_state", "element_kind", "anchor_kind"];
  const absent = [];
  for (const name of tables) {
    for (const [k, v] of marks(DISPLAY[name])) {
      if (!html.includes(v.mark)) absent.push(`${name}.${k}(${v.mark})`);
    }
  }
  if (!html.includes(DISPLAY.unknown_token.mark)) absent.push(`unknown_token(${DISPLAY.unknown_token.mark})`);
  if (absent.length) ng("表の語が生成物に届いている", `生成物に現れない語: ${absent.join(", ")}`);
  else ok("表の語が生成物に届いている");
}

// 生の英語字句を画面へ落とすだけの経路が残っていないか。
{
  const build = src("prototype/build.mjs");
  const raw = [
    ['esc(r.status)', "到達の状態を生の字句で出す経路"],
    ["'<span class=\"st st-' + s + '\">' + s + \"</span>\"", "保証の状態を生の字句だけで出す経路"],
  ].filter(([needle]) => build.includes(needle));
  if (raw.length) ng("生の字句へ落ちる経路が無い", raw.map(([, why]) => why).join(" / "));
  else ok("生の字句へ落ちる経路が無い");
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
