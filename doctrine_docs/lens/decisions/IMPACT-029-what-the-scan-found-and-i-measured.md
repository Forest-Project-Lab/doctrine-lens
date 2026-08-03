---
id: IMPACT-029
title: 測ってから直した十二件の影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
depends_on: [CHANGE-029]
llm_context: task
---

# 測ってから直した十二件の影響

## 影響する文書

| 文書 | 何を直したか |
|---|---|
| `ICD-001` | 入力の表に二行（逆孤児・辞書）。「四つ」→「六つ」。事実の側に `_termcheck` |
| `SPEC-001` | 登録簿の出力を三つへ（`projectionTypes` は撤回済み・参照 0 件）。命令は二つ。速い拍は五本 |
| `SPEC-005` | 「上流の CLI が七本」→「11 本（速い拍 5・遅い拍 6。実測）」 |
| `README.md`（ビュー） | 引数を要る三命令を区別する |
| `CHANGE-029`・`IMPACT-029` | 新設（この二つ） |

## 影響する実装

| ファイル | 変更 |
|---|---|
| `tools/check-root-terms.mjs` | 点検器の内部故障を 2 で止める |
| `tools/shoot-preview.mjs` | 走行のあと、置き場の写しを数え直す（受入 34） |
| `tools/preview-webview.mjs` | 題名を `docMetaFrom` から組む。python の一行スクリプトを捨てる |
| `tools/preview-webview.test.mjs` | 新設。写しの門が製品と同じ経路を通ることを凍らせる |
| `src/doctrine/graph.ts` | `docMetaFrom` を公開 |
| `src/doctrine/audit.ts` | `checksRun` を `string[] \| null` に。取れなければ `null` |
| `src/model/cadence.ts`・`src/session.ts` | 同じ型を通す |
| `src/model/consequence.ts` | 注釈の数を実測値へ（刻印つき） |
| `src/panel/lensPanel.ts` | 死枝と `#ready` を消す。`partialName` の引数を型で縛る |
| `src/panel/html.ts` | 補助段に行送り 1.5 |
| `src/statusbar.ts` | 失敗の帯に案内を出す |
| `src/extension.ts` | 引数の無い呼びに理由を出す |
| `src/l10n.ts`・`l10n/bundle.l10n.ja.json` | `adviceFor` を移して公開。`needsDocId` を足す。`partialTitles` を消す |
| `src/test/design.test.ts` | 長形・零件・`line-height` |
| `package.json`・`package.nls*.json` | `%ext.description%`。`pluginPath` の相対パスの断り |

## 影響するテスト

| 試験 | 何を見る |
|---|---|
| `006-28d.` | 記号と事実の数が食い違う回に、その理由の脚注が**出る**こと |
| `006-22f.` | 属さない所見が在る回に、件数が**出る**こと |
| `006-29b.` | 上流が `checks_run` を返さない回、橋が `null` を運ぶこと |
| 行送りの段 | DESIGN.md の表の段が全部使われ、表に無い値が CSS に無いこと |
| `tools/preview-webview.test.mjs` | 写しの門が `docMetaFrom` を通り、一行スクリプトを持たないこと |
| `npm run preview` | 走行のあと、置き場に**その走行で撮った写しだけ**が在ること |

疑ってから信じた（`ADR-024` 決定 5）。**九方向すべてで赤が出た。**

| 故意に壊したもの | 実測 |
|---|---|
| 点検器の内部故障を模す | `docs:terms` が rc=2 |
| `footHeaviest` を落とす | `006-28d` が落ちた |
| `footUnattached` を落とす | `006-22f` が落ちた |
| 古い写しを置く | `npm run preview` が「写しが 11 枚（この走行で撮ったのは 10 枚）: 余り 99-stale.png」 |
| `docMetaFrom` を空の表へ | `tools/preview-webview.test.mjs` が落ちた |
| `margin-left: 7px` を書く | `design.test` が落ちた |
| `line-height: 1.45` を書く | `design.test` が落ちた |
| `max-width` を消す | `design.test` が落ちた |
| `checksRun` を `[]` へ戻す | `006-29b` が落ちた |

## 実測

| 何 | 前 | 後 |
|---|---|---|
| 単体試験 | 241 | **247** |
| `docs:terms` が内部故障を読む | **緑** | rc=2 |
| 脚注の正の向きの試験 | **0** | **2** |
| 写しの門が置き場を数え直す | **しない** | する |
| 題名の経路 | python 一行（製品と別） | `docMetaFrom`（製品と同じ。**112/112 一致**を実測） |
| `design.test` の見る宣言 | 短形 41 件 | 長形も含め 44 件。`line-height` 3 → **4** |
| 「上流の CLI 七本」の箇所 | **5** | 0 |
| `ICD` の入力 | **四つ** | 六つ |
| `checksRun` の取れない回 | `[]` | `null` |
| 生産者の居ない枝 | **1** | 0 |
| 引数無しで黙る命令 | **2** | 0 |

**子プロセスの実測**（python の身代わりで数えた）。

```
withAudit=false → 5 本  dep-graph --classify-edges / 登録簿 / trace-index / dep-graph --reverse-orphans / 辞書
withAudit=true  → 6 本  上の五本 + docs-audit
```

## 工数見積

**事後に立てた見積は置かない**（`ADR-017`）。走査の残り 12 件を、
六体の検証が実物で確かめた結果に沿って同じ巡で直した。

## 順序の不変条件

**測ってから直す。** 「七本」も「四つ」も「43 件」も、**自分で数え直してから**書き換えた。
検証が返した数をそのまま写さない——それは走査の申告を運ぶだけである。

**門の側を先に直す。** 用語・脚注・写し・題名・意匠の五つは、
直すと赤が出る順に置いた。文書の数を先に直すと、門が緑のまま数だけが変わる。

**一致を根拠にしない。** 題名の二経路は**いま 112/112 で一致している**。
それでも一本化した——一致は測って初めて言えることであり、
測っていない一致は、ずれた日に誰も気づかない。
