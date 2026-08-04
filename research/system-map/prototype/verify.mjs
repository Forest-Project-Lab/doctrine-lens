// 一括検証 — validator・build・M-14(計算+実操作)・M-13(静的+実ブラウザ)・ラベル重なりを
// 一つの命令で全部走らせる(レビュー指摘 2026-08-04 §5: 「一括実行する検証コマンド」)。
//
//   node verify.mjs
//
// どれか一つでも落ちれば非ゼロで終わる。CI(.github/workflows/system-map.yml)がこれを必須で回す。
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gold = join(here, "..", "gold-model");

const steps = [
  ["validator(M-01〜16・四対象)", "node", ["validate.mjs", "target-1-doctrine-and-lens.json", "target-2-lens-shipping.json", "target-3-celery.json", "fixture-rare-states.json"], gold],
  ["build(既定 = overlay なし。M-13 静的・M-14 計算)", "node", ["build.mjs"], here],
  ["M-14 計算経路の正負(test-gates)", "node", ["test-gates.mjs"], here],
  ["M-13 実ブラウザ(操作単位 assert・オフライン・負例5)", "node", ["test-m13-browser.mjs"], here],
  ["M-14 実操作(全到達要素のクリック計測・全リンク到達)", "node", ["test-m14-browser.mjs"], here],
  ["ラベル重なり(全対象+ドリル・回帰負例)", "node", ["test-labels-browser.mjs"], here],
];

let failed = 0;
for (const [name, cmd, args, cwd] of steps) {
  process.stdout.write(`\n===== ${name} =====\n`);
  try {
    execFileSync(cmd, args, { cwd, stdio: "inherit" });
  } catch {
    failed++;
    console.error(`FAILED: ${name}`);
  }
}
console.log(failed === 0 ? "\n一括検証: 全段通過" : `\n一括検証: ${failed} 段が失敗`);
process.exit(failed === 0 ? 0 : 1);
