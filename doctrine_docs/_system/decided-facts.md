---
id: DECIDED-001
title: Doctrine Lens の確定方針
type: DECIDED
domain: _system
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
review_by: 2026-10-26
canonical_for: [upstream-reference-style, facts-versus-judgments, no-rule-duplication]
llm_context: always
---

# Doctrine Lens の確定方針

## 確定方針

**1. 上流 doctrine の文書を引くときは、型と番号のあいだをハイフンでつながない。**
「doctrine 側 ADR 054」のように、空白で区切って書く。
型と番号をハイフンでつないだ形は、この統治木の id として解決され、必ず dead link になる。
その形をこの説明の中にも書かない。書けばこの文書自身が dead link を生む。

**2. 事実と判定を分ける。**
上流から取るもののうち、`dep-graph`・`trace-index`・`_registry` が返すのは事実であり、
`docs-audit` が返すのは判定である。判定を事実から自前で導かない。
導けば、上流が判定を変えたときに画面だけが古びる。

**3. 拡張機能は統治の規則を持たない。**
型・status・置き場所・依存の可否・指紋の突き合わせのいずれも、実装の中で判定しない。
上流の判定の結果だけを読んで描く。

## 決定日

2026-07-28

## 根拠ADR

ADR-001（取得を上流の CLI に委ねる）・ADR-005（事実と判定を分ける）

## 再点検期限

review_by: 2026-10-26（期限で再点検する。置換済みの決定は要点だけを残し一本に統合する）

<!-- 入れない: 迷い、調査、提案中 -->
