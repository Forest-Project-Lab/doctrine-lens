// M-14 の正・負の試験 — 門が実際に発火することを、本番と同じ計算経路で確かめる。
//
//   node test-gates.mjs
//
// 負の試験は「実際のモデル、または画面遷移の構造を変えたもの」を computeOpsRows へ
// 与えて落とす(所有者判定 §6: 判定器へ {ops:4} を直接渡す形を禁じる)。
// 3 操作・4 操作・リンク切れ・明示的な対象外を別々に試験する。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeOpsRows, assertM14, checkNoRuntimeFetch, UI_STRUCTURE } from "./gates.mjs";
// 対象の一覧と操作数の上限は registry.json が正本。ここでは持たない。
import { loadModels, MAX_OPS } from "../gold-model/spec.mjs";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";
import { parseAnchorTarget } from "../lib/anchor-target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const realModels = loadModels("gates");
const clone = (x) => JSON.parse(JSON.stringify(x));

let failures = 0, checks = 0;
const failed = [];
const t = (name, fn) => {
  checks++;
  try { fn(); console.log("ok   " + name); }
  catch (e) {
    failures++;
    const why = e.message.split("\n")[0];
    failed.push(name + " — " + why);
    console.log("NG   " + name + " — " + why);
  }
};
const expectThrow = (fn, name) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  if (msg === null) throw new Error(name + " が発火しなかった(負の入力を通した)");
  return msg;
};

// ---- 正: 現物 ----
t("正: 現物の四対象は実操作(親=選ぶ+開く=2、子=降りる+選ぶ+開く=3)で全て到達・NA・超過なし", () => {
  const rows = computeOpsRows(realModels);
  const { max, reachable, na } = assertM14(rows, MAX_OPS);
  if (max > 3) throw new Error("max=" + max);
  const child = rows.find((r) => r.element === "lens.model");
  if (child.ops !== 3) throw new Error("子要素の実操作が 3 でない: " + child.ops);
  const top = rows.find((r) => r.element === "lens" && r.target === "doctrine-and-lens");
  if (top.ops !== 2) throw new Error("親要素の実操作が 2 でない: " + top.ops);
  if (reachable === 0) throw new Error("到達可能な要素が零(配線が死んでいる)");
  if (na === 0) throw new Error("明示 NA が零(人・外部系の NA が消えた)");
});

// ---- 負: 画面遷移を深くする(同じ計算経路) ----
t("負: 展開を 1 段挟む画面遷移にすると子が 4 操作になり落ちる", () => {
  const deepUi = { ...UI_STRUCTURE, extraExpands: 1 };
  const msg = expectThrow(() => assertM14(computeOpsRows(realModels, deepUi), MAX_OPS), "M-14(4 操作)");
  if (!/操作超過/.test(msg)) throw new Error("落ちた理由が操作超過でない: " + msg);
});

t("負: 境界 — 親のみの最小モデルで展開 1 段(計 3)は通り、2 段(計 4)は落ちる", () => {
  const mini = [{
    target: "mini", elements: [{ id: "top", parent: null, realized_by: ["a"] }],
    contracts: [], anchors: [{ id: "a", target_kind: "code_range", url: "https://example.com/x" }],
  }];
  assertM14(computeOpsRows(mini, { ...UI_STRUCTURE, extraExpands: 1 }), MAX_OPS);
  expectThrow(() => assertM14(computeOpsRows(mini, { ...UI_STRUCTURE, extraExpands: 2 }), MAX_OPS), "境界");
});

// ---- 負: モデルを実際に壊す(同じ計算経路) ----
t("負: realized_by が実在しない anchor を指すと「壊れた参照」で落ちる", () => {
  const broken = clone(realModels);
  broken[0].elements.find((e) => e.id === "lens.model").realized_by = ["no-such-anchor"];
  const msg = expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "リンク切れ");
  if (!/壊れた参照/.test(msg)) throw new Error("落ちた理由が壊れた参照でない: " + msg);
});

t("負: anchor から URL を消すと「壊れた参照」で落ちる", () => {
  const broken = clone(realModels);
  delete broken[0].anchors.find((a) => a.id === "a-consequence-code").url;
  expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "URL 無し");
});

t("負: document アンカーを実現先に渡すと種別で落ちる(文書は Code/Test/Evidence でない)", () => {
  const broken = clone(realModels);
  broken[0].elements.find((e) => e.id === "lens.model").realized_by = ["a-req000"]; // document
  const msg = expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "document 種別");
  if (!/実現先にならない/.test(msg)) throw new Error("落ちた理由が種別でない: " + msg);
});

t("負: artifact アンカー(リポジトリ tree)を実現先に渡すと種別で落ちる", () => {
  const broken = clone(realModels);
  broken[0].elements.find((e) => e.id === "lens.model").realized_by = ["a-lens-repo"]; // artifact
  expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "artifact 種別");
});

