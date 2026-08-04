# Phase 0 判定記録(2026-08-04)

台帳 v3.2(issue 204)E 節の Phase 0 終了条件に対する記録。

## 成果物

| 物 | 中身 |
|---|---|
| `gold-model/schema.json` | 検証用スキーマ 0.1(§6.2 の5エンティティ+七状態+鮮度の権威+負の出所+proposed 隔離) |
| `gold-model/INVARIANTS.md` | M-01〜M-14 の一覧 |
| `gold-model/validate.mjs` | M 層検査器(モデルに適用可能な M-01〜M-12 を機械判定) |
| `gold-model/vocabulary-map.md` | 七状態 ↔ 上流 ADR 081 ↔ doctrine 機構の対応表(v3.2-9) |
| `gold-model/target-1-doctrine-and-lens.json` | 10 要素・6 流れ・4 契約・2 シナリオ・4 anchor |
| `gold-model/target-2-lens-shipping.json` | 6 要素・7 流れ・3 契約・2 シナリオ・4 anchor |
| `gold-model/target-3-celery.json` | 5 要素・7 流れ・4 契約・2 シナリオ・3 anchor |

## M 層判定(2026-08-04、`node validate.mjs target-*.json`)

三対象すべて **PASS 12 / FAIL 0 / SKIP 2**。

- SKIP は M-13(宣言済み CLI 限定 — 道具側の検査)と M-14(3 操作以内 — プロトタイプの検査)。
  **SKIP は合格ではない。** Phase 1 のプロトタイプで判定に置き換える。
- M-04(越境の集約)は三対象とも「子の越境 Flow なし」による成立。対象1は子要素を持つが
  流れを最上位に置いた簡略化であり、Phase 1 で子要素へ流れを降ろすときに実判定になる。
- M-05 の「判定可能性」・M-08 の「過程」は機械で測り切れない旨を検査器が出力に明記する。

## 所見(Phase 0 で分かったこと)

1. **`planned` / `failed` / `stale` は三対象で自然発生しなかった。**
   無理に埋めることは事前分析のプレモーテム(モデル作成の目的化)に当たるため埋めていない。
   帰結: H 層の誤読検査(§v3.2-3)は、稀にしか現れない状態の読み分けを
   「実データに出たときだけ測る」のか「人工の練習例で測る」のか、Phase 1 の試験設計で決める必要がある。
2. **モデル化が実在の統治の穴を三つ表面化させた**(モデルの効用の初期証拠):
   - 配布物(.vsix)と検証済み commit を結ぶ指紋の記録が無い(対象2 c-vsix-fresh、claimed。
     同型の事故が実際に起きた — CHANGELOG L162-163)。
   - 利用者の報告経路が未整備(対象2 f-user-report、負の出所2件)。
   - Lens の性能保証が unknown(対象1 c-lens-performance、負の出所2件)。
3. **負の出所(verdict=silent)は実務で自然に書けた。** RQ 不合格判定(2件)・Celery 順序(2件)・
   報告経路(2件)・性能(2件)の計8件。空白との区別も維持できた。
4. 状態判定の際どい実例: Celery の acks_late は「方法は文書化されているが当方に検証計画が無い」
   ため planned でなく claimed とした。この判定理由は契約の verification_method 欄に残した。

## Phase 0 終了条件の判定

- [x] 三対象の Gold Model が存在する(v3.2-5)
- [x] M 層のうちモデルに適用可能な検査を通過(上表。SKIP 2 は Phase 1 へ明示的に持ち越し)
- [x] 本判定記録が decisions/ に在る
- [x] tag `system-map/phase-0` を本記録のコミットに打つ(v3.2-15)

**Phase 0 を終了とする。** 次は Phase 1(静的プロトタイプ): 固定 JSON(三対象)を読む
クリック可能な静的画面、M-13・M-14 の機械判定、H 層試験の設計(所見1を含む)。

## 未回収(Phase 1 へ)

- [doctrine] の台帳 v3.2 文言確認(特に補強2点の文言化)— issue で依頼中。
- tag 規則の正本ファイル化: 本記録が v3.2-15 の写しを持つ(`decisions/` が正本置き場)。
  > Phase の節目の commit には `system-map/phase-<n>` の tag を打つ。Phase 1 終了時は
  > `system-map/phase-1-<transfer|continue|close>`。統治木からの参照は tag 名+commit SHA 併記。
