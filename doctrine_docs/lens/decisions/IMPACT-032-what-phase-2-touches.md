---
id: IMPACT-032
title: Phase 2 が触るもの
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-09
updated: 2026-08-09
sources: []
depends_on: [CHANGE-032]
llm_context: task
---

# Phase 2 が触るもの

## 影響する文書

| 文書 | 何が変わるか |
|---|---|
| `ADR-031` | 新規。裁定の範囲・M 層の裁き・判定語彙・固定の方針の正本 |
| `CHANGE-032` | 新規。開始時点の実測と主題の並び |
| `ADR-030` | **置換しない**。System Map は実験の表示のまま |
| `IMPL-001` | 画面の主題で `src/` に部品が増えるときだけ、部品の表と囲いの数を追随する |
| `CHANGELOG.md` | 主題ごとに追記(統治木の外) |

統治木の外の記録(`research/system-map/`)で動くもの:

| 物 | 何が変わるか |
|---|---|
| `decisions/phase-2-baseline/` | 新規。開始時点の全門の生ログ・件数・空判定の一覧 |
| `decisions/phase-1-record.md` | **編集しない**。判定を「二層」と呼んだ点は後継の記録で正す |
| `gold-model/INVARIANTS.md` | 不変条件と検査器の対応の正本に合わせる。機械が食い違いを検める |

## 影響する実装

| 実装 | 何が変わるか |
|---|---|
| `research/system-map/gold-model/validate.mjs` | 検査の本体が外へ出て、CLI に縮む。無条件の SKIP 2 行を消す |
| `research/system-map/gold-model/schema.json` | 検査に使う。強化のみ(空文字の禁止・実現の指定の排他) |
| `research/system-map/prototype/gates.mjs` | 定数が正本へ移る。判定を例外でなく記録で返し、対象ごとに数える |
| `research/system-map/prototype/verify.mjs` | 固定の段の並びが正本駆動になる。M 層の報告と終了コードを持つ |
| `research/system-map/prototype/build.mjs` | 模型の一覧・操作数の上限・環境変数の焼き込み・対象の選び方 |
| `research/system-map/overlay/build-overlay.mjs` | 対象の固定・パスの取り方・落ちたアンカーの記録・時計の読み |
| `research/system-map/prototype/shoot.mjs` ほか試験 | 位置で対象を指すのをやめる。出荷物をその場で書き換えない |
| `tools/doctrine-path.mjs` | 別のプロジェクト向けの登録を黙って使わない。アーカイブ済みを拒む。版と SHA を出す |
| `src/doctrine/locate.ts` | 同じ規律の共通の核へ委ねる。上書き設定の扱いは拡張機能固有のまま残す |
| `src/systemMap.ts` ほか画面 | 画面の主題でのみ。実測と候補の値を色以外でも分ける |
| `.github/workflows/check.yml` | 上流の複製を固定した commit にする |
| `.github/workflows/system-map.yml` | PR でも走らせる。対象の絞りを広げる。overlay を回す。差分ゼロを検める |
| `package.json` | 検証用スキーマの検査器を devDependencies に足す。実行時の依存はゼロのまま |

## 影響するテスト

- 既存の受入(`TEST-001`〜`TEST-008`)の定義は動かない。帰結の画面は不変である。
- `IMPL-001` の凍結試験は、`src/` に部品が増える主題でだけ影響を受ける。
- `src/test/locate.test.ts` は、共通の核へ委ねた後、その核の適合試験を兼ねる。
- System Map 自身の検査は段が増える —— 負例の表・門が発火しなくなる変異の検出・成果物の byte 一致。
- `npm run mutate` の表に、新しい直しごとに一行を足す(足し忘れは道具自身が報告する)。

## 工数見積

主題は八つ。記録と基準線は半日に満たない。M 層の単一化と判定語彙が最も重く、負例と変異の検出を含めて数日。
残りは各一日前後を見込む。画面と E2E は静止画の撮り直しと上流への報告を含む。

## 波及の止まり方

`research/` は統治木の外にあり、`main` の既定の挙動・帰結の画面・上流のスキーマに触れない。
画面の主題で `src/` に触るが、開くのは明示の命令だけで、読むだけの画面である点は変わらない。
次に波及が生じるのは、正式な製品採用または本番移管を裁くときであり、それは新しい決定が持つ。
