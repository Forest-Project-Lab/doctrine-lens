---
id: CHANGE-009
title: 上流が答えたので、継ぎを捨てる
type: CHANGE
domain: lens
status: proposed
owner: doctrine-lens-maintainer
created: 2026-08-02
updated: 2026-08-02
sources:
  - https://github.com/Forest-Project-Lab/doctrine/issues/149
  - https://github.com/Forest-Project-Lab/doctrine/issues/150
  - https://github.com/Forest-Project-Lab/doctrine/issues/151
impacts: [SPEC-001, SPEC-004, SPEC-006, TEST-004, TEST-006, IMPL-001]
llm_context: task
---

# 上流が答えたので、継ぎを捨てる

## 変更内容

doctrine 0.8.0 が、こちらから出した三本に答えた。実測で確かめた。

| # | 何が変わったか | 実測 |
|---|---|---|
| [#149](https://github.com/Forest-Project-Lab/doctrine/issues/149) | 節点が 8 項から **14 項**へ。`title` `updated` `superseded_by` `review_by` `llm_context` が載る | `title: 'グラフの取得を doctrine の Python CLI に委ねる'` |
| [#150](https://github.com/Forest-Project-Lab/doctrine/issues/150) | `trace-index.py` が git に訊く（上流の決定。doctrine 側の記録） | 範囲 30 → **23 件**、`.gitignore` 配下が **0** |
| [#151](https://github.com/Forest-Project-Lab/doctrine/issues/151) | 辺に `mirrored`（両端書きの印。上流の決定） | 辺 104 本のうち **20 本** |

**上流は白名簿そのものを捨てた**（上流の決定）。こちらは「`title` を足してほしい」と頼んだが、
上流はより深い原因を直した。

> **白名簿を持たない。** 組み立てが節点へ入れた項をすべて返す。
> 以前は八項の白名簿で絞っており、**正本がどこにも無いまま組み立てと別々に手で保つ形**に
> なっていた。そして実際にずれた——組み立てが四項を足した後も白名簿は八項のままで、
> 必須項の題名は最初から集められてさえいなかった。

### 1. `src/doctrine/titles.ts` を捨てる（137 行）

上流の `_frontmatter` を `python3 -c` で直接呼んで題名を補っていた継ぎである。
**統治木を二度歩いていた**（`dep-graph` が一度、この継ぎがもう一度。実測 324ms）。

`ADR-018` にこう書いてある。

> 上流へは issue を立てた（`doctrine#149`）。**届いたらこの層は捨てる。**

届いた。捨てる。題名は節点から取る。

### 2. `mirrored` を読み、畳み方の判断を上流へ返す

いま `affectedNeighbours` は `[src, dst]` を無向の鍵にして自分で畳んでいる。
`ADR-012` にこう書いた。

> **相互のペアを和で畳む。** 同じ事実を二度描かない。

畳んでよいという判断の根拠が上流に無かったので、こちらが決めていた。
**上流が `mirrored` として印を付けたので、その値を読む。**

`#151` にこう書いて出した。

> それでも判断の根拠は上流にあってほしい。畳んでよい理由をこちらが持つと、
> それは上流の語彙を実装に写したことになる。

### 3. `trace_exempt` から `out/` と `dist/` を落とす

`.context-config.json` の `trace_exempt` に `out/` `dist/` を書いていたのは、
`trace-index.py` が `.gitignore` を見なかったからである。**同じ事実を二箇所に持っていた。**

上流が git に訊くようになったので、この二行は要らない。
`trace_exempt` は「git には入れるが統治の対象にしない」ためのものとして残る
（`oreilly_ddd_ja/` `tools/` はそのまま）。

## 理由

**継ぎは、上流が答えた時点で負債になる。** 残しておくと、

- 統治木を二度歩く費用が消えない（実測 324ms）
- 上流の内部モジュール（`_frontmatter`）に依り続ける。契約ではないので、名前が変われば壊れる
- 「畳んでよい」という判断をこちらが持ち続け、道具ごとに木の見え方が変わる

`ADR-018` が「届いたらこの層は捨てる」と予告している。予告を実行する。

## 要求元

`REQ-003`「統治の規則を二重定義しない」。判断の根拠を上流へ返す。

## 影響の初期見積

| 区分 | 見積 |
|---|---|
| 消える実装 | `src/doctrine/titles.ts`（137 行）・`src/test/titles.test.ts` の一部 |
| 触る実装 | `src/doctrine/graph.ts`（`fetchDocMeta` の呼び出しを外し、節点から題名を組む）・`src/model/consequence.ts`（`mirrored` を読む）・`src/model/view.ts` |
| 触る設定 | `doctrine_docs/_system/.context-config.json`（`trace_exempt` から二行） |
| 書き直す文書 | SPEC-001・SPEC-004・SPEC-006・TEST-004・TEST-006・IMPL-001・ADR-018（「捨てた」と記す） |
| 新しく作る文書 | ADR-020・IMPACT-009 |
| 触る門 | `src/test/titles.test.ts`・`src/test/consequence.test.ts`・`tools/mutate-check.mjs`（`titles.ts` を指す 3 行を差し替え） |

## 見えている難所

**題名が取れなかったときの扱いが変わる。** いまは「継ぎが失敗した」という部分失敗だが、
上流が返すようになると「節点に `title` が無い」だけになる。
`titlesMissing` の判定を節点の側で見る形へ移す。

**`mirrored` を読んでも、畳む先の選び方は残る。** 依存と影響のどちらを理由に採るかは
`ADR-012` が決めている（依存を残す）。上流が返すのは「両端書きである」という事実だけで、
どちらを見せるかは画面の判断である。**そこは持ち続けてよい。**
