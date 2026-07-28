#!/usr/bin/env node
// 導入済み doctrine プラグインの実体パスを解決して stdout に 1 行で出す。
//
// なぜ要るか: プラグインの実体は ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
// に版番号つきで置かれ、更新のたびにパスが変わる。npm script にこのパスを直書きすると
// 更新のたびに壊れるため、導入台帳（installed_plugins.json）から引く。
//
//   使い方: python3 "$(node tools/doctrine-path.mjs)/scripts/docs-audit.py" --root-from .
//
// 解決順: 1) 台帳の installPath（このプロジェクト向けの登録を優先） → 2) キャッシュ配下の
// 最新版ディレクトリ。どちらも無ければ導入コマンドを案内して終了コード 1 で終わる。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PLUGIN_KEY = "doctrine@forest-project-lab";
const [MARKETPLACE, PLUGIN] = ["forest-project-lab", "doctrine"];

const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const pluginsDir = join(configDir, "plugins");

function fromLedger() {
  const ledger = join(pluginsDir, "installed_plugins.json");
  if (!existsSync(ledger)) return null;
  let entries;
  try {
    entries = JSON.parse(readFileSync(ledger, "utf8"))?.plugins?.[PLUGIN_KEY];
  } catch {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const here = resolve(process.cwd());
  // このプロジェクト向けの登録を優先し、無ければ user/local スコープの登録を使う。
  const preferred = entries.find((e) => e.projectPath && resolve(e.projectPath) === here) ?? entries[0];
  return preferred.installPath && existsSync(preferred.installPath) ? preferred.installPath : null;
}

function fromCache() {
  const dir = join(pluginsDir, "cache", MARKETPLACE, PLUGIN);
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    // 版番号は数値成分で比較する（"0.10.0" > "0.9.0" を文字列比較で誤らないため）。
    .map((d) => ({ name: d.name, parts: d.name.split(".").map((n) => Number.parseInt(n, 10) || 0) }))
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  for (const v of versions) {
    const candidate = join(dir, v.name);
    // 廃版は .orphaned_at が付く。実体が残っていても選ばない。
    if (!existsSync(join(candidate, ".orphaned_at"))) return candidate;
  }
  return null;
}

const found = fromLedger() ?? fromCache();
if (!found) {
  console.error(
    [
      `doctrine プラグインが見つかりません（探した場所: ${pluginsDir}）。`,
      "次を実行して導入してください:",
      "  claude plugin marketplace add https://github.com/Forest-Project-Lab/doctrine.git",
      `  claude plugin install ${PLUGIN_KEY} --scope project`,
      "devcontainer なら bash .devcontainer/setup-doctrine-plugin.sh でも同じことができます。",
    ].join("\n"),
  );
  process.exit(1);
}
process.stdout.write(found);
