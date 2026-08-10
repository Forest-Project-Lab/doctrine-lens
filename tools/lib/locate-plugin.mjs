// 導入済み doctrine プラグインの実体を解決する。**規則の正本は tools/locate-cases.json**
// であり、この実装と `src/doctrine/locate.ts` の両方へ同じ表を当てる
// (`tools/locate-conformance.test.mjs`)。
//
// なぜ要るか(#212 第2信・ADR-031 決定6): 実測で、この木の台帳には
// `projectPath` が**別のプロジェクト**を指す登録が一件だけ在り、
// 「このプロジェクト向け」の突き合わせが外れたまま**先頭の項が黙って採られていた**。
// 上流が 0.11.0 を出しているのに、手元の全ての門が 0.10.0 に対して回っていた。
// 誰もそれを申告しなかった。
//
// ここは経路を返すだけでなく、**何をどこから引いたか**を返す。黙って引かない。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PLUGIN_KEY = "doctrine@forest-project-lab";
const MARKETPLACE = "forest-project-lab";
const PLUGIN = "doctrine";
/** 廃版に付く印。上流が付ける。 */
const ORPHANED = ".orphaned_at";
/** 版のディレクトリとして認める形。前置きの版(0.11.0-rc1 等)は明示指定でしか選べない。 */
const VERSION_DIR = /^(\d+)\.(\d+)\.(\d+)$/;

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/**
 * 経路の突き合わせ用に正規化する。
 * 素の `===` だと、経路の大小文字を区別しない環境(Windows・macOS)で
 * 「このプロジェクト向けの登録を先に見る」が必ず外れる。
 * `src/model/paths.ts` の `forCompare` と同じ規律である(事例表が両者の一致を検める)。
 */
const forCompare = (p) => resolve(p).split("\\").join("/").replace(/\/+$/, "").toLowerCase();

function readLedger(pluginsDir, trace) {
  const ledger = join(pluginsDir, "installed_plugins.json");
  if (!existsSync(ledger)) { trace.push("台帳が無い"); return null; }
  try {
    return JSON.parse(readFileSync(ledger, "utf8"))?.plugins?.[PLUGIN_KEY] ?? null;
  } catch (e) {
    trace.push(`台帳を読めない(${e.message})。複製へ降りる`);
    return null;
  }
}

function versionOf(root) {
  try {
    return JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"))?.version ?? null;
  } catch {
    return null;
  }
}

function fromLedger(pluginsDir, projectDir, trace) {
  const entries = readLedger(pluginsDir, trace);
  if (!Array.isArray(entries) || entries.length === 0) { trace.push("台帳に doctrine の登録が無い"); return null; }
  const here = forCompare(projectDir);
  const mine = entries.find((e) => e.projectPath && forCompare(e.projectPath) === here);
  // projectPath を持たない登録は user/local の範囲であり、どのプロジェクトでも使ってよい。
  const global = entries.find((e) => !e.projectPath);
  const chosen = mine ?? global ?? null;
  if (!chosen) {
    // **ここが以前の欠陥である。** 別のプロジェクト向けの登録を先頭から黙って採っていた。
    const foreign = entries.filter((e) => e.projectPath).map((e) => e.projectPath);
    trace.push(`台帳の登録はどれもこのプロジェクト向けでない(${foreign.join(", ")})。複製へ降りる`);
    return null;
  }
  const installPath = chosen.installPath;
  if (!installPath || !existsSync(installPath)) { trace.push(`台帳の指す先が実在しない(${installPath})。複製へ降りる`); return null; }
  if (existsSync(join(installPath, ORPHANED))) { trace.push(`台帳の指す先が廃版(${installPath})。複製へ降りる`); return null; }
  trace.push(`台帳から引いた(${mine ? "このプロジェクト向け" : "範囲の指定なし"})`);
  return { root: installPath, commit: chosen.gitCommitSha ?? null, commitSource: chosen.gitCommitSha ? "ledger" : null };
}

function fromCache(pluginsDir, trace) {
  const dir = join(pluginsDir, "cache", MARKETPLACE, PLUGIN);
  if (!isDir(dir)) { trace.push(`複製が無い(${dir})`); return null; }
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {
    trace.push(`複製を読めない(${e.message})`);
    return null;
  }
  const skipped = names.filter((n) => !VERSION_DIR.test(n));
  if (skipped.length) trace.push(`版の形でないので候補にしない: ${skipped.join(", ")}`);
  const versions = names
    .map((name) => ({ name, m: VERSION_DIR.exec(name) }))
    .filter((x) => x.m)
    .map((x) => ({ name: x.name, parts: [Number(x.m[1]), Number(x.m[2]), Number(x.m[3])] }))
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  for (const v of versions) {
    const candidate = join(dir, v.name);
    if (existsSync(join(candidate, ORPHANED))) { trace.push(`廃版なので飛ばす: ${v.name}`); continue; }
    trace.push(`複製から引いた: ${v.name}`);
    return { root: candidate, commit: null, commitSource: null };
  }
  trace.push("複製に生きている版が無い");
  return null;
}

