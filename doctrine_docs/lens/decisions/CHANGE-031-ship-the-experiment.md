---
id: CHANGE-031
title: 実験を同梱して main へ上げる — 所有者の判断
type: CHANGE
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-04
updated: 2026-08-04
sources:
  - https://github.com/Forest-Project-Lab/doctrine/issues/204
impacts: [IMPL-001]
llm_context: task
---

# 実験を同梱して main へ上げる — 所有者の判断

## 何が起きているか

上流 issue 204 の検証は Phase 1 を「検証継続」で固定した(tag `system-map/phase-1-continue`)。
そのうえで所有者が判断を下した(2026-08-04、会話側):

1. **実験として触りたい。**
2. **人間検証(H 層)は当分来ないので、暫定的に可とする。**
3. **最小性(上流 issue 210)は別タスクであり、拡張機能化は許可される。**
4. **一旦ここまでで main に上げる**(目下の問題は解決したため)。

これは、それまでの「検証の間は製品を変えない」(ADR-029)を所有者が部分的に解いた判断である。
解かれたのは「実験としての同梱」まで——正式な製品採用・スキーマ確定・Marketplace 公開の判断ではない。

## 変更内容

- `src/systemMap.ts`(新規)— 命令「System Map(実験)を開く」。候補モデルの静的画面
  (`research/system-map/prototype/index.html`)を束ねの時点で文字列として内蔵し、webview で開く。
  読むだけで、取得・書き込み・外部通信を持たない。既定の挙動は変えない。
- `src/html.d.ts`(新規)— `*.html` を text として取り込む型宣言。
- `esbuild.mjs` — text loader の追加。配布物へ新しいファイルは足さない(manifest の凍結を崩さない)。
- `package.json`ほか — 命令の登録と訳。版は 0.10.0。
- `NONGOAL-001`・`DECIDED-001` 第5項 — 「図を描かない」の範囲を**帰結の画面**に狭めた(理由ごと。
  ADR-030)。
- `IMPL-001` — 部品の表・囲い(10+18=28)・実装制約の主語を追随。
- `research/system-map/` 一式が木に入る(実験ブランチの成果物。統治木の外)。

## 直さなかったもの

- 帰結の画面・REQ-000 は不変。上流 doctrine のスキーマも不変。
- H 層は `UNASSESSED — independent participant unavailable` のまま(手順は `usability-tests/`)。
- 上流 issue 210(本番移管条件)は PAUSED のまま——**この同梱は移管条件の充足ではない**。

## 理由（要求元）

所有者の指示(2026-08-04)。上記4点の判断が要求元のすべてである。

## 影響の初期見積

新規コード 2 ファイル(小)・束ね設定一行・manifest と訳・正本 3 文書の範囲修正・CHANGELOG。
挙動の追加は「明示の命令で読み取り専用の画面を開く」のみ。詳細は `IMPACT-031`。

## 実施の記録

本文書と同じ変更の中で実施した。門(npm run check)の全段通過を確認してから main へ上げる。
