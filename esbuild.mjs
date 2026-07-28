// 二つの束を作る。拡張機能の本体（Node・CommonJS）と、webview の中身（ブラウザ・IIFE）。
// 本体は CommonJS の .js にする。VS Code が require で読み込み、その require に
// vscode を差し込む。拡張子を .cjs にすると差し込みの経路から外れて読み込みが落ちる。
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const extensionBuild = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // vscode は実行時に編集器が渡す。束ねてはならない。
  external: ["vscode"],
  // 配布物に .map を入れないので、参照だけ残さない（404 を招く）。
  sourcemap: false,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const webviewBuild = {
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
};

if (watch) {
  const contexts = await Promise.all([context(extensionBuild), context(webviewBuild)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all([build(extensionBuild), build(webviewBuild)]);
}
