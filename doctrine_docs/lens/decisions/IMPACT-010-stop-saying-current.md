---
id: IMPACT-010
title: 「現行だ」と言うのをやめることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-02
updated: 2026-08-02
sources: []
depends_on: [CHANGE-010]
impacts: [SPEC-006, TEST-006]
llm_context: task
---

# 「現行だ」と言うのをやめることの影響

## 影響する文書

| 文書 | 何を直すか |
|---|---|
| `SPEC-006` | 行の形（status は非現行だけ）・要約の事実の行に非現行・登録簿が取れない回の挙動・受入 14 と新しい受入 |
| `TEST-006` | コード側の受入に、上流に訊く形と、判じられない回を足す |
| `DESIGN.md` §4 | 行の見出しの並びから status を「非現行のときだけ」へ |
| `ADR-021` | 新設 |
| `IMPACT-010` | 新設（この文書） |

`SPEC-001` は直さない。登録簿の項が一つ減るだけで、**取り方も出所も変わらない。**

## 影響する実装

| ファイル | 何を変えるか |
|---|---|
| `src/doctrine/registry.ts` | 問い合わせから `PROJECTION_TYPES` の一行を落とす |
| `src/doctrine/model.ts` | `Registry` から `projectionTypes` を落とす |
| `src/model/consequence.ts` | `Summary.facts` に非現行の件数、`Consequence` に「判じられたか」 |
| `src/model/view.ts` | 現行の行の status を空にする。要約の事実の行に一つ足す |
| `src/shared/protocol.ts` | 文字列の項が一つ増える |
| `src/webview/main.ts` | 変えない（`if (row.status)` が既に空を出さない） |
| `src/l10n.ts` | 事実の行の文に `{3}` を足す |
| `src/test/fixture.ts` | `projectionTypes` を落とす |

**画面側（`webview/main.ts`）を触らずに済む。** 出すか出さないかは模型が決め、
画面は渡された文字列を出すだけである（`ADR-017` 決定 3「上流の値は素通しし判断を足さない」の形）。

## 影響するテスト

| 試験 | 何を変えるか |
|---|---|
| `src/test/consequence.test.ts` | 受入 14 を「現行は出ない・非現行は出る」の二方向へ。判じられない回を足す |
| `src/test/bridge.test.ts` | `projectionTypes` の確認を落とす |
| `tools/mutate-check.mjs` | 判定の突き合わせと、判じられない回の素通しを試す行を足す |

## 実測（変更前）

| 何 | 実測 |
|---|---|
| 67 起点で出る行の総数 | 256 |
| うち非現行 | 48（18.8%） |
| うち現行 | 208（81.2%） |
| 節点の総数 / 現行 | 67 / 58 |
| `type` が id の接頭辞と一致 | 67 / 67 |
| ドメインを越える行 | 0 / 256 |
| `review_by` を持つ節点 | 1 / 67 |
| 登録簿の項のうち実装で使われていないもの | `currentStatuses`・`projectionTypes` の 2 つ |

## 工数見積

| 段 | 内容 | 見積 |
|---|---|---|
| 1 | 足す案を四つ実測で潰す | 半日（済） |
| 2 | `CHANGE-010`・`ADR-021`・`IMPACT-010` | 半日 |
| 3 | 正本（`SPEC-006`・`TEST-006`・`DESIGN.md`）を直す | 半日 |
| 4 | 実装と試験、全門、PR | 半日 |

合計 二日。

## 順序の不変条件

**`ADR-021` を先に書く。** `ADR-014`「良い状態を空白で表さない」と正面からぶつかるので、
線引きを決めてから消す。決めずに消すと、次に何かを隠したくなったときに同じ議論をやり直す。

**判じられない回を、隠す実装より先に書く。** 登録簿が取れない回に全部出す道を
先に通しておかないと、「取れなかった」が「全部現行」に化ける。
`ADR-017` が捕まえた 12 件の欠陥は、すべてこの形だった。
