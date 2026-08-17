// 出荷する画面が、**宣言済み読み口が返した値だけ**から出来ていることを検める。
//
//   node test-no-authored-facts.mjs [--report <path>] [--today YYYY-MM-DD]
//
// なぜ要るか: 所有者決定(2026-08-16)により、Lens は view に徹し、画面が要る事実は全て
// doctrine が管理する。手で書いた模型は統治木へ移すまで木の中に残る ——
// **残っている限り、誰か(人でも LLM でも)が画面へ繋ぎ直せてしまう。**
// 繋ぎ直しても門が黙っていれば、「実測の画面ができた」という誤解がそのまま出荷される。
//
// 二つを検める。
//
//   M-V1  手書きが混ざっていない。模型の字句も、捕獲の道具が書いた散文も、画面に出ない
//   M-V2  **画面に出る数が、全て build の台帳に載っている**
//
// M-V2 が要である。散文へ数を焼き込むと、焼いたその日のうちに古びる —— 設計の審査で
// 実測された(印の無いファイル 142→146、所見 36→52、8→24)。台帳を通らない数を落とせば、
// 焼き込む経路そのものが閉じる。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const SHIPPED = join(here, "system-view.html");
const LEDGER = join(here, "system-view.provenance.json");
const SURFACES = join(root, "surfaces", "surfaces.json");
const MODEL_DIR = join(root, "gold-model");

const mk = () => ({ checks: [], violations: [], errors: [] });
const V1 = mk(), V2 = mk();
const ok = (g, what) => { g.checks.push(what); console.log(`ok   ${what}`); };
const ng = (g, code, what, why) => { g.checks.push(what); g.violations.push({ code, message: `${what}: ${why}` }); console.log(`NG   ${what} — ${why}`); };
const err = (g, what, why) => { g.checks.push(what); g.errors.push(`${what}: ${why}`); console.log(`ERR  ${what} — ${why}`); };

/** JSON の中の文字列を全て集める(値だけ)。 */
function stringsOf(node, out = new Set()) {
  if (typeof node === "string") { out.add(node); return out; }
  if (Array.isArray(node)) { node.forEach((v) => stringsOf(v, out)); return out; }
  if (node && typeof node === "object") { Object.values(node).forEach((v) => stringsOf(v, out)); return out; }
  return out;
}

const shipped = existsSync(SHIPPED) ? readFileSync(SHIPPED, "utf8") : null;
if (!shipped) err(V1, "出荷物を読む", `${SHIPPED} が無い。先に build-system-view.mjs を回すこと`);

// ---------------------------------------------------------------- M-V1
const modelFiles = existsSync(MODEL_DIR) ? readdirSync(MODEL_DIR).filter((f) => /^(target-|fixture-).*\.json$/.test(f)) : [];
if (modelFiles.length === 0) err(V1, "手書き模型を見つける", `${MODEL_DIR} に target-*/fixture-* が一つも無い。走査が壊れている疑いがある`);

const authored = new Set();
for (const f of modelFiles) stringsOf(JSON.parse(readFileSync(join(MODEL_DIR, f), "utf8")), authored);

// **捕獲そのものにも手書きの散文が在る。** capture.mjs が各口へ添えた `why`、
// 最上位の `$comment`・`captured_from`・`same_tree_reason` は、測定値ではなく人が書いた字である。
// 測定値の顔をして画面に出れば、手書きを排した意味が無くなる。
const capturePr = new Set();
if (existsSync(SURFACES)) {
  const cap = JSON.parse(readFileSync(SURFACES, "utf8"));
  for (const k of ["$comment", "same_tree_reason"]) if (typeof cap[k] === "string") capturePr.add(cap[k]);
  stringsOf(cap.captured_from ?? {}, capturePr);
  for (const s of cap.surfaces ?? []) if (typeof s.why === "string") capturePr.add(s.why);
} else {
  err(V1, "読み口の捕獲を読む", `${SURFACES} が無い。先に surfaces/capture.mjs を回すこと`);
}

