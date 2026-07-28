#!/usr/bin/env node
// 実際の VS Code を落としてきて拡張機能ホストで動かし、編集器の中でしか
// 確かめられない部分（見出し・帯・命令の登録）を試験する。
//
// 「組み上がった」と「編集器が実際に読み込めた」は別である。
// main の指す先が実在しない、命令の宣言が足りない、といった欠陥はここでしか出ない。
import { resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

const projectRoot = resolve(import.meta.dirname, "..");

// 親の VS Code から受け継いだ環境変数を落とす。
//
// なぜ要るか: この試験を VS Code の中（統合端末・devcontainer・拡張機能ホスト）から
// 走らせると、親が立てた ELECTRON_RUN_AS_NODE=1 を子が受け継ぐ。すると新しく起こした
// Electron が「素の Node」として動き、VS Code の起動ではなく拡張機能の入口を直に
// require してしまう。結果は `Cannot find module 'vscode'` で、原因が拡張機能側に
// あるように見える。実際は環境の取り違えである。
// VSCODE_ で始まるものも同じ理由で落とす（親の IPC や ESM の入口を指しているため）。
const inherited = Object.keys(process.env).filter(
  (name) => name === "ELECTRON_RUN_AS_NODE" || name.startsWith("VSCODE_"),
);
for (const name of inherited) delete process.env[name];
if (inherited.length > 0) {
  console.log(`親の VS Code から受け継いだ環境変数を落とした: ${inherited.join(", ")}`);
}

try {
  await runTests({
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: resolve(projectRoot, "out-integration", "suite", "index.js"),
    // このリポジトリ自身を作業フォルダにする。統治木も印もここに在る。
    // --disable-extensions で他の拡張機能を止め、この一つだけを見る。
    launchArgs: [projectRoot, "--disable-extensions", "--disable-gpu", "--no-sandbox"],
  });
  console.log("拡張機能ホストでの試験が通った。");
} catch (error) {
  console.error("拡張機能ホストでの試験が失敗した:", error);
  process.exit(1);
}
