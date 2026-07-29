// doctrine:begin SPEC-001
// 統治木と doctrine プラグイン実体の場所を決める。
//
// 解決の順は上流の登録簿（_registry.locate_docs_root）と導入台帳に合わせる。
// ここで判定するのは「場所」だけであり、文書の中身には触れない。
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { forCompare, isInside } from "../model/paths.js";
import { resolveUserPath } from "./cli.js";

/** 統治木として認めるディレクトリ名。優先順（ADR-022）。 */
const DOCS_DIR_NAMES = ["doctrine_docs", "docs"] as const;

const PLUGIN_KEY = "doctrine@forest-project-lab";
const MARKETPLACE = "forest-project-lab";
const PLUGIN = "doctrine";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `path` を統治木として扱ってよいか（ADR-022）。
 *
 * `doctrine_docs` は在れば統治木。`docs` は `_system` を直下に持つ場合だけ。
 * `_system` を持たない素の `docs` は他所の土地であり、決して統治木としない。
 */
export function isDoctrineTree(path: string, name: string): boolean {
  if (!isDirectory(path)) return false;
  if (name === "doctrine_docs") return true;
  if (name === "docs") return isDirectory(join(path, "_system"));
  return false;
}

/**
 * プロジェクト根から統治木を解決する。無ければ `null`。
 *
 * `override` が空でなければ、その相対パスを根からたどった先を使う。
 * 指定した先が統治木でなければ `null` を返す（黙って既定へ落ちない）。
 *
 * 作業フォルダの外を指す値は受け付けない（ADR-010）。`docsRoot` は作業フォルダごとに
 * 変えられる設定なので、配布元不明のリポジトリが `../` で外を指せてしまう。
 * 読むだけとはいえ、指せる先を中に限るのは安い。
 *
 * 判定は実体（symlink をたどった先）で行う。字面の前方一致だけだと、
 * リポジトリに同梱した繋ぎ一つで外へ抜けられる。
 */
export function locateDocsRoot(projectDir: string, override = ""): string | null {
  if (!projectDir) return null;
  if (override.trim()) {
    const candidate = resolve(projectDir, override.trim());
    if (!containedIn(projectDir, candidate)) return null;
    const name = candidate.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    return isDoctrineTree(candidate, name) ? candidate : null;
  }
  for (const name of DOCS_DIR_NAMES) {
    const candidate = join(projectDir, name);
    if (!containedIn(projectDir, candidate)) continue;
    if (isDoctrineTree(candidate, name)) return candidate;
  }
  return null;
}

/**
 * `candidate` の実体が `projectDir` の中に在るか。
 *
 * 字面と実体の両方で見る。実体が取れない（まだ無い）ときは字面で判じる。
 */
function containedIn(projectDir: string, candidate: string): boolean {
  if (!isInside(projectDir, candidate)) return false;
  try {
    return isInside(realpathSync(projectDir), realpathSync(candidate));
  } catch {
    return true;
  }
}

interface LedgerEntry {
  projectPath?: string;
  installPath?: string;
}

function fromLedger(pluginsDir: string, projectDir: string): string | null {
  const ledger = join(pluginsDir, "installed_plugins.json");
  if (!existsSync(ledger)) return null;
  let entries: LedgerEntry[] | undefined;
  try {
    const parsed = JSON.parse(readFileSync(ledger, "utf8")) as {
      plugins?: Record<string, LedgerEntry[]>;
    };
    entries = parsed?.plugins?.[PLUGIN_KEY];
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // 突き合わせは forCompare を通す。素の `===` だと、経路の大小文字を区別しない
  // 環境（Windows・macOS）で「このプロジェクト向けの登録を先に見る」が必ず外れ、
  // 別のプロジェクト向けに入れた版が走る。
  const here = forCompare(resolve(projectDir));
  const preferred =
    entries.find((e) => e.projectPath && forCompare(resolve(e.projectPath)) === here) ??
    entries[0];
  const installPath = preferred?.installPath;
  if (!installPath || !existsSync(installPath)) return null;
  // 廃版には `.orphaned_at` が付く。台帳は版を上げても古い項が残ることがあるので、
  // ここでも検める（fromCache と同じ規律）。検めないと、退役した版を黙って走らせる。
  if (existsSync(join(installPath, ORPHANED))) return null;
  return installPath;
}

/** 廃版に付く印。上流が付ける。 */
const ORPHANED = ".orphaned_at";

function fromCache(pluginsDir: string): string | null {
  const dir = join(pluginsDir, "cache", MARKETPLACE, PLUGIN);
  if (!isDirectory(dir)) return null;
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  // 版番号は数値成分で比べる（"0.10.0" > "0.9.0" を文字列比較で誤らないため）。
  const versions = names
    .map((name) => ({ name, parts: name.split(".").map((n) => Number.parseInt(n, 10) || 0) }))
    .sort(
      (a, b) =>
        (b.parts[0] ?? 0) - (a.parts[0] ?? 0) ||
        (b.parts[1] ?? 0) - (a.parts[1] ?? 0) ||
        (b.parts[2] ?? 0) - (a.parts[2] ?? 0),
    );
  for (const v of versions) {
    const candidate = join(dir, v.name);
    // 廃版には .orphaned_at が付く。実体が残っていても選ばない。
    if (!existsSync(join(candidate, ORPHANED))) return candidate;
  }
  return null;
}

/**
 * doctrine プラグインの実体パスを解決する。無ければ `null`。
 *
 * `override` が空でなければそれを使う（在ることだけ確かめる）。
 * それ以外は導入台帳を先に、次にキャッシュ配下の最も新しい版を見る。
 * `configDir` は試験から差し替えるために引数にしてある。
 */
export function locatePluginRoot(
  projectDir: string,
  override = "",
  configDir = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude"),
): string | null {
  if (override.trim()) {
    // 受けるのは絶対パスと `~/` だけである。作業フォルダ基準の相対値を受けると、
    // 開いたリポジトリが同梱した python スクリプトが走る（ADR-010 の帰結が破れる。
    // `pythonPath` と同じ規律であり、resolveUserPath に一箇所だけ置いてある）。
    const candidate = resolveUserPath(override);
    if (candidate === null) return null;
    // 「在るディレクトリ」だけでは足りない。取り違えた先を返すと、失敗は
    // 「プラグインが見つからない」ではなく「CLI が失敗した」として現れ、
    // 読み手が設定を疑えない。実体であることまでここで見る。
    if (!isDirectory(candidate)) return null;
    if (existsSync(join(candidate, "scripts", "docs-audit.py"))) return candidate;
    // 取り違えとして最も多いのは、複製の根を指すことである。上流の複製は
    // 根にも `scripts/` を持つが、プラグインの実体は `plugin/` の側に在る。
    // 一段だけ見て、そこに実体が在れば黙って直す（案内するだけだと、
    // 画面には「プラグインが見つからない」としか出ず手がかりが無い）。
    const inside = join(candidate, "plugin");
    return existsSync(join(inside, "scripts", "docs-audit.py")) ? inside : null;
  }
  const pluginsDir = join(configDir, "plugins");
  return fromLedger(pluginsDir, projectDir) ?? fromCache(pluginsDir);
}
// doctrine:end SPEC-001
