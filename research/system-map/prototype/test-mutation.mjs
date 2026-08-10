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
import { TARGETS } from "../gold-model/spec.mjs";

// 模型のファイル名を手書きしない(正本は registry.json)。id で引く。
const fileOf = (id) => TARGETS.find((t) => t.id === id)?.file ?? (() => { throw new Error(`対象 ${id} が registry に無い`); })();

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");

/** 潰す先と、潰したときに**落ちなくなるはずの**確かめ。 */
const MUTATIONS = [
  {
    label: "空判定の規則を潰す(見た件数 0 でも合格を名乗れるようにする)",
    file: "gold-model/report.mjs",
    from: "  if (examined === 0) {",
    to: "  if (false) {",
    // 潰すと、空を VACUOUS と期待する負例が PASS になって落ちる。
    run: ["prototype/test-negatives.mjs"],
    expect: "落ちる",
  },
  {
    label: "「PASS 以外は合格でない」を潰す",
    file: "gold-model/report.mjs",
    from: "  if (records.some((r) => !countsAsPass(r.verdict) && !ackFor(r, today))) return 1;",
    to: "  // 潰した",
    // 潰すと、了解の無い VACUOUS を持つ走行が緑になる(=検出できなくなる)。
    run: ["gold-model/validate.mjs", fileOf("celery"), "--today", "2027-01-01"],
    expect: "緑になる",
  },
  {
    label: "了解の期限の判定を潰す",
    file: "gold-model/report.mjs",
    from: "  if (today && a.expires_at < today) return null;",
    to: "  // 潰した",
    run: ["gold-model/validate.mjs", fileOf("celery"), "--today", "2027-01-01"],
    expect: "緑になる",
  },
  {
    label: "実現先の種別の検めを潰す",
    file: "prototype/gates.mjs",
    from: "    if (!REALIZATION_KINDS.includes(a.target_kind)) {",
    to: "    if (false) {",
    run: ["prototype/test-negatives.mjs"],
    expect: "落ちる",
  },
  {
    label: "アンカーの文法の検めを潰す",
    file: "lib/anchor-target.mjs",
    from: '    if (p.kind === "url" || p.kind === "path") continue;',
    to: "    continue;",
    run: ["prototype/test-negatives.mjs"],
    expect: "落ちる",
  },
  {
    label: "対象を id で指す規則を潰す(画面の値を位置へ戻す)",
    file: "prototype/build.mjs",
    from: '<option value="${escHtml(m.target)}">',
    to: '<option value="${models.indexOf(m)}">',
    // 潰すと、合成の対象を差した写しで「対象を id で名指す」が落ちる。
    run: ["prototype/test-targets-wired.mjs"],
    expect: "落ちる",
  },
  {
    label: "空の実測を拒む規則を潰す(記録 0 件でも実測を名乗れるようにする)",
    file: "prototype/build.mjs",
    from: "    if ((n === 0) !== (o.status === OVERLAY_EMPTY_STATUS)) {",
    to: "    if (false) {",
    // 潰すと、記録 0 件で measured を名乗る入力が通ってしまい、負例が落ちなくなる。
    run: ["prototype/test-targets-wired.mjs"],
    expect: "落ちる",
  },
  {
    label: "未知の語の落とし所を潰す(表に無い状態を実測へ黙って寄せる)",
    file: "prototype/build.mjs",
    from: "  return { ...D.unknown_token, mark: D.unknown_token.mark + \": \" + String(token), __unknown: true };",
    to: "  return { mark: \"実測\", sentence: \"\", has_ranges: true, counts_as_measured: true };",
    run: ["prototype/test-display-browser.mjs"],
    expect: "落ちる",
  },
  {
    label: "項目単位の候補表示を潰す(印から機械の手掛かりを外す)",
    file: "prototype/build.mjs",
    from: '  return \'<span class="rv rv-\' + esc(s) + \'" data-review="\' + esc(s) + \'"',
    to: '  return \'<span class="rv rv-\' + esc(s) + \'" data-was-review="\' + esc(s) + \'"',
    run: ["prototype/test-display-browser.mjs"],
    expect: "落ちる",
  },
  {
    label: "架空の印を潰す(registry の fictional を偽にする)",
    file: "gold-model/registry.json",
    from: '"fictional": true',
    to: '"fictional": false',
    // 潰すと、架空の対象が実在の対象と見分けがつかなくなる。
    run: ["prototype/test-display-browser.mjs"],
    expect: "落ちる",
  },
  {
    label: "伝送不成立の扱いを潰す(開けなかったことを「別の場所へ開いた」と数える)",
    file: "prototype/test-m14-browser.mjs",
    // 伝送そのものが成立しなかったのか、別の場所へ開いたのかを分けているのがここ。
    // `&& !openedFailed` を落とすと、通信の途絶が**リンクの破損**として報告される。
    from: "(!okOpen && !openedFailed)",
    to: "(!okOpen)",
    // 潰すと、伝送が成立しない環境で SKIP でなく FAIL が出る。
    // 写しの中では製品の木(src/)へ届かないので、この一件だけを回す。
    run: ["prototype/test-chaos.mjs", "--only", "伝送が成立しない環境"],
    expect: "落ちる",
  },
  {
    label: "12 節へ畳んだ中身を作る(実装・証拠へ行くのに操作が増える)",
    file: "prototype/build.mjs",
    from: "    <h3>12. Code / Test / Evidence(実現と証拠)</h3>",
    to: "    <h3>12. Code / Test / Evidence(実現と証拠)</h3><details><summary>実装と証拠</summary></details>",
    // 台帳 v3.2-16 の操作数の予算(3)は、入れ子の要素で既に上限である。
    // 一つ畳むだけで超える。**構造で守る。**
    run: ["prototype/test-display-browser.mjs"],
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
  const after = runIn(m.run);
  writeFileSync(path, before, "utf8");

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
