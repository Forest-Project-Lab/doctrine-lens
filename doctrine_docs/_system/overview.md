---
id: OVERVIEW-001
title: 現行文書の一覧
type: OVERVIEW
domain: _system
status: current
owner: render-projection
updated: 2026-08-02
llm_context: always
sources: []
---

描画される。手で編集しない。

# Overview

| id | type | domain | title |
|---|---|---|---|
| GLOSSARY-001 | GLOSSARY | _system | 用語辞書の正本 |
| DECIDED-001 | DECIDED | _system | Doctrine Lens の確定方針 |
| NONGOAL-001 | NONGOAL | _system | Doctrine Lens がやらないこと |
| ICD-001 | ICD | lens | lens のインターフェース |
| REQ-001 | REQ | lens | いま触れているものから、直すことになるものを順に辿る |
| REQ-002 | REQ | lens | 一つの画面は一つの問いだけに答える |
| REQ-003 | REQ | lens | 統治の規則を二重定義しない |
| REQ-004 | REQ | lens | コードを読んでいるときに、その根拠の文書へ行ける |
| SPEC-001 | SPEC | lens | doctrine CLI への橋渡し |
| SPEC-004 | SPEC | lens | 追跡索引への橋渡し |
| SPEC-005 | SPEC | lens | コード側の面 |
| SPEC-006 | SPEC | lens | 帰結の明細 |
| SPEC-007 | SPEC | lens | 潰しの検査器の合否 |
| SPEC-008 | SPEC | lens | 潰しの隔離 |
| ADR-001 | ADR | lens | グラフの取得を doctrine の Python CLI に委ねる |
| ADR-006 | ADR | lens | 作業フォルダが複数のときは統治木を持つものを選び、覚える |
| ADR-007 | ADR | lens | 表示の原文を英語にし、日本語を翻訳として持つ |
| ADR-008 | ADR | lens | 取得を二つの拍に分け、監査を保存のたびに走らせない |
| ADR-009 | ADR | lens | 既定のキー割り当てを持たない |
| ADR-010 | ADR | lens | 実行体を選ぶ設定は作業フォルダから上書きさせない |
| ADR-011 | ADR | lens | 起動条件に onStartupFinished を足す |
| ADR-012 | ADR | lens | 地図を捨て、起点からの帰結を一枚の明細で出す |
| ADR-013 | ADR | lens | 意匠の値の正本を DESIGN.md に置き、実装は値を持たない |
| ADR-014 | ADR | lens | 数の代わりに言葉を置かない。門は木の健康に依らない |
| ADR-015 | ADR | lens | 潰しの合否は試験の終了符号で決め、出力の照合は補助に降ろす |
| ADR-016 | ADR | lens | 潰しは利用者の作業木ではなく、捨てられる隔離木で当てる |
| ADR-017 | ADR | lens | 画面は確かめたことだけを言う。自分の門が緑であることを証拠にしない |
| ADR-018 | ADR | lens | 語の意味は木の辞書から引く。実装が語彙を持たない |
| ADR-019 | ADR | lens | 数を出したら行き先も出す。行き先が無いなら、無いと言う |
| ADR-020 | ADR | lens | 上流が答えたら、継ぎをその場で捨てる |
| CHANGE-001 | CHANGE | lens | 文書とコードの往復を加える |
| CHANGE-002 | CHANGE | lens | 配れる状態にする |
| CHANGE-003 | CHANGE | lens | 公開前監査で見つかった 24 件を直す |
| CHANGE-004 | CHANGE | lens | 地図をやめ、帰結の明細にする |
| CHANGE-005 | CHANGE | lens | 数を言い切らず数え、行に status と後継を出す |
| CHANGE-006 | CHANGE | lens | どちらの向きに辿ったかを言う。捨てた事実を数える |
| CHANGE-007 | CHANGE | lens | 画面の語を、木が持つ正本へ結ぶ |
| CHANGE-008 | CHANGE | lens | 出していない所見に、行き先を与える |
| IMPACT-001 | IMPACT | lens | 文書とコードの往復を加えることの影響 |
| IMPACT-002 | IMPACT | lens | 配れる状態にすることの影響 |
| IMPACT-003 | IMPACT | lens | 公開前監査の直しの影響 |
| IMPACT-004 | IMPACT | lens | 帰結の明細へ置き換えることの影響 |
| IMPACT-005 | IMPACT | lens | 数を数え、行に status と後継を出すことの影響 |
| IMPACT-006 | IMPACT | lens | 画面が確かめたことだけを言うようにすることの影響 |
| IMPACT-007 | IMPACT | lens | 画面の語を木の正本へ結ぶことの影響 |
| IMPACT-008 | IMPACT | lens | 出していない所見に行き先を与えることの影響 |
| IMPACT-009 | IMPACT | lens | 継ぎを捨てることの影響 |
| IMPL-001 | IMPL | lens | 拡張機能の部品の配置 |
| TEST-001 | TEST | lens | 橋渡しの受入 |
| TEST-004 | TEST | lens | 追跡索引の橋渡しの受入 |
| TEST-005 | TEST | lens | コード側の面の受入 |
| TEST-006 | TEST | lens | 帰結の明細の受入 |
| TEST-007 | TEST | lens | 潰しの検査器の合否の受入 |
| TEST-008 | TEST | lens | 潰しの隔離の受入 |
