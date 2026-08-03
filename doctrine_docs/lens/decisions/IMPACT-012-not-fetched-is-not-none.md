---
id: IMPACT-012
title: 「取れなかった」を保つことの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
depends_on: [CHANGE-012]
impacts: [SPEC-004, SPEC-005, SPEC-006]
llm_context: task
---

# 「取れなかった」を保つことの影響

## 影響する文書

| 文書 | 何を直したか |
|---|---|
| `SPEC-006` | 要約の節に「取れていなければ出ない」。エラー時挙動に五行。制約に二項。受入 28・29・30 |
| `ADR-023` | 新設 |
| `IMPACT-012` | 新設（この文書） |

`SPEC-004`・`SPEC-005` は直していない。**部分失敗の伝え方は変えていない**——
変えたのは「取れなかった値を、数の位置に出さない」ことだけである。

## 影響する実装

| ファイル | 何を変えたか |
|---|---|
| `src/model/consequence.ts` | `findings`・`reverseOrphans` を `null` 可に。`codeRanges` と `facts` の三つを `number \| null` に。`symbolFor` が `null` を当てない |
| `src/model/view.ts` | 取れていない数を組み立てに入れない。取れていない事実を記号と比べない。起点が無い理由を三通りに |
| `src/doctrine/graph.ts` | `reverseOrphans` と `checksRun` を `null` で保つ |
| `src/doctrine/registry.ts` | 上流の JSON の形を検める（他の四つと同じ形へ） |
| `src/model/cadence.ts` | `AuditCarry.staleIds`・`checksRun` を `null` 可に。`NO_AUDIT` が空集合を持たない |
| `src/model/status.ts` | `stale` を `number \| null` に |
| `src/session.ts`・`src/statusbar.ts` | 件数の受け渡しを `null` で通す |
| `src/panel/lensPanel.ts` | 素通しにする（潰す判断を模型へ寄せる。`ADR-021` 決定 4） |
| `src/l10n.ts`・`l10n/bundle.l10n.ja.json` | 数ごとに分けた原文 6 つ、取れていない回の文 2 つ |

## 影響するテスト

| 試験 | 何を変えたか |
|---|---|
| `src/test/consequence.test.ts` | 受入 28・28b・28c・29・30 を追加（5 本） |
| `src/test/cadence.test.ts` | `staleIds`・`checksRun` の `null` を通す |
| `src/test/status.test.ts` | 「失敗した回に古い数を出さない」の期待を `0` から `null` へ |
| `tools/mutate-check.mjs` | **14 行を追加**（表が 55 → 69 行） |

## 実測

| 何 | 前 | 後 |
|---|---|---|
| 「取れなかった」を空へ潰す箇所 | 6 | **0** |
| 潰しの表 | 55 行 | **69 行** |
| 単体試験 | 214 | **219** |
| 範囲が取れない回の要約 | `コード 0 か所 / 範囲が無い 2` | **どちらも出ない** |
| 検査が取れない回の脚注 | `0 検査を走らせた` | **「検査は取れていない」** |

## 工数見積

**事後に立てた見積は置かない**（`ADR-017`。確かめたことだけを言う）。
この変更に先立つ見積は無い。見つけたその巡で直し、PR まで通した。
実際に動いた量は `e130b10`——3 ファイル・+166／−1。この一つのコミットには変更が 2 件載っているので、下の数は 2 件の合計である。

## 順序の不変条件

**模型（`consequence.ts`）を先に直す。** ここが `null` を受け取れないうちに
呼ぶ側だけを直すと、型が通らないか、呼ぶ側で潰し直すことになる。

**`symbolFor` を、数より先に直す。** 記号が `null` を当てないことを先に保証しないと、
「数は出さないのに記号は当たっている」という食い違いが画面に出る。

**潰しの表は最後に足す。** 直す前に足すと、表の `from` が実在しないので
門が走行の前に落ちる。
