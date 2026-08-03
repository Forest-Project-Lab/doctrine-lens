---
id: IMPACT-028
title: 門の届かない層の影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
depends_on: [CHANGE-028]
llm_context: task
---

# 門の届かない層の影響

## 影響する文書

| 文書 | 何を直したか |
|---|---|
| `SPEC-006` | 受入 37（前提と「繋がらない」）・38（行の中の釦の鍵盤）・39（所見の六項が画面に出る） |
| `TEST-006` | 対応表に三行。受入 38 を「画面側」と宣言 |
| `IMPL-001` | 指紋を取り直す |
| `CHANGE-020` | 「明細は 0 行である」に刻印（`40dd24f`）を添える |
| `CHANGE-028`・`IMPACT-028` | 新設（この二つ） |

## 影響する実装

| ファイル | 変更 |
|---|---|
| `tools/session.test.mjs` | 新設。esbuild で `src/session.ts` を束ね、`vscode` と取得を偽物へ差し替えて走らせる |
| `tools/panel.test.mjs` | 新設。同じ手で `src/panel/lensPanel.ts` を走らせる |
| `tools/fake/vscode.mjs`・`graph-store.mjs`・`locate.mjs` | 新設。編集器と取得の面だけを持つ |
| `src/session.ts` | `#forget()` が状態からも捨てる |
| `src/panel/lensPanel.ts` | 直前の編集器を覚える（閉じられていれば捨てる） |
| `src/webview/main.ts` | 行の `keydown` が中の釦を素通しする。`doc_id` と `refs` を描く。前提の所見の行き先 |
| `src/model/consequence.ts` | 前提を `findingsElsewhereAt` から除き、`findingsOnPremisesAt` へ |
| `src/model/view.ts` | `doc_id` を写す。影響の側でも直の辺を名乗る。脚注一本 |
| `src/shared/protocol.ts` | `FindingView.doc_id`、`premiseFindingsAt` |
| `src/l10n.ts`・`l10n/bundle.l10n.ja.json` | 脚注の文一つ |
| `src/panel/html.ts` | `.finding .doc` と `.finding .refs` の等幅 |
| `tools/check-measured-claims.mjs` | 字面を緩め、零件を止め、下限 4 件 |
| `tools/shoot-preview.mjs` | 受入 38 の段（範囲の札に焦点を当てて Enter） |
| `tools/mutate-check.mjs` | 表に二行（前提を混ぜる潰し・行き先を捨てる潰しの追随） |

## 影響するテスト

| 試験 | 何を見る |
|---|---|
| `tools/session.test.mjs`（2 件） | 木を切り替えた窓で前の木の地図を配らないこと。失敗の経路も同じであること |
| `tools/panel.test.mjs`（2 件） | 明細が焦点を取っても起点が消えないこと。閉じた文書は起点にしないこと |
| `006-37.` | 同じ文書が「前提」と「繋がらない」の両方に出ないこと。前提の所見が数と id で出ること |
| `006-27b.` | 影響の側の迂回でも直の辺を名乗ること |
| `006-39.` | 所見の六項が、写す層と画面の両方に出ること |
| `npm run preview` | 受入 38（範囲の札に焦点を当てて Enter を押すと `openRange` が出る） |

疑ってから信じた（`ADR-024` 決定 5）。**八方向すべてで赤が出た。**

| 故意に壊したもの | 実測 |
|---|---|
| `#forget()` の `#emit` を消す | `tools/session.test.mjs` が「切り替えの途中で前の木の地図が配られている（/w/alpha/doctrine_docs）」 |
| 直前の編集器を覚えない | `tools/panel.test.mjs` が「明細が焦点を取った瞬間に起点が消えた」 |
| `doc_id` を写さない | `006-39` が落ちた |
| 画面が `doc_id` を描かない | `006-39` が落ちた |
| 影響側の直の辺を落とす | `006-27b` が落ちた |
| 前提を「繋がらない」へ混ぜる | `006-37` が落ちた（潰しの表にも載せた） |
| 行の `keydown` の素通しを消す | `npm run preview` が rc=1。`sent が ["ready","openDocument","openRange","openDocument","openDocument"]` |
| 実測の主張を一件も拾わない | `docs:measured` が rc=2（下限 4 件） |

## 実測

| 何 | 前 | 後 |
|---|---|---|
| 単体試験 | 235 | **241** |
| 門が届く層 | `src/doctrine`・`src/model` | ＋`src/session.ts`・`src/panel/` |
| 木を切り替えた窓で配られる地図 | **前の木**（`/w/alpha/doctrine_docs`） | 無し（`null`） |
| 明細が焦点を取ったときの起点 | **消える**（断り文へ差し替わる） | 残る |
| 鍵盤で範囲の札へ | **届かない**（`openDocument` が出る） | 届く（`openRange`） |
| 画面に出る所見の項 | **4**（severity・message・check・path） | **6**（＋doc_id・refs） |
| 影響の側で直の辺を名乗る行 | **0/30** | **30/30** |
| 同じ id が二つの行き先に出る | **在る** | 無し |
| 実測の門が拾う主張 | 3 | **4** |
| 潰しの表 | 73 | **74** |
| 走査の再現率 | — | **21/22**（一件は誤りで、代わりに別の食い違いが出た） |

## 工数見積

**事後に立てた見積は置かない**（`ADR-017`）。走査の結果を六体の検証に掛け、
**実物で走らせて再現したものだけ**を直した。同じ巡で終えた。

## 順序の不変条件

**再現してから直す。** 走査が挙げた 40 件のうち、この巡で触ったのは
**実物で走らせて再現した 21 件**だけである。字面だけで「在りそう」なものは直さない——
直すと、直したことの正しさを誰も確かめられない。

**門の無い層に、まず門を作る。** `session` と `panel` は直す前に門を作った。
そうしないと「直したから緑になった」のか「もともと緑だった」のかが読めない。

**偽物を `tools/` に置く。** `tsconfig.test.json` を広げる道もあったが、
それだと**単体試験が届いている層に見えて、実は偽物で動いている**。
どこで差したかが見える形にする。
