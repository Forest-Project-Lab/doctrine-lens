// TEST-001 の追補 — 配布 manifest の性質を字面で凍結する。
//
// ここで守るのは、公開前監査が実害を確かめた三つの決定である。
// いずれも「書き戻しても型検査も単体試験も通ってしまう」性質のものなので、
// 字面で止めるより他に手が無い。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("IMPL-001 の部品の表が、実在する実装と一対一で対応する", () => {
  // 表と実体が離れても何も壊れないので、離れたことに誰も気づかない。実際に
  // 三ファイルが表から抜けたまま残っていた。字面で結び直しておく。
  const doc = readFileSync(
    join(PROJECT, "doctrine_docs/lens/implementation/IMPL-001-extension-layout.md"),
    "utf8",
  );
  const listed = new Set(
    [...doc.matchAll(/^\|[^|]*\|\s*`(src\/[^`]+)`\s*\|/gm)].map((m) => m[1] as string),
  );

  const actual: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(PROJECT, dir), { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : 1),
    )) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".ts")) actual.push(rel);
    }
  };
  walk("src");

  // 試験そのものは部品ではない。表に載せているのは manifest の凍結だけである。
  const parts = actual.filter(
    (p) => !p.startsWith("src/test/") && !p.startsWith("src/integration/"),
  );
  const missing = parts.filter((p) => !listed.has(p));
  const gone = [...listed].filter((p) => !actual.includes(p));

  assert.deepEqual(missing, [], `表に載っていない実装がある: ${missing.join(", ")}`);
  assert.deepEqual(gone, [], `表が実在しないファイルを指している: ${gone.join(", ")}`);
});


test(".vsix に入る一覧が凍結してある（作業中のファイルが配布物へ混ざらない）", () => {
  // 既定では「全部入る」ので、根に置いた実験用のファイルがそのまま配られる。
  // 実際に `.preview-r/` と `.probe-*.mjs` が混ざった。`.vscodeignore` を
  // 「全部落として名指しで戻す」形にしたうえで、戻す一覧をここで凍結する。
  const ignore = readFileSync(join(PROJECT, ".vscodeignore"), "utf8");
  const lines = ignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.equal(lines[0], "**", "全部を落としてから戻す形になっていない");

  const shipped = lines.filter((line) => line.startsWith("!")).map((line) => line.slice(1));
  assert.deepEqual(
    [...shipped].sort(),
    [
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "dist/extension.js",
      "dist/webview.js",
      "icon.png",
      "l10n/bundle.l10n.ja.json",
      "package.json",
      "package.nls.ja.json",
      "package.nls.json",
    ],
    "配布物に入るものが変わっている。意図した変更なら、この一覧も直すこと。",
  );

  // 落としきれていない行（`!` でも `**` でもないパターン）が残っていないか。
  const stray = lines.filter((line) => line !== "**" && !line.startsWith("!"));
  assert.deepEqual(stray, [], `落とす側の行が残っている: ${stray.join(", ")}`);

  // main が指す束が、配る一覧に載っていること。
  const manifest = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8")) as {
    main: string;
  };
  const main = manifest.main.replace(/^\.\//, "");
  assert.ok(shipped.includes(main), `main（${main}）が配布物に入らない`);
});
