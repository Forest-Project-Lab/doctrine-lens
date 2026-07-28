// TEST-001 の追補 — 配布 manifest の性質を字面で凍結する。
//
// ここで守るのは、公開前監査が実害を確かめた三つの決定である。
// いずれも「書き戻しても型検査も単体試験も通ってしまう」性質のものなので、
// 字面で止めるより他に手が無い。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PROJECT = resolve(__dirname, "..", "..");

interface Manifest {
  publisher?: string;
  name?: string;
  main?: string;
  engines?: Record<string, string>;
  activationEvents?: string[];
  capabilities?: { untrustedWorkspaces?: { supported?: boolean } };
  contributes?: {
    keybindings?: unknown[];
    commands?: { command: string; title: string }[];
    menus?: Record<string, { command: string }[]>;
    configuration?: { properties?: Record<string, { scope?: string; description?: string }> };
  };
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(join(PROJECT, "package.json"), "utf8"),
) as Manifest;

test("ADR-009. 既定のキー割り当てを持たない", () => {
  // 持つと、拡張機能が起動していなくても編集器の既定を奪う。
  // Ctrl+K Ctrl+D（Move Last Selection to Next Find Match）と
  // Ctrl+K Ctrl+I（Show Hover）を実際に奪っていた。
  assert.equal(
    manifest.contributes?.keybindings,
    undefined,
    "contributes.keybindings が戻っている（ADR-009 の破れ）",
  );
});

test("ADR-010. 実行体を選ぶ設定は machine scope である", () => {
  const props = manifest.contributes?.configuration?.properties ?? {};
  // この二つは「どの実行体を起こすか」を直に決める。作業フォルダから
  // 上書きできると、リポジトリを開いて信頼しただけで任意の実行体が走る。
  for (const key of ["doctrineLens.pythonPath", "doctrineLens.pluginPath"]) {
    assert.equal(props[key]?.scope, "machine", `${key} の scope が machine でない`);
  }
  // 統治木の場所は作業フォルダごとに違うのが当たり前なので window でよい。
  assert.equal(props["doctrineLens.docsRoot"]?.scope, "window");
});

test("ADR-010. 信頼していない作業フォルダでは動かないと明示している", () => {
  assert.equal(
    manifest.capabilities?.untrustedWorkspaces?.supported,
    false,
    "untrustedWorkspaces.supported を false と明示すること",
  );
});

test("ADR-011. どの作業フォルダでも起動する", () => {
  const events = manifest.activationEvents ?? [];
  assert.ok(
    events.includes("onStartupFinished"),
    "onStartupFinished が無いと、統治木が根直下に無い環境で何も出ない",
  );
});

test("束ね直さずに配ることを構造で止めている", () => {
  // vsce publish は vscode:prepublish を必ず走らせる。無いと古い dist/ を配りうる。
  assert.equal(manifest.scripts?.["vscode:prepublish"], "npm run compile");
});

test("配布物を組む道具が固定されている", () => {
  // 素の複製で npm ci && npm run package が通ること。
  assert.ok(
    manifest.devDependencies?.["@vscode/vsce"],
    "@vscode/vsce が devDependencies に無いと npm run package が動かない",
  );
  assert.ok(
    !manifest.scripts?.["package"]?.includes("npx"),
    "package script が npx を使うと、組んだ版が記録に残らない",
  );
});

test("拡張機能の実行時依存を持たない", () => {
  // 依存は .vsix に同梱される。束ねてあるので持つ必要が無い。
  assert.equal(manifest.dependencies, undefined, "dependencies は空であること");
});

test("main の指す先と束ねの出力が一致する", () => {
  const esbuild = readFileSync(join(PROJECT, "esbuild.mjs"), "utf8");
  const outfile = /outfile:\s*"([^"]+)"/.exec(esbuild)?.[1];
  assert.ok(outfile, "esbuild の出力名を読めない");
  assert.equal(
    manifest.main,
    `./${outfile}`,
    "main と束ねの出力が食い違うと、拡張機能がそもそも読み込めない",
  );
});

test("命令の題と設定の説明がすべて翻訳を経ている", () => {
  const commands = manifest.contributes?.commands ?? [];
  assert.ok(commands.length > 0);
  for (const c of commands) {
    assert.match(c.title, /^%[a-zA-Z0-9._]+%$/, `${c.command} の題が翻訳を経ていない`);
  }
  const props = manifest.contributes?.configuration?.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    assert.match(prop.description ?? "", /^%[a-zA-Z0-9._]+%$/, `${key} の説明が翻訳を経ていない`);
  }
});

test("menus が参照する命令がすべて宣言されている", () => {
  const declared = new Set((manifest.contributes?.commands ?? []).map((c) => c.command));
  for (const [where, items] of Object.entries(manifest.contributes?.menus ?? {})) {
    for (const item of items) {
      assert.ok(declared.has(item.command), `${where} の ${item.command} が未宣言`);
    }
  }
});

test("Marketplace が要る項が揃っている", () => {
  for (const key of ["publisher", "name", "main", "icon", "license", "repository"] as const) {
    assert.ok(
      (manifest as Record<string, unknown>)[key],
      `${key} が無いと Marketplace へ出せない`,
    );
  }
  assert.equal(manifest.publisher, "Forest-Project-Lab");
  assert.ok(manifest.engines?.["vscode"], "engines.vscode が無い");
});
