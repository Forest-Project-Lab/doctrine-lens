---
id: IMPACT-001
title: 文書とコードの往復を加えることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
depends_on: [CHANGE-001]
llm_context: task
---

# 文書とコードの往復を加えることの影響

## 影響する文書

`dep-graph.py --impacts` と `--dependents` で列挙した。感想は書かない。

| 文書 | 関係 | 要る変更 |
|---|---|---|
| SPEC-002 | 変更の対象 | 「L3 は本スライスの対象外」を覆し、L3 の節点・辺・降り方を定める |
| SPEC-003 | SPEC-002 に依存 | L3 で効く配置を一つ加える。色と絞りの扱いは変えない |
| IMPL-001 | SPEC-002 に依存・SPEC-002 の impacts 先 | 新しい部品を対象部品の表に足す |
| TEST-002 | SPEC-002 に依存 | L3 への降下と L3 からの上昇を受入に足す |
| ICD-001 | SPEC-001 が依存 | データ契約の三つのうち二つを「使う」へ改める |
| ADR-003 | — | 覆される決定。ADR-005 が置換する |

## 影響する実装

| 部品 | 変更 |
|---|---|
| `src/doctrine/trace.ts` | 新規。`trace-index.py` の橋渡し |
| `src/doctrine/audit.ts` | 新規。`docs-audit.py` の橋渡し（指紋の食い違いの判定は上流に委ねる） |
| `src/doctrine/graph.ts` | 取得したひと揃いに範囲と所見を足す |
| `src/model/depth.ts` | L3 の場面を組み立てる |
| `src/model/layout.ts` | L3 の配置を足す |
| `src/model/trace.ts` | 新規。範囲と文書の突き合わせ、覆いの計算 |
| `src/codelens/traceLens.ts` | 新規。印が囲む範囲の上に文書を示す |
| `src/panel/lensPanel.ts` | 範囲を開く要求を受ける |
| `src/webview/main.ts` | L3 を描く |
| `src/extension.ts` | 命令を二つ足す |

## 影響するテスト

| テスト | 変更 |
|---|---|
| TEST-002 | L3 への降下・L3 からの上昇の項を足す |
| TEST-004 | 新規。往復そのものの受入 |

## 境界

ドメインを跨がない。lens ドメインの内側だけで閉じる。
相手ドメインの ICD を通す必要は生じない。

## 工数見積

新規の部品が六つ、既存の変更が五つ、テストが二つ。
上流の CLI を二本増やすが、いずれも読み取り専用で、既存の橋渡しと同じ形で呼べる。
