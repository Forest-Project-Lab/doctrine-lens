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


const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repoRoot = join(root, "..", "..");
const today = todayFrom(process.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "system-map-chaos-"));
/** 固定した上流の版。**直書きしない** —— 固定を上げた日に、試験だけが古い版を守る。 */
const PINNED_VERSION = JSON.parse(readFileSync(join(root, "doctrine.pin.json"), "utf8")).version;

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

const captureBin = join(root, "surfaces", "capture.mjs");
const buildBin = join(here, "build.mjs");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 一つの対象の overlay を、注入した継ぎ目で作って読む。 */
/**
 * 読み口の捕獲を、壊した環境で走らせる。
 *
 * **期待は「止まらずに続ける」ではない。** M-C1 は「必ず判定を出す**か**、明示の非合格で
 * 止まる」である。`capture.mjs` は一つでも捕れなければ exit 1 で止まり、**そのときも
 * 捕獲を書いて理由を残す** —— 止まったことと、なぜ止まったかが両方読める。
 */
function produceCapture(id, extra) {
  const out = join(dir(`cap-${id}`), "surfaces.json");
  const res = run(process.execPath, [captureBin, "--out", out, "--today", today.date, ...extra], { cwd: join(root, "surfaces") });
  const doc = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  return { res, out, doc };
}

/** 捕れなかった口の記録を一つ返す。 */
const firstBad = (doc) => (doc?.surfaces ?? []).find((x) => x.status !== "captured");

// ------------------------------------------------------------- 上流の固定

await check("版が合っても commit を確かめられないことを、確かめられると言わない", async () => {
  const { configDir } = fakePlugin(PINNED_VERSION);
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

await check("道具そのものが無いとき、測れなかったと言う(黙って空にしない)", async () => {
  const { res, doc } = produceCapture("nopython", ["--python", "この名前の実行体は無い"]);
  if (res.code === 0) return "壊れた道具でも成功として終わった(黙って通した)";
  const bad = firstBad(doc);
  if (!doc) return "捕獲が書かれていない(止まったが、なぜ止まったかが残らない)";
  if (!bad) return "捕れなかった口が記録されていない";
  return /実行体|ENOENT|CLI が失敗/.test(bad.reason ?? "") ? null : `理由が何も言っていない: ${brief(bad.reason)}`;
});

await check("答えない CLI にぶら下がらない(時間切れで止まる)", async () => {
  const slow = fakePython("slow", "sleep 30");
  const started = Date.now();
  const { res, doc } = produceCapture("timeout", ["--python", slow, "--timeout-ms", "1000"]);
  const took = Date.now() - started;
  if (res.code === 0) return "時間切れの道具でも成功として終わった";
  if (took > 20000) return `時間切れが効いていない(${took}ms 待った)`;
  const bad = firstBad(doc);
  return /時間切れ/.test(bad?.reason ?? "") ? null : `理由が時間切れだと言っていない: ${brief(bad?.reason)}`;
});

await check("返す値が大きくても、黙って測れなかったことにしない", async () => {
  const big = fakePython("big", "head -c 80000000 /dev/zero | tr '\0' 'x'");
  const { res, doc } = produceCapture("big", ["--python", big]);
  if (res.code === 0) return "巨大な返り値でも成功として終わった";
  const bad = firstBad(doc);
  return /上限|JSON でない/.test(bad?.reason ?? "") ? null : `理由が言えていない: ${brief(bad?.reason)}`;
});

// ------------------------------------------------------------ 由来の無い木


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

await check("了解の期限の境界で判定が変わる", async () => {
  const bin = join(root, "gold-model", "validate.mjs");
  const at = (d) => run(process.execPath, [bin, "--today", d], { cwd: join(root, "gold-model") }).code;
  const inside = at("2026-11-09");
  const outside = at("2026-11-10");
  if (inside === outside) return `期限の内(2026-11-09)と外(2026-11-10)で判定が同じ(${inside})。期限が効いていない`;
  return outside !== 0 ? null : "期限を過ぎても緑のままである";
});

await check("在り得ない日付を日付として受け取らない", async () => {
  const bin = join(root, "gold-model", "validate.mjs");
  const r = run(process.execPath, [bin, "--today", "2026-02-30"], { cwd: join(root, "gold-model") });
  if (r.code === 0) return "2026-02-30 を日付として受け取り、そのまま判定した";
  return /日付|--today/.test(r.stderr + r.stdout) ? null : `落ちたが理由が日付だと言っていない: ${brief(r.stderr || r.stdout)}`;
});

// ---------------------------------------------------------------- オフライン

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
