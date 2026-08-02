---
id: IMPACT-009
title: 継ぎを捨てることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-02
updated: 2026-08-02
sources: []
depends_on: [CHANGE-009]
impacts: [SPEC-001, SPEC-004, SPEC-006, TEST-004, IMPL-001]
llm_context: task
---

# 継ぎを捨てることの影響

## 影響する文書

| 文書 | 何を直すか |
|---|---|
| `SPEC-001` | 節点が持つ項（`title` 他）と `mirrored` を書く。継ぎを持たないと明記 |
| `SPEC-004` | 上流が git に訊くので `.gitignore` の場所は返らない |
| `SPEC-006` | 題名の出所を「上流の frontmatter パーサ」から「節点の `title`」へ |
| `TEST-004` | 統治外の確かめ方を、特定のパスを決め打たない形へ |
| `IMPL-001` | 部品の表から「題名の取得」を落とす（**ファイルが一つ減る**） |
| `ADR-020` | 新設 |

## 影響する実装

| ファイル | 何を変えたか | 行数 |
|---|---|---|
| `src/doctrine/titles.ts` | **削除** | **−137** |
| `src/doctrine/model.ts` | `DocMeta`・`DocMetaIndex`・`displayTitle` を受け取る | +25 |
| `src/doctrine/graph.ts` | `fetchDocMeta` の呼び出しを外し、節点から `docMeta` を組む。`PartialFetch` から `titles` を落とす | −6 |
| `src/model/consequence.ts` | `mirrored` についての注記（畳み方の根拠が上流に在ること） | +6 |
| `doctrine_docs/_system/.context-config.json` | `trace_exempt` から `out/` `dist/` の二行 | −2 |

**差し引き 114 行減る。**

## 影響するテスト

| 試験 | 何を変えたか |
|---|---|
| `src/test/titles.test.ts` | 継ぎの受入（7 件）を落とし、題名の落とし方と「節点が題名を持つ」の 2 件に。辞書の 5 件はそのまま |
| `src/test/trace.test.ts` | `004-2` を「この木が挙げているものを使う」形へ。`004-2b`（git が無視する場所は宣言せずとも落ちる）を追加 |
| `src/test/store.test.ts` | 部分失敗が六つから五つへ |
| `tools/mutate-check.mjs` | `titles.ts` を指す 3 行を落とす（**表が 53 → 50 行**） |

## 実測

| 何 | 前 | 後 |
|---|---|---|
| 統治木を歩く回数 | 2 回（`dep-graph` と継ぎ） | **1 回** |
| 題名の取得 | 継ぎで 324ms | 節点に載って 0ms |
| 取得の総時間 | — | **1449ms**（節点 65・題名 65・範囲 22・承認語 33） |
| 部分失敗 | `titles` が起きうる | **0**（項が一つ減った） |
| `trace-index` が返す範囲 | 30 件（うち 12 件が写し） | **22 件**（写し 0） |

## 工数見積

| 段 | 内容 | 実測 |
|---|---|---|
| 1 | 上流 0.8.0 の効果を実測で確かめる | 半日 |
| 2 | CHANGE-009・ADR-020・IMPACT-009 | 半日 |
| 3 | 継ぎを捨て、試験を書き直す | 半日 |
| 4 | 全門・PR | 半日 |

合計 二日。

## 順序の不変条件

**プラグインを先に更新する。** 手元が 0.7.0 のままだと、節点に `title` が載っていないので
継ぎを捨てた瞬間に題名が全部 id へ落ちる。実際、更新前に実測して 0.7.0 のままだと確かめた。

**`ADR-020` を先に書く。** 「上流が答えたら、その回で継ぎを捨てる」を決めてから捨てる。
決めずに捨てると、次に継ぎを置くときに同じ議論をやり直す。
