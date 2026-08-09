# M 層 — 機械検査する不変条件

台帳 v3.2-3 の M 層。各項は判定でき、被験者数に依存しない。

**この表の正本は `registry.json` である。** ここは人が読むための写しであり、
`test-registry.mjs` が id と出典を機械で突き合わせる —— 食い違えば赤くなる。
表から仕掛けが落ちることは、もう起こらない。

## 判定の語彙(五値)

**合格の桶に入るのは `PASS` だけである。**

| 判定 | 意味 |
|---|---|
| `PASS` | 見た件数が 1 以上で、違反が無い |
| `FAIL` | 違反が在る |
| `VACUOUS` | 見た件数が 0。何も検めていない(合格ではない) |
| `SKIP` | この走行では判定不能(合格ではない)。理由を必ず持つ |
| `ERROR` | 検査器が落ちた、または判定を一つも出さなかった |

`VACUOUS` と `SKIP` は、`registry.json` の `acknowledgements` に出所・確認日・記録者・
再点検期限つきの了解が在るときにだけ個別に許す。了解が期限を過ぎるか、対応する判定が
もう出なくなったら、**了解の側が所見になる**。

## 不変条件と検査器

| # | 検査 | 検査器 | 出典 |
|---|---|---|---|
| M-01 | `id` は模型内で一意。表示名の変更で変わらない | `model:id-unique` | §6.4 |
| M-02 | 各 `SystemElement` の親は 0 または 1。包含と依存を同じ辺にしない | `model:parent-acyclic` | §6.4 |
| M-03 | 各 `Flow` は送信元・受信先を各 1 個持つ。自己ループは `self_loop_reason` 必須 | `model:flow-endpoints` | §6.4 |
| M-04 | 子要素が境界を越える `Flow` は、親の外部 I/O へ集約できる | `model:child-crossing-aggregated` | §6.4 |
| M-05 | 各 `Contract` は最低 1 つの `assumptions` と、判定可能な `response_measure` を持つ | `model:contract-shape` | §6.4 |
| M-06 | `verified` の `Contract` は到達可能な `Evidence` を最低 1 件持ち、証跡最小形が埋まっている | `model:verified-has-evidence` | §6.4・v3.2-9 |
| M-07a | 全ての実体が `review_status` を持つ | `model:review-status-present` | §6.4 |
| M-07b | `proposed` の値が正本表示(`confirmed` のみの投影)に混ざらない | `model:no-proposed-in-canonical` | §6.4 |
| M-08 | doctrine の文書辺(`depends_on`/`impacts`)を `Flow` へ自動変換していない | `model:no-doc-edge-flows` | §6.4 |
| M-09 | 全 `Flow` に `label` がある(無名の矢印なし) | `model:flow-labelled` | v3.2-3 |
| M-10 | 各 `TraceAnchor` の鮮度判定の権威がちょうど一つ | `model:single-freshness-authority` | v3.2-10 |
| M-11 | `unknown` の `Contract` は `verdict: silent` の負の出所を最低 1 件持つ | `model:unknown-has-negative-source` | v3.2-5 補強1 |
| M-12 | `Scenario.steps` の `actor`/`receiver`/`flow` は静的構造に実在する id を指す | `model:no-ghost-in-scenarios` | §7.3 |
| M-13 | 道具が読むのは doctrine の宣言済み CLI の実行の返す値だけ | `build:no-runtime-fetch` ・ `browser:no-external-request` | v3.2-14 |
| M-14 | 要素→コードまたは証拠への到達が規定操作数以内 | `build:reachability` ・ `browser:ops-count` | v3.2-3・16 |
| M-15 | `not_applicable` の `Contract` は `na_reason` と present の出所を持つ | `model:na-has-reason` | doctrine S1 |
| M-16 | `verified` の `Evidence` は `fingerprint` を持つ。または `version` に commit SHA を置く | `model:evidence-fingerprinted` | doctrine S2 |
| M-17 | 実現先になりうるアンカーの指す先は、URL かリポジトリ接頭つきの相対経路である | `model:anchor-target-grammar` | `schema.json` の `TraceAnchor.target`(S4) |
| M-L1 | SVG のラベル同士が視覚的に重ならない | `browser:label-no-overlap` | レビュー指摘 2026-08-04 §4 |
| M-S1 | M 層の事実が正本の外に手書きされていない | `meta:single-source` | ADR-031 決定8・実行原則5 |
| M-N1 | M-13/M-14 の門が負の入力で実際に発火する | `meta:gate-fires` | 所有者判定 2026-08-04 §6・ADR-017 |
| M-R1 | 不変条件と検査器が一対一で対応する | `meta:registry-consistent` | ADR-031 決定8 |

**M-07 は二つに割れている。** 前半(`review_status` が在る)は最初から実装が在ったが、
後半(`proposed` が正本表示に混ざらない)は**どこにも実装が無いまま**「プロトタイプ側で
検める」と印字されていた。いまは検査器が登録され発火するが、`confirmed` の実体が一つも
無いので `VACUOUS` を返す —— **この不変条件はまだ一度も検められていない。**

## 判定は三門に分かれる

| 門 | 何を見るか |
|---|---|
| 模型の門(`validate.mjs`) | 模型単体で判定できるもの(M-01〜M-12・M-15・M-16) |
| build の門(`build.mjs`) | 生成物と到達の計算(M-13 の静的走査・M-14 の計算) |
| ブラウザの門(`test-m13/m14/labels-browser.mjs`) | 実ブラウザの操作・通信・矩形(M-13・M-14・M-L1) |

加えて、門そのものを見る段が三つある —— 正本の単一性(M-S1)・門の発火(M-N1)・
対応の整合(M-R1)。一括で回す正本の命令は `verify.mjs` であり、CI が必須で回す。

上流の配布技能(`system-map-draft`)の文書は検収を「二門」と書いているが、
**実体は三門である。** その文書は上流の側に在り、こちらでは直せない(#212 へ訂正を提案する)。
