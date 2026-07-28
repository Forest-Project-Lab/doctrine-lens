---
id: ICD-001
title: lens のインターフェース
type: ICD
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
canonical_for: [depth-levels, lens-dials, upstream-json-contracts]
---

# lens ICD

## 公開する用語

このドメインが所有し、他のドメインが使ってよい語を挙げる。意味の正本は `_system/glossary.md` にある。

- レンズ
- 深度
- 地図
- 節点
- 辺

## 正本である事実

| トピック | 事実 |
|---|---|
| `depth-levels` | 深度の段は L0・L1・L2・L3 の四つである。番号が大きいほど細部を見る。四段すべてを実装する |
| `lens-dials` | レンズが持つダイヤルは色・絞り・配置・深度の四つである |
| `upstream-json-contracts` | 上流 doctrine から受け取る入力は下表の四つである |

## データ契約

このドメインは外部へ機械可読の出力を出さない。読む側であり、出す側ではない。

上流の doctrine から受け取る入力は次の四つである。いずれも doctrine プラグインが出す JSON であり、
このドメインは形を定義しない。形の正本は上流にある。

| 入力 | 出す側 | このドメインでの用途 |
|---|---|---|
| 登録簿の写し | `_registry` を読む問い合わせ | 型の登録順と現行を示す status の値。語彙の判定に使う |
| `dep-graph/classify-edges` | `dep-graph.py` | 節点と辺の全体。地図の描画に使う |
| `trace-index/1` | `trace-index.py` | 文書とコード範囲の対応。深度 L3 とコード側の面で使う |
| `docs-audit/1` | `docs-audit.py` | 所見。指紋の食い違いの判定に使う |

登録簿の写しは、上流の `_registry` をその場で読んで得る。写しを保存しない。
これにより、型や status の語彙をこのドメインが持たずに済む（REQ-003）。

### 事実と判定の分担

上流の四つの入力は、返すものの性質が二つに分かれる。この分担を崩さない。

| 性質 | 出す側 | 例 |
|---|---|---|
| 事実 | `dep-graph`・`trace-index`・`_registry` | 節点はどれか。範囲はどこか。型の並びは何か |
| 判定 | `docs-audit` | 指紋が食い違っているか。参照が切れているか |

判定を事実から自前で導かない。導けば、上流が判定を変えたときに画面だけが古びる（ADR-005）。

上流の出力の形が変われば、このドメインが追随する。追随の責任はこのドメインにあり、上流にはない。

## 依存してよい入口

他のドメインはこの文書だけを `depends_on` に書ける。このドメインの内部文書を直接指してはならない。
