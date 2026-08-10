// 壊れた環境・落ちた道具・競合する走行のもとで、道具が**黙って誤らない**ことを検める。
//
//   node test-chaos.mjs [--report <path>] [--today YYYY-MM-DD] [--only <語>]
//
// `--only` は**試験の道具立てのための口**である(変異の表がここから一件だけ回す)。
// 掃引を狭めるので、使うと見た件数が減る —— 減ったことは判定の記録に出るし、
// 走行の頭にも刷る。**本番の一括判定からは渡さない。**
//
// なぜ要るか: 門が緑なのは「壊れていない環境で回したから」かもしれない。壊れ方を
// **決定論的に注入**して、そのとき道具が何と言うかを固定する。言うべきは二つに一つ
// —— 判定を出すか、明示の非合格で止まるか。**黙って正常値へ落ちるのが最も悪い。**
//
// 手: 一時の置き場と写しだけを使う。実物の台帳・利用者環境・出荷物に触れない。
// **sleep で競合を再現しない** —— 継ぎ目を注入し、どの瞬間にも成り立つ不変条件を assert する。
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";
import { TARGETS } from "../gold-model/spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repoRoot = join(root, "..", "..");
const today = todayFrom(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "system-map-chaos-"));

const cases = [];
const only = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i + 1] : null; })();
if (only) console.log(`※ --only 指定: 「${only}」を含む検めだけを回す(掃引を狭めている)`);
const brief = (s, n = 220) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const check = async (what, fn) => {
  if (only && !what.includes(only)) return;
  try {
    const why = await fn();
    cases.push({ what, violation: why ? { code: "chaos.silent_wrong", message: `${what}: ${why}` } : null });
    console.log((why ? "NG   " : "ok   ") + what + (why ? ` — ${why}` : ""));
  } catch (e) {
    cases.push({ what, violation: { code: "chaos.check_threw", message: `${what}: 検めが例外で止まった — ${brief(e.message)}` } });
    console.log(`NG   ${what} — 検めが例外で止まった: ${brief(e.message)}`);
  }
};

const run = (bin, args, opts = {}) => {
  try {
    const stdout = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? "").toString(), stderr: (e.stderr ?? "").toString(), signal: e.signal };
  }
};

const dir = (name) => { const p = join(work, name); mkdirSync(p, { recursive: true }); return p; };

/** 中身を決めた偽の python を置く。**本物を呼ばずに、返す値だけを差し替える。** */
function fakePython(name, body) {
  const d = dir(`py-${name}`);
  const p = join(d, "python3");
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

/** 版だけを名乗る偽の doctrine の導入。commit は持たない(cache から引いた形)。 */
function fakePlugin(version) {
  const cfg = dir(`cfg-${version}`);
  const rootDir = join(cfg, "plugins", "cache", "forest-project-lab", "doctrine", version);
  mkdirSync(join(rootDir, "scripts"), { recursive: true });
  mkdirSync(join(rootDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(rootDir, "scripts", "docs-audit.py"), "", "utf8");
  writeFileSync(join(rootDir, "scripts", "trace-index.py"), "", "utf8");
  writeFileSync(join(rootDir, ".claude-plugin", "plugin.json"), JSON.stringify({ version }), "utf8");
  writeFileSync(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: {} }), "utf8");
  return { configDir: cfg, root: rootDir };
}

const overlayBin = join(root, "overlay", "build-overlay.mjs");
const buildBin = join(here, "build.mjs");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 一つの対象の overlay を、注入した継ぎ目で作って読む。 */
function produceOverlay(id, extra) {
  const out = dir(`ov-${id}`);
  const res = run(process.execPath, [overlayBin, "--out-dir", out, "--allow-dirty", ...extra], { cwd: join(root, "overlay") });
  const files = existsSync(out) ? readdirSync(out).filter((n) => n.endsWith(".json")) : [];
  return { res, out, docs: files.map((n) => JSON.parse(readFileSync(join(out, n), "utf8"))) };
}

/** 実測の候補を持つ対象の記録だけを見る(候補 0 件の対象は継ぎ目を通らない)。 */
const withEntries = (docs) => docs.find((d) => (d.entries ?? []).length > 0);

// ------------------------------------------------------------- 上流の固定

