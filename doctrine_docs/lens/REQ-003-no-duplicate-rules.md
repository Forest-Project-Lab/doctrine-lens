---
id: REQ-003
title: 統治の規則を二重定義しない
type: REQ
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-08-03
sources: [doctrine spec §3, doctrine scripts/_registry.py]
impacts: [SPEC-001]
llm_context: task
---

# 統治の規則を二重定義しない

## 要求文

この拡張機能は、型・status・置き場所・依存の可否といった統治の規則を自身の中に持たない。
これらの規則の正本は上流の doctrine にあり、拡張機能はその判定の結果だけを受け取って描く。

規則を二つ持てば、ゲートが通る状態と画面が示す状態が食い違う。その食い違いは
doctrine 自身が検出対象としている失敗の型であり、それを描く道具が作り込んではならない。

この要求が満たされたことは、次の二つで確かめる。

1. 拡張機能の実装のどこにも、型の一覧・status の語彙・置き場所の対応表が書かれていない。
2. 上流が型を一つ増やしたとき、拡張機能を変更しなくても新しい型の文書が明細に現れる。

## 優先度

高。この要求を落とすと、拡張機能の存在そのものが統治の破れになる。

## 受入基準参照

TEST-001

## 出所

上流 doctrine spec §3 「コードに規則を二重定義しない」。
`scripts/_registry.py` の冒頭が同じ規律を保証限界として明記している。
