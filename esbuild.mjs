// 二つの束を作る。拡張機能の本体（Node・CommonJS）と、webview の中身（ブラウザ・IIFE）。
// 本体は CommonJS の .js にする。VS Code が require で読み込み、その require に
// vscode を差し込む。拡張子を .cjs にすると差し込みの経路から外れて読み込みが落ちる。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  // System Map(実験)の画面は自己完結 HTML を文字列として内蔵する。
  // 配布物へ新しいファイルを足さない(.vscodeignore の allowlist と manifest 凍結試験を崩さない)。
  loader: { ".html": "text" },
  // 配布物に .map を入れないので、参照だけ残さない（404 を招く）。
  sourcemap: false,
  logLevel: "info",
};

/**
 * webview の束ね方。
 *
 * 出し先だけを引数にして export する。画面を確かめる道具（tools/preview-webview.mjs）が
 * これを使い回すためである。写しを持たせると、片方だけが古びても誰も気づかない。
 * 実際に、道具の側が dist/ を写すだけで自分では組み立てず、src の変更が
 * 一切反映されないまま「画面の誤り 0」と読める状態になっていた。
 *
 * @param {string} outfile
 * @returns {import("esbuild").BuildOptions}
 */
export function webviewOptions(outfile) {
  return {
    entryPoints: ["src/webview/main.ts"],
    outfile,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    sourcemap: false,
    logLevel: "info",
  };
}

const webviewBuild = webviewOptions("dist/webview.js");

// import されただけのときは組み立てない（道具が webviewOptions だけを使う）。
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!invokedDirectly) {
  // 何もしない。呼び手は webviewOptions を使う。
} else if (watch) {
  const contexts = await Promise.all([context(extensionBuild), context(webviewBuild)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all([build(extensionBuild), build(webviewBuild)]);
}
