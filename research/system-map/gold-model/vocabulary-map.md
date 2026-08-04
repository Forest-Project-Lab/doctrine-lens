# 語彙対応表(台帳 v3.2-9 の同梱義務)

似て非なる二定義を作らないための対応表。左が候補モデルの語、右が既存正本の語。
定義の正本は左列が事前分析 §6.3・台帳 v3.2、右列が doctrine の各正本文書。
**この表は対応を宣言するだけで、どちらの定義も再定義しない。**

## 保証七状態 ↔ 上流 ADR 081 の語彙

| 候補モデル | 意味 | 上流 ADR 081 の対応語 |
|---|---|---|
| `unknown` | 保証主張がまだ記録されていない(負の出所必須。v3.2-5 補強1) | (対応語なし — 記録の不在) |
| `claimed` | 主張のみ。方法も証拠もない | (対応語なし — 「検証」にも「検証戦略」にも達しない) |
| `planned` | 検証方法・予定はあるが、結果がない | **「検証戦略」**(証拠を伴わない TEST 文書) |
| `verified` | 指定の版・環境・時点の合格証拠がある | **「検証」**(客観的証拠の提示。証跡最小形 = 指紋・実行環境・版・終了状態・時刻) |
| `failed` | 指定条件で不合格証拠がある | (検証の結果が否である場合) |
| `stale` | 対象・環境・仮定・証拠が変わり再利用できない | **「古び」**(刻印と現物の不一致) |
| `not_applicable` | 適用しない理由を所有者が明示した | (非目標の明示。例: 上流 NONGOAL 第17項) |

## モデルの器 ↔ doctrine の既存機構

| 候補モデル | doctrine の対応機構 | 対応の根拠 |
|---|---|---|
| `TraceAnchor`(authority=doctrine) | 内容指紋・刻印(`view-stamp-format`、上流 ICD 005) | 台帳 v3.2-10 |
| `TraceAnchor.target_kind=code_range` | 注釈対(`doctrine:begin`/`doctrine:end`、上流 SPEC 026 の追跡索引) | 上流 ICD 002 `trace-index-api` |
| `Evidence.fingerprint` | 成果物の指紋(証跡最小形の一項) | 上流 ADR 081 |
| `TraceAnchor.source_revision` | tag / SHA 固定の参照(v3.2-2′ 条件4) | 台帳 v3.2-15 |
| `provenance.verdict=silent` | (doctrine に対応機構なし — 本検証の新規要素。負の出所) | 台帳 v3.2-5 補強1 |
| `review_status=proposed` | (doctrine に対応機構なし — 確認前の隔離。将来は doc-author 系の受け持ち) | 台帳 v3.2-4 |

## 使い分けの規律

- doctrine 管理下の対象の鮮度は doctrine の機構だけで判じる。モデル側で二重に判じない(v3.2-10)。
- `planned` を「検証済みに近い」と読ませない。`claimed` と `planned` の差は方法の有無、`planned` と `verified` の差は証拠の有無である(H 層の誤読検査の対象。v3.2-3)。