await check("固定とずれた実体を掴んだとき、家風の失敗で止まる(生のスタックを吐かない)", async () => {
  const { configDir } = fakePlugin("0.0.1-合わない版");
  const r = run(process.execPath, [overlayBin, "--print-plan"], {
    cwd: join(root, "overlay"), env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, SYSTEMMAP_DOCTRINE_PATH: "" },
  });
  if (r.code === 0) return "固定とずれているのに通した";
  const out = r.stderr + r.stdout;
  if (/at .*\n/.test(out) && /Error: Command failed/.test(out)) return `生の Node のスタックを吐いている: ${brief(out)}`;
  if (r.code !== 2) return `終了コードが 2 でない(${r.code})。この木では「使い方・環境の誤り」は 2 である`;
  return /固定/.test(out) ? null : `理由が固定のずれだと言っていない: ${brief(out)}`;
});

await check("版が合っても commit を確かめられないことを、確かめられると言わない", async () => {
  const { configDir } = fakePlugin("0.11.0");
  const bin = join(repoRoot, "tools", "doctrine-path.mjs");
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, SYSTEMMAP_DOCTRINE_PATH: "" };
  const pinned = run(process.execPath, [bin, "--json", "--require-pin"], { env });
  if (pinned.code !== 0) return `版が合う実体で --require-pin が通らない(${pinned.code})`;
  const j = JSON.parse(pinned.stdout);
  if (j.commit) return "偽の導入が commit を名乗っている(この検めが成り立たない)";
  if (j.pin_state === "matched") return `commit を知らないのに pin_state が matched である(${j.pin_state})。版だけの一致を、完全な一致と呼んでいる`;
  const strict = run(process.execPath, [bin, "--require-commit"], { env });
  return strict.code === 3 ? null : `--require-commit が commit 不明の実体を通した(終了コード ${strict.code})`;
});

// ------------------------------------------------------- 落ちた道具・答えない CLI

const FAKE_DOCTRINE = dir("doctrine-fake");
mkdirSync(join(FAKE_DOCTRINE, "scripts"), { recursive: true });
writeFileSync(join(FAKE_DOCTRINE, "scripts", "trace-index.py"), "", "utf8");
const base = ["--doctrine", FAKE_DOCTRINE, "--repo", `doctrine-lens=${repoRoot}`, "--docs-root", `doctrine-lens=${join(repoRoot, "doctrine_docs")}`];

for (const [id, body, want] of [
  ["empty", "exit 0", /空/],
  ["notjson", 'echo "これは JSON ではない"', /JSON/],
  ["badschema", `echo '{"schema":"trace-index/99","ranges":[],"findings":[]}'`, /schema/],
  ["fail", "exit 3", /失敗|終了/],
]) {
  await check(`CLI が答えない(${id})とき、測れなかったと言う`, async () => {
    const { res, docs } = produceOverlay(id, [...base, "--python", fakePython(id, body)]);
    if (res.code !== 0) return `生成が通らない(${res.code}) — ${brief(res.stderr || res.stdout)}`;
    const d = withEntries(docs);
    if (!d) return "記録を持つ対象が無い(この検めが成り立たない)";
    const e = d.entries[0];
    if (e.status !== "unverifiable") return `状態が unverifiable でない: ${e.status}`;
    return want.test(e.reason ?? "") ? null : `理由が何も言っていない: ${brief(e.reason)}`;
  });
}

await check("道具そのものが無いとき、測れなかったと言う(黙って空にしない)", async () => {
  const { res, docs } = produceOverlay("nopython", [...base, "--python", "この名前の実行体は無い"]);
  if (res.code !== 0) return `生成が通らない(${res.code}) — ${brief(res.stderr || res.stdout)}`;
  const d = withEntries(docs);
  const e = d?.entries?.[0];
  if (!e) return "記録が無い(落ちたアンカーが黙って消えている)";
  return e.status === "unverifiable" ? null : `状態が unverifiable でない: ${e.status}`;
});

