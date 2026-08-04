// M-13 / M-14 の「負の試験」— 門が実際に発火することを確かめる。
//
//   node test-gates.mjs
//
// 正の入力(現物)が通ることと、負の入力(仕込んだ違反)が確実に落ちることの
// 両方を検べる。負の側が落ちなければ、この門は飾りである。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeOpsRows, assertM14, checkNoRuntimeFetch } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failures++; console.log("NG   " + name + " — " + e.message); }
};
const expectThrow = (fn, name) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(name + " が発火しなかった(負の入力を通した)");
};

// ---- M-14 ----
t("M-14 正: 現物の四対象は 3 操作以内で通る", () => {
  const gm = (f) => JSON.parse(readFileSync(join(here, "..", "gold-model", f), "utf8"));
  const models = ["target-1-doctrine-and-lens.json", "target-2-lens-shipping.json", "target-3-celery.json", "fixture-rare-states.json"].map(gm);
  const { max } = assertM14(computeOpsRows(models), 3);
  if (max > 3) throw new Error("max=" + max);
});

t("M-14 負: 4 操作の要素を仕込むと落ちる", () => {
  expectThrow(() => assertM14([{ target: "synthetic", element: "x", ops: 4 }], 3), "M-14");
});

t("M-14 負: 限度をまたぐ境界(3 は通り 4 は落ちる)", () => {
  assertM14([{ target: "s", element: "a", ops: 3 }], 3);
  expectThrow(() => assertM14([{ target: "s", element: "a", ops: 4 }], 3), "M-14 境界");
});

// ---- M-13 ----
t("M-13 正: 現物の index.html に実行時外部読み取りが無い", () => {
  const html = readFileSync(join(here, "index.html"), "utf8");
  if (!checkNoRuntimeFetch(html)) throw new Error("現物に fetch/XHR が在る");
});

t("M-13 負: fetch を仕込むと検出される", () => {
  const tampered = "<script>fetch('https://example.com')</script>";
  if (checkNoRuntimeFetch(tampered)) throw new Error("fetch( を見逃した");
});

t("M-13 負: XMLHttpRequest を仕込むと検出される", () => {
  const tampered = "<script>new XMLHttpRequest()</script>";
  if (checkNoRuntimeFetch(tampered)) throw new Error("XMLHttpRequest を見逃した");
});

console.log(failures === 0 ? "\n全件通過(正 2・負 4 が期待どおり)" : `\n${failures} 件の失敗`);
process.exit(failures === 0 ? 0 : 1);