t("負: 必須属性の欠けた証拠は「壊れ」で落ちる(NA でない要素の契約で検証)", () => {
  const broken = clone(realModels);
  const c = broken[0].contracts.find((c) => c.id === "c-lens-honest"); // subject=lens(到達可能要素)
  delete c.evidence[0].environment; // 証跡最小形を欠く
  const msg = expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "証拠属性");
  if (!/必須属性/.test(msg)) throw new Error("落ちた理由が証拠属性でない: " + msg);
});

t("負: 実現も明示 NA も無い要素(provenance だけ)は「未登録」で落ちる", () => {
  const broken = clone(realModels);
  const e = broken[0].elements.find((e) => e.id === "maintainer");
  delete e.realization; // provenance は残る — 代用にならないことの証明
  const msg = expectThrow(() => assertM14(computeOpsRows(broken), MAX_OPS), "未登録");
  if (!/未登録/.test(msg)) throw new Error("落ちた理由が未登録でない: " + msg);
});

// ---- 正: 明示 NA の扱い ----
t("正: 明示 NA(理由つき)は許され、到達判定から除外される", () => {
  const rows = computeOpsRows(realModels);
  const nas = rows.filter((r) => r.status === "not_applicable");
  if (!nas.length) throw new Error("NA 行が無い");
  if (!nas.every((r) => r.note && r.note.length > 0)) throw new Error("理由の無い NA が居る");
});

// ---- アンカーの指す先の文法(M-17)。null を返さないこと ----
t("正: リポジトリ接頭つきの経路を、接頭と経路と注記へ分ける", () => {
  const r = parseAnchorTarget("doctrine: plugin/scripts/trace-index.py(SPEC-026 の注釈対)");
  if (r.kind !== "path") throw new Error("種別が path でない: " + r.kind);
  if (r.repo !== "doctrine") throw new Error("接頭が違う: " + r.repo);
  if (r.path !== "plugin/scripts/trace-index.py") throw new Error("経路が違う: " + r.path);
  if (!r.note) throw new Error("注記を落とした");
});
t("正: 経路の中の空白と日本語を落とさない", () => {
  const r = parseAnchorTarget("doctrine-lens: src/画面/my file.ts");
  if (r.kind !== "path" || r.path !== "src/画面/my file.ts") throw new Error(JSON.stringify(r));
});
t("正: Windows の区切りを / へ揃える", () => {
  const r = parseAnchorTarget("doctrine-lens: src\\model\\view.ts");
  if (r.kind !== "path" || r.path !== "src/model/view.ts") throw new Error(JSON.stringify(r));
});
t("正: URL はそのまま URL として扱う", () => {
  const r = parseAnchorTarget("https://example.com/x");
  if (r.kind !== "url") throw new Error(JSON.stringify(r));
});
t("負: 接頭の無い裸の経路は path にしない(跨リポジトリの取り違えの元)", () => {
  const r = parseAnchorTarget("src/model/consequence.ts(注釈対)");
  if (r.kind !== "prose") throw new Error("裸の経路を path として通した: " + JSON.stringify(r));
});
t("負: 絶対経路と .. は invalid", () => {
  if (parseAnchorTarget("doctrine-lens: /etc/passwd").kind !== "invalid") throw new Error("絶対経路を通した");
  if (parseAnchorTarget("doctrine-lens: ../../x").kind !== "invalid") throw new Error(".. を通した");
});
t("負: 駆動器名(C:/x)を接頭と読み違えない", () => {
  const r = parseAnchorTarget("C:/Users/x/file.ts");
  if (r.kind === "path" && r.repo === "C") throw new Error("駆動器名を接頭と読んだ");
});

// ---- M-13(静的側)の発火 ----
t("M-13 静的・正: 現物の index.html に fetch/XHR の綴りが無い", () => {
  const html = readFileSync(join(here, "index.html"), "utf8");
  if (!checkNoRuntimeFetch(html)) throw new Error("現物に fetch/XHR が在る");
});
t("M-13 静的・負: fetch( / XMLHttpRequest を仕込むと検出される", () => {
  if (checkNoRuntimeFetch("<script>fetch('https://x')</script>")) throw new Error("fetch を見逃した");
  if (checkNoRuntimeFetch("<script>new XMLHttpRequest()</script>")) throw new Error("XHR を見逃した");
});

console.log(failures === 0 ? "\n全件通過" : `\n${failures} 件の失敗`);

// 判定の記録。ここが検めているのは模型ではなく **門そのものが発火するか** である。
// 負の入力を通してしまう門は、緑に見えても何も守っていない。
const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-N1", checker: "meta:gate-fires", target: "M-13/M-14 の計算経路",
  examined: checks, examined_unit: "正負の試験",
  violations: failed.map((n) => ({ code: "meta.gate_did_not_fire", message: n })),
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "unit", records);
process.exit(gateExitCode(records, today.date));
