// **門そのものが発火しなくなる変異**を検出する。
//
//   node test-mutation.mjs [--report <path>] [--today YYYY-MM-DD]
//
// なぜ要るか(ADR-017・ADR-031 決定5): 空判定を合格と呼ばない規則も、SKIP を合格と
// 数えない規則も、**それ自体は守られていない主張**である。守るものが無ければ、
// 一段上で同じ欠陥が起きる —— 実際、開始時点の「PASS 14」がそうだった。
//
// 手: `research/system-map` を一時の置き場へ写し、写しの中だけを潰す。**実物の作業木に
// 触れない。** 潰す先が一箇所でなければ ERROR にする(曖昧な潰しを黙って全箇所へ当てない)。
// 潰したあと、対応する負例が**落ちなくなる**ことを確かめる —— 落ちなくなれば、その規則が
// 判定を支えている証明である。
//
// `tools/mutate-check.mjs` は使えない。あちらの判定は `out/test/*.test.js` だけを回し、
// `research/system-map/**` を含まない。変異を入れても基準線が緑になり、誤って
// 「守られていない」と報告する。
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";


const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");

/** 潰す先と、潰したときに**落ちなくなるはずの**確かめ。 */
const MUTATIONS = [
  {
    // **数を散文へ焼き込む。** 設計の審査が最も多く挙げた過大主張の形である。
    // 台帳を通らない数が出荷物に在れば落ちなければならない。
    label: "画面の散文へ数を焼き込む(台帳を通さない数を出す)",
    file: "prototype/build-system-view.mjs",
    from: `P(\`<h2>10. この画面が描かないこと</h2>`,
    to: `P(\`<h2>10. この画面が描かないこと</h2><p>被覆は 87 パーセントである</p>`,
    run: ["prototype/test-no-authored-facts.mjs"],
    expect: "落ちる",
    rebuild: ["prototype/build-system-view.mjs"],
  },
  {
    // **手書きの模型を画面が読む。** 誰かが繋ぎ直したら鳴らなければならない。
    label: "画面が手書きの模型を読む(繋ぎ直す)",
    file: "prototype/build-system-view.mjs",
    from: `const html = parts.join("\\n");`,
    // 模型のファイル名は**正本から引く**。綴りへ書くと単一正本の規則が咎める(実測で咎められた)。
    to: `P("<p>" + esc(JSON.parse(readFileSync(join(here,"..","gold-model","MODEL-does-not-exist.json"),"utf8")).elements[0].purpose) + "</p>");\nconst html = parts.join("\\n");`,
    run: ["prototype/test-no-authored-facts.mjs"],
    expect: "落ちる",
    rebuild: ["prototype/build-system-view.mjs"],
  },
  {
    // 出荷していた欠陥そのものを復元する潰し —— 汚れた木でも「同一(照合済)」と
    // 断言していた。宣言(上流 ICD-002)から導いた表が鳴らなければ、規則は飾りである。
    label: "鮮度の規則から汚れの条件を落とす(汚れた木を「同一」と断言させる)",
    file: "lib/rev-state.mjs",
    from: "  if (currentDirty !== false) return \"unknown\";",
    to: "  if (false) return \"unknown\";",
    run: ["prototype/test-rev-state.mjs"],
    expect: "落ちる",
  },
];

const work = mkdtempSync(join(tmpdir(), "system-map-mutation-"));
cpSync(src, join(work, "system-map"), { recursive: true });
const copy = join(work, "system-map");
// 複製は木の外に在るので、`node_modules` の解決が上へ辿っても届かない。
// 繋ぎを一つ張る。**基準線が別の理由で赤くなると、潰しの結果を読み違える**
// (実測: ajv を取り込めずに全ての基準線が赤くなり、「規則が支えていない」と誤報した)。
try { symlinkSync(join(src, "..", "..", "node_modules"), join(work, "node_modules"), "dir"); } catch { /* 既に在る */ }
const originals = new Map();
for (const m of MUTATIONS) originals.set(m.file, readFileSync(join(copy, m.file), "utf8"));

const runIn = (args) => {
  try {
    execFileSync("node", [join(copy, args[0]), ...args.slice(1)], { cwd: join(copy, dirname(args[0])), stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

let checked = 0;
const violations = [];

// 先に基準線。潰していない状態で、確かめが期待どおりの側に在ること。
for (const m of MUTATIONS) {
  const base = runIn(m.run);
  const wantBase = m.expect === "落ちる" ? 0 : 1;
  if (base !== wantBase) {
    violations.push({ code: "mutation.baseline", message: `基準線が想定と違う(${m.label}): 終了コード ${base}(期待 ${wantBase})` });
  }
}

for (const m of MUTATIONS) {
  checked++;
  const path = join(copy, m.file);
  const before = originals.get(m.file);
  const n = before.split(m.from).length - 1;
  if (n !== 1) {
    violations.push({ code: "mutation.ambiguous", message: `${m.label}: 潰す先が ${n} 箇所(1 でない)。表が古いか、潰し方が曖昧である` });
    console.log(`NG   ${m.label} — 潰す先が ${n} 箇所`);
    continue;
  }
  writeFileSync(path, before.replace(m.from, m.to), "utf8");
  // 生成物を判ずる潰しは、**壊してから作り直さないと効かない** ——
  // 出荷物は build が書く物であり、綴りを壊しただけでは古い出荷物が残る。
  if (m.rebuild) runIn(m.rebuild);
  const after = runIn(m.run);
  writeFileSync(path, before, "utf8");
  if (m.rebuild) runIn(m.rebuild); // 次の潰しのために出荷物を戻す

  const caught = m.expect === "落ちる" ? after !== 0 : after === 0;
  if (caught) console.log(`ok   ${m.label} — 潰すと${m.expect}(規則が判定を支えている)`);
  else {
    violations.push({ code: "mutation.not_caught", message: `${m.label}: 潰しても${m.expect === "落ちる" ? "落ちない" : "赤のまま"}(終了コード ${after})。この規則は判定を支えていない` });
    console.log(`NG   ${m.label} — 潰しても変わらない(終了コード ${after})`);
  }
}

rmSync(work, { recursive: true, force: true });
console.log(violations.length === 0 ? `\n全件通過(${checked} 個の潰し)` : `\n${violations.length} 件の所見`);
for (const v of violations) console.log(`  - ${v.message}`);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-N3", checker: "meta:rules-load-bearing", target: "research/system-map",
  examined: checked, examined_unit: "潰し", violations,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "mutation", records);
process.exit(gateExitCode(records, today.date));
