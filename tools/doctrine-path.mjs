#!/usr/bin/env node
// 導入済み doctrine プラグインの実体を解決して、その経路を stdout に 1 行で出す。
//
//   使い方: python3 "$(node tools/doctrine-path.mjs)/scripts/docs-audit.py" --root-from .
//           node tools/doctrine-path.mjs --json            解決の跡ごと出す
//           node tools/doctrine-path.mjs --require-pin     固定と食い違えば止まる
//
// 解決の規則は tools/lib/locate-plugin.mjs に在り、その正本は tools/locate-cases.json
// である(同じ表を src/doctrine/locate.ts へも当てる。tools/locate-conformance.test.mjs)。
//
// **解決した版と commit は必ず stderr に出す。** 以前はこの道具が経路しか出さず、
// 手元の全ての門が 0.10.0 に対して回っているのに上流が 0.11.0 を出している、という
// ずれを誰も申告しなかった(doctrine#212 第2信・ADR-031 決定6)。
//
// stdout は経路だけを保つ。npm script が `$(...)` で受けるためである。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlugin, readPin, PLUGIN_KEY } from "./lib/locate-plugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const pinPath = value("--pin") ?? join(here, "..", "research", "system-map", "doctrine.pin.json");
let pin = null;
try {
  pin = readPin(pinPath);
} catch (e) {
  console.error(`固定の記録を読めない(${pinPath}): ${e.message}`);
  process.exit(2);
}

const got = resolvePlugin({
  projectDir: value("--project") ?? join(here, ".."),
  override: value("--doctrine") ?? process.env.SYSTEMMAP_DOCTRINE_PATH ?? "",
  pin,
});

// 固定との照合は三段ある。
//   matched                版も commit も固定と一致する
//   matched-version-only   版は一致するが、引いた実体が commit を持たない(複製など)
//   commit-mismatch / mismatch   食い違う
//
// `--require-pin` は従来どおり「版が合っていればよい」で止めない(CI と手元の門は
// これで回っている)。**commit まで要る段は `--require-commit` を付ける** ——
// 版だけの一致を完全な一致と呼ばないための口である。
const PIN_OK_VERSION = new Set(["matched", "matched-version-only"]);
const pinFails = () =>
  (flag("--require-commit") && got.pin_state !== "matched") ||
  (flag("--require-pin") && !PIN_OK_VERSION.has(got.pin_state));

if (flag("--json")) {
  process.stdout.write(JSON.stringify({ schema: "doctrine-lens/plugin-resolution/1", ...got, pin }, null, 2) + "\n");
  process.exit(got.root ? (pinFails() ? 3 : 0) : 1);
}

if (!got.root) {
  console.error(
    [
      `doctrine プラグインが見つかりません。`,
      ...got.trace.map((t) => `  ${t}`),
      "次を実行して導入してください:",
      "  claude plugin marketplace add https://github.com/Forest-Project-Lab/doctrine.git",
      `  claude plugin install ${PLUGIN_KEY} --scope project`,
      "devcontainer なら bash .devcontainer/setup-doctrine-plugin.sh でも同じことができます。",
    ].join("\n"),
  );
  process.exit(1);
}

// 何を引いたかを必ず言う。黙って引かない。
const shortCommit = got.commit ? got.commit.slice(0, 7) : "commit 不明";
console.error(`doctrine: 版 ${got.version ?? "不明"} / ${shortCommit} / ${got.resolved_via} から引いた`);
if (pin && got.pin_state === "matched-version-only") {
  console.error(
    `doctrine: 版は固定(${pin.version})と一致するが、**引いた実体は commit を持たない。** ` +
      `固定 ${pin.commit.slice(0, 7)} と同じ木かどうかは、この照合では言えない(版だけの一致)。` +
      (flag("--require-commit") ? "" : " commit まで要る段は --require-commit を付けて止めること。"),
  );
} else if (pin && got.pin_state !== "matched") {
  console.error(
    `doctrine: **固定(${pin.version} / ${pin.commit.slice(0, 7)})と食い違う。** 引いたのは ${got.version ?? "不明"} である。` +
      (flag("--require-pin") ? "" : " 再現性の要る段は --require-pin を付けて止めること。"),
  );
}
if (pinFails()) process.exit(3);

process.stdout.write(got.root);
