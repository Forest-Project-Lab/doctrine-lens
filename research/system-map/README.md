# system-map 検証(Phase 0–1)

ここに在るものは**候補モデル**であり、正本ではない。doctrine の正式スキーマでも、
doctrine-lens の製品でもない。正本は上流 issue 204 の合意台帳 v3.1
(https://github.com/Forest-Project-Lab/doctrine/issues/204 、所有者が 2026-08-03 に明示 ACK)。

## 置き場の規約(台帳 v3-2′・P2)

1. Phase 0–1 の完了前に、製品コードにも `main` にも統合しない。
2. ここの Gold Model を doctrine の正式スキーマとして扱わない。
3. Phase の節目の commit へ tag を付ける(規則は issue 裁定後に `decisions/` へ記録)。
4. doctrine からの参照は tag または SHA へ固定する。
5. Phase 1 終了時に「正式移管/検証継続/閉鎖」を必ず判断する。
6. 終了条件のない恒久的な実験ブランチにしない。
7. 独立した利用者・公開スキーマ・リリース周期の必要性が実証されるまで、別リポジトリ化しない。

## 構成

- `gold-model/` — 三対象の候補モデル(検証用スキーマ含む)。対象は台帳 v3-5
  (イベント駆動対象は issue の A/B 裁定待ち)。
- `prototype/` — クリック可能な静的プロトタイプ。製品コード(`src/`)から独立し、
  固定された検証用 JSON だけを読む。
- `usability-tests/` — 評価シナリオ・誤読記録・評価結果。門は台帳 v3-3 の三層
  (M 層=機械、H 層=人間・未実施は `UNASSESSED`、O 層=観測)。
- `decisions/` — Phase ごとの判断記録・採用/棄却理由。

## 読み口の規律(台帳 v3-14)

ここの道具が doctrine から読んでよいのは、宣言済み CLI の実行出力だけである
(追跡索引は上流 ICD 002 の `trace-index-api`)。`.claude/.cache` の直読みは契約外。
AI が推定した意味値は `proposed` であり、所有者の確認まで正本表示に混ぜない。