await check("答えない CLI にぶら下がらない(時間切れで止まる)", async () => {
  const slow = fakePython("slow", "sleep 30");
  const started = Date.now();
  const { res, docs } = produceOverlay("timeout", [...base, "--python", slow, "--timeout-ms", "1000"]);
  const took = Date.now() - started;
  if (res.code !== 0) return `生成が通らない(${res.code}) — ${brief(res.stderr || res.stdout)}`;
  if (took > 20000) return `時間切れが効いていない(${Math.round(took / 1000)} 秒待った)`;
  const e = withEntries(docs)?.entries?.[0];
  if (!e) return "記録が無い";
  if (e.status !== "unverifiable") return `状態が unverifiable でない: ${e.status}`;
  return /時間切れ/.test(e.reason ?? "") ? null : `理由が時間切れだと言っていない: ${brief(e.reason)}`;
});

await check("返す値が大きくても、黙って測れなかったことにしない", async () => {
  // 既定の受け皿(1 MiB)を超える正しい返す値。以前はここで ENOBUFS になり、
  // 「大きすぎた」とは言わずに「測れなかった」とだけ言っていた。
  const big = fakePython("big", `python3 -c "import json;print(json.dumps({'schema':'trace-index/1','ranges':[],'findings':[{'check':'x','path':'p'+str(i)} for i in range(60000)]}))"`);
  const { res, docs } = produceOverlay("big", [...base, "--python", big]);
  if (res.code !== 0) return `生成が通らない(${res.code}) — ${brief(res.stderr || res.stdout)}`;
  const e = withEntries(docs)?.entries?.[0];
  if (!e) return "記録が無い";
  return e.status === "unverifiable" ? `大きな返す値を受け取れていない: ${brief(e.reason)}` : null;
});

// ------------------------------------------------------------ 由来の無い木

await check("git でない木を、清らかな木と言わない", async () => {
  const plain = dir("not-a-git-tree");
  mkdirSync(join(plain, "doctrine_docs"), { recursive: true });
  const { res, docs } = produceOverlay("nogit", [
    "--doctrine", FAKE_DOCTRINE, "--repo", `doctrine-lens=${plain}`, "--docs-root", `doctrine-lens=${join(plain, "doctrine_docs")}`,
    "--python", fakePython("nogit", `echo '{"schema":"trace-index/1","ranges":[],"findings":[]}'`),
  ]);
  if (res.code !== 0) return `生成が通らない(${res.code}) — ${brief(res.stderr || res.stdout)}`;
  const d = docs[0];
  if (!d) return "何も生成されていない";
  const w = d.worktree ?? {};
  if (w.dirty === false || w.shallow === false) {
    return `由来を辿れない木を dirty=${w.dirty} / shallow=${w.shallow} と断じている(「分からない」を「問題なし」に変換している)`;
  }
  return d.generated_from_rev === null ? null : `rev を合成している: ${d.generated_from_rev}`;
});

// ------------------------------------------------ 途中で殺されても切れた物を残さない

await check("書き込みは原子的である(途中で止まっても切れた成果物を残さない)", async () => {
  const { writeAtomic } = await import("../lib/atomic-write.mjs");
  const d = dir("atomic");
  const target = join(d, "index.html");
  writeFileSync(target, "古い中身", "utf8");
  let threw = false;
  try {
    writeAtomic(target, "新しい中身", { rename: () => { throw new Error("SIGKILL の代わり"); } });
  } catch { threw = true; }
  if (!threw) return "置き換えが失敗したのに例外が上がらない";
  if (readFileSync(target, "utf8") !== "古い中身") return "中途半端な中身が残った";
  const leftovers = readdirSync(d).filter((n) => n !== "index.html");
  if (leftovers.length) return `一時の物が残っている: ${leftovers.join(", ")}`;
  writeAtomic(target, "新しい中身");
  return readFileSync(target, "utf8") === "新しい中身" ? null : "置き換えが効いていない";
});

