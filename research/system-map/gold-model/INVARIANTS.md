# M 層 — 機械検査できる不変条件(Phase 0 版)

台帳 v3.2-3 の M 層のうち、Gold Model(JSON)に適用可能な検査の一覧。
各項は二値で判定でき、被験者数に依存しない。Phase 0 の終了条件は
この一覧の全通過である(台帳 E 節)。検査器(validator)は Phase 0 内で書く。

| # | 検査 | 出典 |
|---|---|---|
| M-01 | `id` は模型内で一意。表示名の変更で変わらない | §6.4 |
| M-02 | 各 `SystemElement` の親は 0 または 1。包含と依存を同じ辺にしない | §6.4 |
| M-03 | 各 `Flow` は送信元・受信先を各 1 個持つ。自己ループは `self_loop_reason` 必須 | §6.4 |
| M-04 | 子要素が境界を越える `Flow` は、親の外部 I/O へ集約できる | §6.4 |
| M-05 | 各 `Contract` は最低 1 つの `assumptions` と、判定可能な `response_measure`(または「定性的である」の明示)を持つ | §6.4 |
| M-06 | `verified` の `Contract` は到達可能な `Evidence` を最低 1 件持ち、証跡最小形(指紋・実行環境・版・終了状態・時刻)が埋まっている | §6.4・v3.2-9 |
| M-07 | `review_status: proposed` の値が正本表示(confirmed のみの投影)に混ざらない | §6.4 |
| M-08 | doctrine の文書辺(`depends_on`/`impacts`)を `Flow` へ自動変換していない | §6.4 |
| M-09 | 全 `Flow` に `label` がある(無名の矢印なし) | v3.2-3 |
| M-10 | 各 `TraceAnchor` の鮮度判定の権威(`authority`)がちょうど一つ | v3.2-10 |
| M-11 | `unknown` の `Contract` は `verdict: silent` の負の出所(URL・確認箇所・確認日)を最低 1 件持つ | v3.2-5 補強1 |
| M-12 | `Scenario.steps` の `actor`/`receiver`/`flow` は静的構造に実在する id を指す(幽霊要素なし) | §7.3 |
| M-13 | 道具が読むのは doctrine の宣言済み CLI の実行出力だけ(`.claude/.cache` 直読みなし) | v3.2-14 |
| M-14 | 要素→コードまたは証拠への到達が 3 操作以内(1操作 = v3.2-16。プロトタイプ検査) | v3.2-3・16 |

M-13・M-14 は模型単体でなく道具・プロトタイプに掛かる検査であり、
Phase 0 では設計制約として守り、Phase 1 のプロトタイプで機械判定する。
