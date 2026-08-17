// 鮮度の三値が、**上流の宣言の字面**と一致することを検める。
//
//   node test-rev-state.mjs [--report <path>] [--today YYYY-MM-DD]
//
// なぜ要るか: 鮮度の規則は上流 `doctrine_docs/graph/ICD.md`(ADR-172 決定3)が正本であり、
// 「読み手はこの規則を再定義しない」と明記されている。こちらの実装はそこから導いた
// `lib/rev-state.mjs` の一箇所だけに在るべきで、表と実装が食い違えば鳴る必要がある。
//
// 出荷していた旧規則は宣言と**四点**食い違っていた(`decisions/phase-3-freshness/` に生ログ):
//   1. `source_dirty` を判定に入れていなかった —— 汚れた木でも「同一(照合済)」と断言した
//   2. 完全 SHA かどうかを検めず、ただの文字列比較だった
//   3. 宣言に無い条件(記録した rev が履歴に在るか)を足していた
//   4. 三値目の名が `advanced`(前進)で、**測っていない方向**を主張していた
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";
import { revState } from "../lib/rev-state.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

/**
 * 宣言の字面から起こした表。**この表が正本の写しである** ——
 * 一行ずつ、宣言のどの文から来たかを `clause` に書く。
 */
const TABLE = [
  // 第一文: 共に完全 SHA で等しく、かつ、いまの source_dirty が false なら「同一」
  { recordedRev: A, currentRev: A, currentDirty: false, want: "same", clause: "第一文", why: "共に完全 SHA・等しい・汚れ false" },

  // 第三文: いまの source_dirty が true か null なら「不明」(等しくても肯定に丸めない)
  { recordedRev: A, currentRev: A, currentDirty: true, want: "unknown", clause: "第三文", why: "等しいが、いまの木が汚れている" },
  { recordedRev: A, currentRev: A, currentDirty: null, want: "unknown", clause: "第三文", why: "等しいが、汚れが解決できない" },

  // 第二文: 共に完全 SHA で異なれば「相違」
  { recordedRev: A, currentRev: B, currentDirty: false, want: "differs", clause: "第二文", why: "共に完全 SHA・異なる" },
  { recordedRev: A, currentRev: B, currentDirty: true, want: "differs", clause: "第二文(曖昧点)", why: "異なる。汚れは既に在る差を消さない" },

  // 第三文: どちらかが null なら「不明」
  { recordedRev: null, currentRev: A, currentDirty: false, want: "unknown", clause: "第三文", why: "記録時が null" },
  { recordedRev: A, currentRev: null, currentDirty: false, want: "unknown", clause: "第三文", why: "いまが null" },
  { recordedRev: null, currentRev: null, currentDirty: false, want: "unknown", clause: "第三文", why: "両方 null" },

  // 「完全 SHA」の要求。短縮形・記号名は比べられない
  { recordedRev: "a1b2c3d", currentRev: A, currentDirty: false, want: "unknown", clause: "第一〜三文の前提", why: "記録時が短縮形" },
  { recordedRev: A, currentRev: "HEAD", currentDirty: false, want: "unknown", clause: "第一〜三文の前提", why: "いまが記号名" },
  { recordedRev: "en/stable(2026-08-03〜04 取得)", currentRev: A, currentDirty: false, want: "unknown", clause: "第一〜三文の前提", why: "記録時が完全 SHA でない(実データに在る形)" },
];

const violations = [];
const checks = [];
for (const t of TABLE) {
  const got = revState(t);
  const label = `${t.clause}: ${t.why}`;
  checks.push(label);
  if (got !== t.want) {
    violations.push({
      what: label,
      detail: `記録時=${t.recordedRev} / いま=${t.currentRev} / 汚れ=${t.currentDirty} → 期待 ${t.want} だが ${got}`,
    });
  }
  console.log(`  ${got === t.want ? "OK  " : "NG  "}${label.padEnd(48)} → ${got}`);
}

// **三値以外を返さないこと。** 語が増えれば画面の表が黙って覆えなくなる。
const seen = new Set(TABLE.map((t) => revState(t)));
for (const v of seen) {
  if (!["same", "differs", "unknown"].includes(v)) {
    violations.push({ what: "三値の外の語を返した", detail: v });
  }
}
checks.push("三値の外の語を返さない");

console.log(violations.length === 0
  ? `\n全件通過(${checks.length} 件の突き合わせ)`
  : `\n${violations.length} 件の所見`);

const today = todayFrom(process.argv.slice(2));
const records = [verdict({
  invariant: "M-F1", checker: "overlay:rev-state-declared", target: "research/system-map",
  examined: checks.length, examined_unit: "宣言との突き合わせ",
  violations,
})];
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "overlay", records);
process.exit(gateExitCode(records, today.date));