/**
 * 解決する。順は次のとおりで、どの段で決まったかを `resolved_via` が言う。
 *
 *   1. 明示の指定(`override`)          — 絶対経路か `~/`。相対は受けない(ADR-010)
 *   2. 固定(`pin`)と食い違う自動検出   — **止める**。静かに測らない
 *   3. 台帳(このプロジェクト向け、または範囲の指定なし)
 *   4. 複製の中の最も新しい生きている版
 *   5. 無ければ `unavailable`
 *
 * `pin` を渡すと、引いた実体の版が固定と一致するかを検める。
 * `pin.allow_autodetect` が偽なら、台帳と複製からの自動検出そのものを認めない。
 */
export function resolvePlugin({
  projectDir = process.cwd(),
  configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  override = "",
  pin = null,
} = {}) {
  const trace = [];
  const pluginsDir = join(configDir, "plugins");

  if (override && override.trim()) {
    const raw = override.trim();
    if (!(raw.startsWith("/") || raw.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(raw))) {
      trace.push(`明示の指定が相対経路なので受けない: ${raw}`);
      return unavailable(trace, "override-relative");
    }
    const candidate = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
    if (!isDir(candidate)) return unavailable([...trace, `明示の指定が実在しない: ${candidate}`], "override-missing");
    // 取り違えで最も多いのは複製の根を指すこと。実体は plugin/ の側に在る。
    const root = existsSync(join(candidate, "scripts", "docs-audit.py"))
      ? candidate
      : existsSync(join(candidate, "plugin", "scripts", "docs-audit.py"))
        ? join(candidate, "plugin")
        : null;
    if (!root) return unavailable([...trace, `明示の指定に scripts/docs-audit.py が無い: ${candidate}`], "override-not-plugin");
    trace.push(`明示の指定から引いた: ${root}`);
    return decorate({ root, commit: null, commitSource: null }, "arg", trace, pin);
  }

  if (pin && pin.allow_autodetect === false) {
    trace.push("固定が自動検出を認めていない(allow_autodetect: false)。明示の指定が要る");
    return unavailable(trace, "autodetect-disabled", pin);
  }

  const found = fromLedger(pluginsDir, projectDir, trace) ?? fromCache(pluginsDir, trace);
  if (!found) return unavailable(trace, "unavailable", pin);
  const via = trace[trace.length - 1].startsWith("台帳") ? "ledger" : "cache";
  return decorate(found, via, trace, pin);
}

function decorate(found, via, trace, pin) {
  const version = versionOf(found.root);
  // 固定との照合は**三段**である。版だけ合っているのを「一致」と呼ぶと、
  // **同じ版を名乗る別の木**が固定を満たしてしまう(複製から引いた実体は commit を
  // 持たないので、これは例外ではなく通例である)。
  let pinState = "no-pin";
  if (pin) {
    if (!version || !pin.version || version !== pin.version) {
      pinState = "mismatch";
      trace.push(`固定(${pin.version})と引いた版(${version ?? "不明"})が違う`);
    } else if (!found.commit) {
      pinState = "matched-version-only";
      trace.push(`版は固定(${pin.version})と一致するが、引いた実体は commit を持たない(版だけの一致)`);
    } else if (pin.commit && found.commit !== pin.commit) {
      pinState = "commit-mismatch";
      trace.push(`版は一致するが commit が違う(固定 ${String(pin.commit).slice(0, 7)} / 引いた ${found.commit.slice(0, 7)})`);
    } else {
      pinState = "matched";
    }
  }
  return {
    root: found.root,
    version,
    commit: found.commit,
    commit_source: found.commitSource,
    resolved_via: via,
    pin_state: pinState,
    trace,
  };
}

function unavailable(trace, reason, pin = null) {
  return {
    root: null,
    version: null,
    commit: null,
    commit_source: null,
    resolved_via: reason === "unavailable" ? "unavailable" : reason,
    pin_state: pin ? "unavailable" : "no-pin",
    trace,
  };
}

/** 固定の記録を読む。無ければ null(固定していない、と言う)。 */
export function readPin(path) {
  if (!existsSync(path)) return null;
  const pin = JSON.parse(readFileSync(path, "utf8"));
  if (pin.schema !== "system-map/doctrine-pin/1") throw new Error(`固定の記録の schema が想定外: ${pin.schema}`);
  for (const k of ["version", "tag", "commit"]) if (!pin[k]) throw new Error(`固定の記録に ${k} が無い`);
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error(`固定の commit が 40 桁の SHA でない: ${pin.commit}`);
  return pin;
}
