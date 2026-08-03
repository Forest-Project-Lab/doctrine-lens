// 状態の帯が何を出すか（SPEC-001・ADR-006・ADR-008）。
//
// 六巡目まで、帯の中身はどの門も見ていなかった。件数の条件を反転させても
// 全件が緑になる状態だったので、判断を編集器の型から切り離して踏めるようにした。
import assert from "node:assert/strict";
import { test } from "node:test";

import { planStatus } from "../model/status.js";

const ready = {
  unavailable: false,
  failed: false,
  docs: 39,
  staleCount: 0,
  candidateCount: 1,
};

test("指紋が食い違う数が 0 より多いときだけ、その旨を出す", () => {
  assert.equal(planStatus(ready).stale, 0);
  assert.equal(planStatus({ ...ready, staleCount: 3 }).stale, 3);
  // 条件を反転させても気づけるように、両側を踏む。
  assert.equal(planStatus({ ...ready, staleCount: 1 }).stale, 1);
});

test("統治木が二つ以上あるときだけ、押すと切り替えになる（ADR-006）", () => {
  assert.equal(planStatus(ready).command, "doctrineLens.open");
  assert.equal(
    planStatus({ ...ready, candidateCount: 2 }).command,
    "doctrineLens.selectWorkspaceFolder",
  );
});

test("取得に失敗した回は警告として出し、押すと取り直せる", () => {
  const plan = planStatus({ ...ready, failed: true });
  assert.equal(plan.kind, "failed");
  assert.equal(plan.warn, true);
  assert.equal(plan.command, "doctrineLens.refresh");
  // **0 ではなく `null`。** 失敗した回に「食い違い 0」と言うと、
  // 取れなかったことが良い知らせに化ける（ADR-023）。
  assert.equal(plan.stale, null, "失敗した回に「食い違い 0」と言っている");
});

test("取得ができない構成では、押しても何も起きない", () => {
  const plan = planStatus({ ...ready, unavailable: true });
  assert.equal(plan.kind, "unavailable");
  assert.equal(plan.command, null);
  assert.equal(plan.warn, false, "異常ではない（統治木が無いのは正常な状態）");
});

test("文書の数はそのまま運ぶ", () => {
  assert.equal(planStatus({ ...ready, docs: 0 }).docs, 0);
  assert.equal(planStatus({ ...ready, docs: 512 }).docs, 512);
});

test("取れていない食い違いの件数を、帯が 0 と断定しない", () => {
  // 起動直後は一度も監査していない。`0` と出すと「食い違い無し」に読める。
  const 取れた = planStatus({ ...ready, staleCount: 0 });
  assert.equal(取れた.stale, 0, "測って零なら 0 と言う（ADR-014）");

  const 取れない = planStatus({ ...ready, staleCount: null });
  assert.equal(取れない.stale, null, "取れていない件数を 0 と断定している");
});