await check("成果物と記録を、原子的でない書き方で置いていない", async () => {
  // 見るのは **commit される物・後から読まれる記録**を書く道具だけである。
  // 試験が一時の置き場へ書くのは道具立てであり、途中で殺されても誰も読まない。
  const watched = ["prototype/build.mjs", "overlay/build-overlay.mjs", "gold-model/report.mjs"];
  const bad = [];
  for (const rel of watched) {
    const src = readFileSync(join(root, rel), "utf8");
    for (const m of src.matchAll(/writeFileSync\s*\(/g)) bad.push(`${rel}: ${m[0].trim()}`);
  }
  return bad.length ? `原子的でない書き込みが残っている: ${bad.join(" / ")}` : null;
});

// ---------------------------------------------------------------- 競合する走行

await check("別の置き場へ並行に生成しても互いを汚さない", async () => {
  const d = dir("concurrent");
  const shippedBefore = sha(join(here, "index.html"));
  const spawnBuild = (name) => new Promise((res) => {
    const c = spawn(process.execPath, [buildBin, "--out", join(d, name), "--today", today.date], { cwd: here, stdio: "ignore" });
    c.on("exit", (code) => res(code));
  });
  // **両方を起こしてから待つ。** sleep で重なりを作らない。
  const [a, b] = await Promise.all([spawnBuild("a.html"), spawnBuild("b.html")]);
  if (a !== 0 || b !== 0) return `並行の生成が落ちた(${a} / ${b})`;
  if (sha(join(d, "a.html")) !== sha(join(d, "b.html"))) return "同じ入力から違う byte が出た";
  if (sha(join(here, "index.html")) !== shippedBefore) return "並行の生成が出荷物を書き換えた";
  return null;
});

await check("同じ木で走行が二つ重ならない(錠が効く・死んだ持ち主は継げる)", async () => {
  const { acquireLock } = await import("../lib/run-lock.mjs");
  const fake = dir("lock-repo");
  const first = acquireLock(fake);
  let second = null;
  try { second = acquireLock(fake); } catch { /* 期待どおり */ }
  if (second) { second.release(); first.release(); return "二つ目の走行が同じ木の錠を取れてしまった"; }
  first.release();
  const third = acquireLock(fake);
  third.release();
  // 死んだ持ち主の錠は継げる(一度の強制終了で木が永久に詰まらない)。
  const held = acquireLock(fake);
  writeFileSync(join(held.path, "pid"), String(2 ** 22), "utf8");
  const inherited = acquireLock(fake);
  inherited.release();
  return null;
});

// ------------------------------------------------------------ 走行の証拠が残る

await check("一括判定が自分の証拠を消さない", async () => {
  const copy = join(dir("verify-copy"), "system-map");
  cpSync(root, copy, { recursive: true, filter: (p) => !/[\\/](shots|decisions|node_modules)([\\/]|$)/.test(p) });
  try { symlinkSync(join(root, "..", "..", "node_modules"), join(dirname(copy), "node_modules"), "dir"); } catch { /* 既に在る */ }
  // 段を一つに絞る(この段が自分自身を呼ぶと止まらない)。
  const regPath = join(copy, "gold-model", "registry.json");
  const reg = JSON.parse(readFileSync(regPath, "utf8"));
  reg.gates = reg.gates.filter((g) => g.id === "single-source");
  reg.checkers = reg.checkers.filter((c) => c.gate === "single-source");
  const keep = new Set(reg.checkers.map((c) => c.id));
  reg.invariants = reg.invariants.filter((i) => (i.checkers ?? []).some((c) => keep.has(c)));
  // 了解の記録も外す。段を絞ると対応する判定が出なくなり、**了解の側が所見になる**
  // (それは正しい振る舞いであって、ここで見たいものではない)。
  reg.acknowledgements = (reg.acknowledgements ?? []).filter((x) => Object.keys(x).length === 1 && x.$comment);
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");
  const outDir = dir("verify-reports");
  const r = run(process.execPath, [join(copy, "prototype", "verify.mjs"), "--today", today.date, "--report-dir", outDir], { cwd: join(copy, "prototype") });
  if (r.code !== 0) return `一括判定が通らない(${r.code}) — ${brief(r.stderr || r.stdout)}`;
  const left = readdirSync(outDir).filter((n) => n.endsWith(".json"));
  return left.length ? null : "段ごとの判定の記録が走行の終わりに消えている(何を見たかを後から読めない)";
});

// -------------------------------------------------------- 経路・日付の際どい所

await check("空白と日本語を含む置き場でも生成できる", async () => {
  const odd = join(work, "空白 と 日本語 の 置き場");
  mkdirSync(odd, { recursive: true });
  const r = run(process.execPath, [buildBin, "--out", join(odd, "index.html"), "--today", today.date], { cwd: here });
  if (r.code !== 0) return `生成が通らない(${r.code}) — ${brief(r.stderr || r.stdout)}`;
  return existsSync(join(odd, "index.html")) ? null : "生成物が置かれていない";
});

await check("了解の期限の境界で判定が変わる", async () => {
  const file = TARGETS.find((t) => t.roles.includes("model"))?.file;
  const bin = join(root, "gold-model", "validate.mjs");
  const at = (d) => run(process.execPath, [bin, file, "--today", d], { cwd: join(root, "gold-model") }).code;
  const inside = at("2026-11-09");
  const outside = at("2026-11-10");
  if (inside === outside) return `期限の内(2026-11-09)と外(2026-11-10)で判定が同じ(${inside})。期限が効いていない`;
  return outside !== 0 ? null : "期限を過ぎても緑のままである";
});

await check("在り得ない日付を日付として受け取らない", async () => {
  const bin = join(root, "gold-model", "validate.mjs");
  const file = TARGETS.find((t) => t.roles.includes("model"))?.file;
  const r = run(process.execPath, [bin, file, "--today", "2026-02-30"], { cwd: join(root, "gold-model") });
  if (r.code === 0) return "2026-02-30 を日付として受け取り、そのまま判定した";
  return /日付|--today/.test(r.stderr + r.stdout) ? null : `落ちたが理由が日付だと言っていない: ${brief(r.stderr || r.stdout)}`;
});

// ---------------------------------------------------------------- オフライン

await check("伝送が成立しない環境を、リンクの破損と言わない", async () => {
  // **偶発の通信失敗を欠陥に変換しない。** 実測でそれが起きている —— 同じ木で
  // 一度だけ全 9 要素が「接続不能」で落ち、再走行では通った。伝送そのものが成立
  // しないときは、破損(FAIL)ではなく判定不能(SKIP)である。
  // 判定不能は合格ではない —— 了解の記録が無ければ赤い。それでよい。
  const out = join(dir("m14-offline"), "report.json");
  const r = run(process.execPath, [join(here, "test-m14-browser.mjs"), "--force-offline", "--report", out, "--today", today.date], { cwd: here });
  if (!existsSync(out)) return "判定の記録が書かれていない(段が黙って終わった)";
  const recs = JSON.parse(readFileSync(out, "utf8")).records ?? [];
  const failed = recs.filter((x) => x.verdict === "FAIL");
  if (failed.length) return `伝送不成立を破損として報告している: ${brief(failed[0].message)}`;
  const skipped = recs.filter((x) => x.verdict === "SKIP");
  if (!skipped.length) return `判定不能が一件も出ていない(記録: ${recs.map((x) => x.verdict).join(", ")})`;
  if (!/伝送/.test(skipped[0].message ?? "")) return `理由が伝送の不成立だと言っていない: ${brief(skipped[0].message)}`;
  // 判定不能を合格に数えていないこと。
  return r.code === 0 ? "判定不能なのに段が緑で終わっている(SKIP を合格に数えている)" : null;
});


await check("出荷する実装に通信の原始要素が無い", async () => {
  const src = join(repoRoot, "src");
  const hits = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      let isDir = false;
      try { readdirSync(p); isDir = true; } catch { isDir = false; }
      if (isDir) { if (n !== "test" && n !== "integration") walk(p); continue; }
      if (!n.endsWith(".ts")) continue;
      const body = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // **グローバルの fetch だけを見る。** `this.#fetch(` のような私有メソッドの
      // 呼び出しを通信と数えると、走査そのものが嘘になる(実測でそうなった)。
      for (const m of body.matchAll(/(?<![.#\w])(fetch\s*\(|XMLHttpRequest|require\(["']node:(http|https|net|dns)|from\s+["']node:(http|https|net|dns))/g)) {
        hits.push(`${p.slice(repoRoot.length + 1)}: ${m[0]}`);
      }
    }
  })(src);
  return hits.length ? `通信の原始要素が在る: ${hits.join(" / ")}` : null;
});

// ------------------------------------------------------------------------ 判定

rmSync(work, { recursive: true, force: true });

const violations = cases.map((c) => c.violation).filter(Boolean);
console.log(violations.length === 0
  ? `\n全件通過(注入した壊れ方 ${cases.length} 通り)`
  : `\n${violations.length} 件の所見(注入した壊れ方 ${cases.length} 通り)`);

const records = [verdict({
  invariant: "M-C1", checker: "meta:chaos-tolerated", target: "research/system-map",
  examined: cases.length, examined_unit: "注入した壊れ方", violations,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "chaos", records);
process.exit(gateExitCode(records, today.date));
