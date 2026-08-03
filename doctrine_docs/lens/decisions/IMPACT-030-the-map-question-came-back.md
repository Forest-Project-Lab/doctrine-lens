---
id: IMPACT-030
title: 構想に応えた影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
depends_on: [CHANGE-030]
llm_context: task
---

# 構想に応えた影響

## 影響する文書

| 文書 | 何が変わるか |
|---|---|
| `SPEC-004` | 追跡索引の入口が上流 ICD 002 の宣言 `trace-index-api` を名指す。呼び方・返る形は不変 |
| `ADR-029` | 新規。書き込みを持つ画面は Lens ではない、という判断の正本 |
| `.gitignore` | `Reference_material/` を足す（統治木の外の一行） |

## 影響する実装

無い。画面・模型・橋のコードは一行も変えない。

## 影響するテスト

無い。挙動が変わらないので、受入（`TEST-001`〜`TEST-008`）の定義も結果も動かない。

## 工数見積

文書のみ。新規 3 件・追記 1 件・統治木の外の一行。半日に満たない。

## 波及の止まり方

この変更は文書の参照先の追随と、木の外の一行である。上流の宣言
（上流 ICD 002 `trace-index-api`）が変わらない限り、ここから先へは波及しない。
検証（Phase 0–1）の帰結が波及を生むのは、Phase 1 終了時の裁きが
「正式移管」を選んだときだけであり、それは新しい CHANGE/IMPACT が持つ。
