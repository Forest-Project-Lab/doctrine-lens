---
id: IMPACT-004
title: 帰結の明細へ置き換えることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-29
updated: 2026-07-29
sources: []
depends_on: [CHANGE-004]
llm_context: task
---

# 帰結の明細へ置き換えることの影響

CHANGE-004 の影響を、上流 `dep-graph.py` の前向き・逆向きの両走査で列挙した。
実測は 2026-07-29 に doctrine 0.7.0 で取った。

## 影響する文書

### 降ろすもの（現行 → 廃止）

| 文書 | 現行の依存元（逆参照） | 降ろす前に要ること |
|---|---|---|
| `SPEC-002` 深度の段と行き来 | `IMPL-001`・`SPEC-003`・`TEST-002` | 三つを SPEC-006 へ張り替える |
| `SPEC-003` レンズ文法 | `IMPL-001`・`TEST-003` | 二つを SPEC-006 へ張り替える |
| `TEST-002` 深度の行き来の受入 | なし | そのまま降ろせる |
| `TEST-003` レンズ文法の受入 | なし | そのまま降ろせる |
| `ADR-002` 描画は SVG を手で書く | なし | そのまま降ろせる |
| `ADR-003` 最初のスライスを L0〜L2 に限る | なし | そのまま降ろせる |
| `ADR-004` レンズの語を承認語に加える | なし | 語彙の入れ替えを GLOSSARY で先に行う |
| `ADR-005` 深度 3 を実装する | なし | そのまま降ろせる |

**不変条件**: 現行の依存が残るうちは降ろさない。
したがって順序は「SPEC-006 を立てる → 依存元を張り替える → 降ろす」である。

### 書き直すもの（現行のまま内容を変える）

| 文書 | 何を直すか |
|---|---|
| `REQ-001` | 「連続した深度で俯瞰から実装まで」を捨て、「起点から帰結を順に辿る」にする |
| `REQ-002` | 出所（DDD §3.3.3）が言っていることに合わせる。「一枚を切り替える」をやめ、「課題ごとに別の画面」にする |
| `IMPL-001` | 部品の表から死ぬ四つを外し、生まれる三つを足す。制約の節を書き直す |
| `GLOSSARY-001` | 承認語から「レンズ」「深度」「地図」「節点」「辺」を外し、「起点」「波」「帰結」を入れる |
| `DECIDED-001` | 注入する事実を入れ替える |
| `NONGOAL-001` | 「俯瞰は目的にしない」を足す |

### 新しく作るもの

| 文書 | 何を決める／定めるか |
|---|---|
| `ADR-012` | 帰結を入口にし、地図を捨てる（本体の決定） |
| `ADR-013` | 意匠の値の正本を `DESIGN.md` に置き、実装が値を持たない |
| `SPEC-006` | 帰結の明細（起点の決め方・波・記号・並び順・エラー時挙動・受入基準） |
| `TEST-006` | SPEC-006 の受入 |

### 影響しないもの

| 文書 | 理由 |
|---|---|
| `ICD-001` | 上流の JSON 契約は変わらない。読む項が増えるだけ（`title` の追加は上流へ issue #149 で依頼済み） |
| `REQ-003` | 「規則を写さない」は逆により強く守られる（型の一覧を持つ配置の計算が消えるため） |
| `REQ-004` | コード → 文書の往復は残る。むしろ起点の決め方として中心になる |
| `SPEC-001` | 上流との橋。変わらない |
| `SPEC-004` | 追跡の橋。`audit.ts` の filter を外すが、契約は変わらない |
| `SPEC-005` | コード側の面。変わらない |
| `ADR-001`・`ADR-006〜011` | 決定はそのまま生きる |
| `TEST-001`・`TEST-004`・`TEST-005` | 対応する仕様が変わらない |

## 影響する実装

### 消えるもの

| ファイル | 行 | 備考 |
|---|---|---|
| `src/model/layout.ts` | 324 | 全部 |
| `src/model/lens.ts` | 190 | 全部 |
| `src/model/depth.ts` | 415 | 全部 |
| `src/webview/main.ts` | 約 1,100 | SVG の生成・拡大縮小・平行移動・凡例・パンくず・ダイヤル |
| `src/panel/html.ts` の一部 | — | ダイヤルの節・凡例・パンくず・SVG 用の規則 |
| `src/panel/lensPanel.ts` の一部 | — | 保存レンズの保持と復元 |

### 生まれるもの

| ファイル | 何をするか |
|---|---|
| `src/doctrine/titles.ts` | 上流の `_frontmatter` を呼び、題名・更新日・後継を取る |
| `src/model/consequence.ts` | 起点から波・記号・並び順を決める純粋な関数 |
| `src/webview/main.ts`（書き直し） | 明細を組む。SVG を一要素も持たない |

### 変わるもの

| ファイル | 何を直すか |
|---|---|
| `src/doctrine/audit.ts` | `check.startsWith("trace")` の絞りを外す。34 検査すべてを受け取る |
| `src/doctrine/graph.ts` | 取得に「逆参照（`--dependents --transitive`）」を足す |
| `src/model/trace.ts` | 起点の解決（`rangeAtLine`）が主役に昇格。変更は無い |

### 変わらないもの

`src/doctrine/{cli,locate,model,registry,trace}.ts`、`src/codelens/*`、
`src/model/{cadence,status,paths,workspace}.ts`、`src/session.ts` の取得の骨格。

## 影響するテスト

| 試験 | どうなるか |
|---|---|
| `src/test/depth.test.ts` | 消える（対応する仕様が降りる） |
| `src/test/lens.test.ts` | 消える |
| `src/test/consequence.test.ts` | 新設。SPEC-006 の受入に一対一で対応させる |
| `src/test/titles.test.ts` | 新設 |
| `src/test/trace.test.ts` | 残る。起点の解決の試験を足す |
| `src/test/{bridge,cadence,locate,store,paths,l10n,manifest,status}.test.ts` | 残る |
| `tools/mutate-check.mjs` | 表から死ぬ行を外し、生まれる行を足す |
| `tools/shoot-preview.mjs` | 書き直す。深度の往復ではなく、明細の中身を検める |
| `src/integration/suite/extension.test.ts` | 残る。地図の代わりに明細が開くことを見る |

## ドメイン跨ぎの境界

このリポジトリのドメインは `lens` と `_system` の二つで、変更は `lens` の内側に閉じる。
`ICD-001` が定める上流との接点は変わらない（読む項が増えるだけ）。
したがって `R7`（ドメイン跨ぎは ICD を通す）に触れる変更は無い。

## 工数見積

| 段 | 見積 |
|---|---|
| 統治文書（ADR・SPEC・TEST・REQ の書き直しと降格） | 半日 |
| 題名の取得と帰結の組み立て（純粋な関数と試験） | 半日 |
| 明細の画面（`DESIGN.md` に従う） | 一日 |
| 死ぬコードの削除と、門（突然変異・画面・ホスト）の張り替え | 半日 |
| 検証と直し | 一日 |

## 逆孤児の検査

上流 `dep-graph.py --reverse-orphans` を変更の前後で走らせ、
「現行 REQ に対応する現行 SPEC が無い」「現行 SPEC に対応する現行 TEST が無い」が
増えていないことを確かめる。SPEC-002/003 を降ろすと REQ-001/002 の対応先が消えるので、
**SPEC-006 が両方の対応先になることを明示する**（`depends_on` に REQ-001 と REQ-002 を置く）。
