---
id: CHANGE-002
title: 配れる状態にする
type: CHANGE
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
llm_context: task
---

# 配れる状態にする

## 変更内容

拡張機能として配り、他人の手元で動く状態にする。三つの層に分けて直す。

**配れない欠落（機械作業）**: `private` を外す・`.vscodeignore`・`dependencies` の整理・
LICENSE・CHANGELOG・icon・repository ほかの記載。決定を含まないので軽い経路で扱う。

**手元で困るもの（決定を含む）**: 作業フォルダが複数のときの扱い（ADR-006）・
表示の言語（ADR-007）・取得の拍の分け方（ADR-008）。
これに加えて、取得ができないことを地図の外でも伝える手立てと、Windows の経路の扱い。

**規模で効くもの**: 取り直し一回の実測（dep-graph 122ms・trace-index 488ms・
docs-audit 510ms・登録簿 28ms）のうち、保存のたびに全部を走らせない。

## 理由

いまの状態は「この作業フォルダでは動く」であって「配れる」ではない。
`.vsix` を作ると一次資料と依存が丸ごと入り、他人の環境では作業フォルダの選び方も
言語も取得の重さも当てが外れる。

## 要求元

利用者からの明示の依頼（2026-07-28）。REQ-001・REQ-002・REQ-004 の実現に必要な残作業。

## 影響の初期見積

`dep-graph.py --dependents` で列挙した（IMPACT-002 が確定版を持つ）。
SPEC-001 の逆依存は IMPL-001・SPEC-002・SPEC-004・TEST-001 の四つ。

## 仕上げ

閉じた（2026-07-28）。「何を変えたか」はこの文書と git が持つ。
「なぜ決めたか」は ADR-006・ADR-007・ADR-008 が持つ。

| 段 | 成果物 |
|---|---|
| 1 捕捉 | この文書 |
| 2・3 影響の列挙 | `dep-graph.py --dependents` の結果 |
| 4 影響 | IMPACT-002 |
| 6 決定 | ADR-006（作業フォルダ）・ADR-007（言語）・ADR-008（取得の拍） |
| 7 仕様 | SPEC-001 更新（作業フォルダの解決・取得の拍）・SPEC-005 更新（言語） |
| 9 実装 | IMPL-001 更新 |
| 10 テスト | TEST-001 更新・TEST-005 更新 |
| 11 注入 | 投影を描き直し |
| 14 仕上げ | この節 |