/**
 * 読み口が返した値の全文。**部分一致で照合する。**
 *
 * 完全一致だと偽陽性が出る —— 実測で二件出た。`Forest-Project-Lab` は文書が front-matter で
 * 挙げた URL の一部として口が返しており、**手書き模型そのものの名**は
 * **上流の道具がその手書き模型そのものについて挙げた所見の `path`** として返している。
 * どちらも画面が模型を読んだのではなく、**道具が測って返した値**である。
 * 咎めれば、道具が我々の木を正しく測ったことを咎めることになる。
 */
let measuredText = "";
if (existsSync(SURFACES)) {
  const cap = JSON.parse(readFileSync(SURFACES, "utf8"));
  measuredText = JSON.stringify((cap.surfaces ?? []).map((s) => s.data ?? null));
}
const isMeasured = (s) => measuredText.includes(s);

/** 咎める候補。短い字・記号だけの字は落とす(偶然一致しても何も言えない)。 */
const distinctive = (s) => {
  const t = String(s).trim();
  if (t.length < 6) return false;
  if (t.length < 12 && !/[ぁ-んァ-ン一-龥]/.test(t)) return false;
  return true;
};
const candidates = [...authored].filter((s) => !isMeasured(s) && distinctive(s));
const proseCands = [...capturePr].filter(distinctive);

const MIN = 100;
if (candidates.length < MIN) err(V1, "手書き模型にだけ在る字句を採る", `候補が ${candidates.length} 件しかない(下限 ${MIN})。走査が壊れている疑いがある —— 「混ざっていない」と読み替えない`);
else ok(V1, `手書き模型にだけ在る字句を採る(${candidates.length} 件)`);

if (proseCands.length < 3) err(V1, "捕獲の散文を採る", `候補が ${proseCands.length} 件しかない(下限 3)。capture.mjs の綴りと食い違っている疑いがある`);
else ok(V1, `捕獲の散文を採る(${proseCands.length} 件)`);

if (shipped) {
  const leaked = candidates.filter((s) => shipped.includes(s));
  if (leaked.length) ng(V1, "screen.authored_fact_leak", "出荷物に手書き模型の字句が無い", `${leaked.length} 件が在る。例: ${leaked.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 44))).join(" / ")}`);
  else ok(V1, `出荷物に手書き模型の字句が無い(${candidates.length} 件を照合)`);

  const prose = proseCands.filter((s) => shipped.includes(s));
  if (prose.length) ng(V1, "screen.capture_prose_leak", "出荷物に捕獲の散文が無い", `${prose.length} 件が在る。例: ${prose.slice(0, 2).map((s) => JSON.stringify(s.slice(0, 44))).join(" / ")}`);
  else ok(V1, `出荷物に捕獲の散文が無い(${proseCands.length} 件を照合)`);

  // 名指しも同じ規律で見る。道具が所見の `path` としてその名を返したなら、それは測定値である。
  const named = modelFiles.filter((f) => shipped.includes(f) && !isMeasured(f));
  if (named.length) ng(V1, "screen.model_file_named", "出荷物が手書き模型を名指していない", named.join(", "));
  else ok(V1, "出荷物が手書き模型を名指していない");

  // 環境の漏れ。機械をまたいで共有する頁に、他人の置き場と走行の id を刻まない。
  const env = [["/workspaces/", "絶対経路"], ["/home/", "絶対経路"], ['"session"', "走行の識別子"]].filter(([p]) => shipped.includes(p));
  if (env.length) ng(V1, "screen.environment_leak", "出荷物に環境が漏れていない", env.map(([p, w]) => `${p}(${w})`).join(" / "));
  else ok(V1, "出荷物に環境が漏れていない");

  // 偽の到達路を作らない。押せる連結も外部の取得も置かない。
  const inter = [["<script", "script"], ["<a href", "連結"], ["<button", "釦"], ["<select", "選択欄"], ["<input", "入力欄"], ["src=", "外部の取得"]].filter(([p]) => shipped.includes(p));
  if (inter.length) ng(V1, "screen.interactive_element", "押せる連結も外部の取得も無い", inter.map(([, w]) => w).join(" / "));
  else ok(V1, "押せる連結も外部の取得も無い");
}

