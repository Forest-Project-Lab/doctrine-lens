// 写しの門が、製品と同じ経路を通っているか。
//
// **同じ画面を作ると称する道具が、別の経路で値を取ってはならない。**
// 実測で、題名・更新・後継だけが python の一行スクリプトで frontmatter を直に読んでおり、
// 製品が通す `docMetaFrom`（上流が節点に載せた値を読む）を迂回していた（`CHANGE-029`）。
// いまは 112/112 で一致するが、**一致していることを誰も見ていなかった。**
// 上流が節点に載せる値と frontmatter の生の値がずれた回に、写しは気づけない。
//
//   node --test tools/preview-webview.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");
const TOOL = readFileSync(join(HERE, "preview-webview.mjs"), "utf8");

test("写しの門が、題名を製品と同じ関数から組む", () => {
  assert.ok(
    TOOL.includes("docMetaFrom(graph)"),
    "題名の表が docMetaFrom を通っていない（製品と別の経路になっている）",
  );
  assert.ok(
    !TOOL.includes("titleReport"),
    "python の一行スクリプトで題名を読む経路が残っている",
  );
  // `docMetaFrom` は製品の側で公開されていること。写しのために写した複製ではない。
  const graph = readFileSync(join(PROJECT, "src", "doctrine", "graph.ts"), "utf8");
  assert.ok(
    /export function docMetaFrom\(/.test(graph),
    "docMetaFrom が製品の側で公開されていない",
  );
});

test("写しの門が、上流の CLI を一行スクリプトで呼んでいない", () => {
  // **`-c` の一行スクリプトは、上流の内部モジュールへの継ぎである。**
  // 上流が答えたら捨てる（`ADR-020`）。残すと、上流の内部が変わった日に
  // 写しだけが静かに古びる——しかも写しは「実物の画面」を名乗っている。
  const oneLiners = [...TOOL.matchAll(/run\(\[\s*\n?\s*"-c"/g)];
  assert.deepEqual(
    oneLiners.map((m) => TOOL.slice(m.index ?? 0, (m.index ?? 0) + 60)),
    [],
    "上流の内部モジュールを一行スクリプトで呼んでいる",
  );
});
