// 一括検証 — validator・build・M-14(計算+実操作)・M-13(静的+実ブラウザ)・ラベル重なりを
// 一つの命令で全部走らせる(レビュー指摘 2026-08-04 §5: 「一括実行する検証コマンド」)。
//
//   node verify.mjs
//
// どれか一つでも落ちれば非ゼロで終わる。CI(.github/workflows/system-map.yml)がこれを必須で回す。
import { execFileSync } from "node:child_process";
// 段の一覧と、各段が受け取る対象は registry.json が正本。ここでは持たない。
import { GATES } from "../gold-model/spec.mjs";

let failed = 0;
const failedIds = [];
for (const g of GATES) {
  process.stdout.write(`\n===== ${g.label} =====\n`);
  try {
    execFileSync(g.bin, g.args, { cwd: g.cwd, stdio: "inherit" });
  } catch (e) {
    failed++;
    failedIds.push(g.id);
    // 例外の中身を捨てない。子の標準出力は継いでいるが、終了の仕方(符号・シグナル)は
    // 例外にしか無い —— 握り潰すと「落ちた」以上のことが言えなくなる。
    const how = e?.signal ? `シグナル ${e.signal}` : `終了コード ${e?.status ?? "不明"}`;
    console.error(`FAILED: ${g.label} — ${how}`);
  }
}
console.log(
  failed === 0
    ? `\n一括検証: 全 ${GATES.length} 段通過`
    : `\n一括検証: ${GATES.length} 段中 ${failed} 段が失敗(${failedIds.join(", ")})`,
);
process.exit(failed === 0 ? 0 : 1);
