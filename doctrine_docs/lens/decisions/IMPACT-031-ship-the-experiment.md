---
id: IMPACT-031
title: 実験の同梱の影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-04
updated: 2026-08-04
sources: []
depends_on: [CHANGE-031]
llm_context: task
---

# 実験の同梱の影響

## 影響する文書

| 文書 | 何が変わるか |
|---|---|
| `NONGOAL-001` | 「図を描かない」の範囲が**帰結の画面**に狭まる(理由ごと。本文参照: ADR-030) |
| `DECIDED-001` | 第5項に同じ範囲の狭めを注記 |
| `IMPL-001` | 部品の表に 2 ファイル追加・囲い 10+18=28・実装制約の主語を「帰結の画面」に明示 |
| `ADR-030` | 新規。同梱の判断の正本 |
| `CHANGELOG.md` | 0.10.0 の項(統治木の外) |

## 影響する実装

| 実装 | 何が変わるか |
|---|---|
| `src/systemMap.ts` | 新規。命令と webview(読み取り専用・CSP つき・HTML 内蔵) |
| `src/html.d.ts` | 新規。`*.html` の型宣言 |
| `src/extension.ts` | 命令の登録 1 行 |
| `src/l10n.ts` | 画面の題 1 件 |
| `esbuild.mjs` | text loader 1 行 |
| `package.json`・`package.nls*.json`・`l10n/bundle.l10n.ja.json` | 命令・訳・版 0.10.0 |

## 影響するテスト

既存の受入(`TEST-001`〜`TEST-008`)の定義は動かない(帰結の画面は不変)。
`IMPL-001` の凍結試験(部品の表と実在・囲いの数)と l10n の対応試験が新ファイルを検査対象に含む。
System Map 自身の機械検査は `research/system-map/prototype/verify.mjs`(CI: system-map.yml)が受け持つ。

## 工数見積

コード小(2 ファイル+配線)・文書 5 件・訳 3 件。半日に満たない。

## 波及の止まり方

同梱した画面は読むだけで、取得も書き込みも外部通信も持たない。帰結の画面・上流スキーマ・
既定の挙動に触れないため、ここから先へは波及しない。次に波及が生じるのは、
正式な製品採用または本番移管(上流 issue 210 の再開)を裁くときであり、それは新しい決定が持つ。