// ---------------------------------------------------------------- M-V2
if (!existsSync(LEDGER)) err(V2, "数の台帳を読む", `${LEDGER} が無い。build-system-view.mjs が書くはずの物である`);
else if (shipped) {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  if (ledger.schema !== "system-map/number-ledger/1") err(V2, "数の台帳の形", `想定外の schema: ${ledger.schema}`);
  const known = new Set((ledger.numbers ?? []).map((n) => String(n.value)));

  let text = shipped
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    // 生の返り値は口が返した値そのものである(build が組み立てた散文ではない)。
    .replace(/<pre>[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ");
  // 数ではない綴りを落とす。**白名簿は狭く保つ** —— 広げると本物の焼き込みを見逃す。
  text = text
    .replace(/\b[A-Z][A-Z0-9]*-\d+[a-z]?\b/g, " ")   // SPEC-006・ADR-172・M-14 のような id
    .replace(/\bsha256:[0-9a-f]+\b/g, " ")            // 指紋
    .replace(/\b[0-9a-f]{7,}\b/g, " ")                // rev
    .replace(/\b\d+\.\d+(\.\d+)?\b/g, " ");           // 道具の版

  const found = [...text.matchAll(/\d+/g)].map((m) => m[0]);
  const MIN_NUMS = 40;
  if (found.length < MIN_NUMS) {
    err(V2, "本文から数を採る", `${found.length} 件しか採れない(下限 ${MIN_NUMS})。走査が壊れている疑いがある —— 「台帳に載っている」と読み替えない`);
  } else {
    ok(V2, `本文から数を採る(${found.length} 件・相異なり ${new Set(found).size})`);
    const orphan = [...new Set(found)].filter((d) => !known.has(d));
    if (orphan.length) ng(V2, "screen.number_without_provenance", "画面の数が全て台帳に載っている", `台帳に無い数が ${orphan.length} 種: ${orphan.slice(0, 12).join(" ")} —— 綴りへ焼き込んだ数の疑いがある`);
    else ok(V2, `画面の数が全て台帳に載っている(台帳 ${known.size} 種)`);
  }

  // 台帳の各項が出所を名乗ること。名乗らない数は、出所を辿れないので焼き込みと区別できない。
  const noFrom = (ledger.numbers ?? []).filter((n) => !n.from || String(n.from).trim() === "");
  if (noFrom.length) ng(V2, "screen.ledger_without_source", "台帳の全ての数が出所を名乗る", `${noFrom.length} 件が出所を持たない`);
  else ok(V2, `台帳の全ての数が出所を名乗る(${(ledger.numbers ?? []).length} 件)`);
}

const all = [...V1.violations, ...V2.violations];
const anyErr = [...V1.errors, ...V2.errors];
console.log(all.length === 0 && anyErr.length === 0
  ? `\n全件通過(${V1.checks.length + V2.checks.length} 件の検め)`
  : `\n${all.length} 件の所見 / ${anyErr.length} 件の異常`);

const today = todayFrom(process.argv.slice(2));
const records = [
  verdict({
    invariant: "M-V1", checker: "screen:no-authored-facts", target: "index.html",
    examined: V1.checks.length, examined_unit: "検め",
    violations: V1.violations, error: V1.errors.length ? V1.errors.join(" / ") : null,
  }),
  verdict({
    invariant: "M-V2", checker: "screen:numbers-have-provenance", target: "index.html",
    examined: V2.checks.length, examined_unit: "検め",
    violations: V2.violations, error: V2.errors.length ? V2.errors.join(" / ") : null,
  }),
];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "no-authored-facts", records);
process.exit(gateExitCode(records, today.date));
