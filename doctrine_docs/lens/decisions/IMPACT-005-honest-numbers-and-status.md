---
id: IMPACT-005
title: 数を数え、行に status と後継を出すことの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-30
updated: 2026-08-02
sources: []
depends_on: [CHANGE-005]
impacts: [SPEC-004, SPEC-006, TEST-004, TEST-006, IMPL-001]
llm_context: task
---

# 数を数え、行に status と後継を出すことの影響

## 影響する文書

上流 `dep-graph.py --dependents ID --transitive` の実測。

```
SPEC-004 の波及先: IMPL-001, SPEC-005, SPEC-006, TEST-004, TEST-005, TEST-006
SPEC-006 の波及先: IMPL-001, TEST-006
```

| 文書 | 何を直すか | 現行のままか |
|---|---|---|
| `SPEC-004` | 「所見の取得」の返り値に `checks_run` を足す。受入基準 6 を「絞られずに届く」から「上流が走らせた検査の数と一致する」へ | 現行のまま |
| `SPEC-006` | §出力の行の形に status と後継を足す。§出力の脚注に検査の数を足す。制約に「数の代わりに言葉を置かない」を足す。受入基準を二項追加 | 現行のまま |
| `TEST-004` | 「所見を検査名で絞らない」の確かめ方を、木の健康に依らない形へ書き直す | 現行のまま |
| `TEST-006` | 行の副文の受入と、脚注の数の受入を追加 | 現行のまま |
| `IMPL-001` | 部品の表は変わらない（ファイルが増えないため）。`src/doctrine/audit.ts` の説明を「所見と、走らせた検査の一覧」へ | 現行のまま |
| `SPEC-005`・`TEST-005` | **波及先だが直さない。** `traceFindings` の呼び方が変わらないため。理由をここに残す | 現行のまま |

**降格する文書は無い。** 撤回する決定が無いので `WATCH` への追記も無い。

`ADR-014` を新設し、三つの決定（数を数える／門を木から切り離す／行に status を出す）を
一本にまとめる。三つは同じ規律の破れなので、別々の ADR にしない。

## 影響する実装

| ファイル | 何を変えるか | 行数の見込み |
|---|---|---|
| `src/doctrine/audit.ts` | `fetchFindings` の返り値を `AuditFinding[]` から `{ findings, checksRun }` へ。`AuditReport` に `checks_run` を足す | +15 |
| `src/doctrine/graph.ts` | `Snapshot` に `checksRun: string[]`。`fetchFindings` の呼び出しの受け取りを直す | +6 |
| `src/model/consequence.ts` | `Row` に `status` と `supersededBy`。`GraphNode` からの素通し（`docMeta` から後継） | +8 |
| `src/model/view.ts` | `RowView` へ status と後継を渡す。`footAudit` に検査の数を差し込む | +12 |
| `src/shared/protocol.ts` | `RowView` に二項。`ConsequenceView` は変えない | +8 |
| `src/webview/main.ts` | 行の head に status と後継を描く | +6 |
| `src/panel/html.ts` | `.row .status` と `.row .succeeds` の CSS。**DESIGN.md の段の中だけを使う** | +6 |
| `src/panel/lensPanel.ts` | `buildView` へ `checksRun.length` を渡す | +2 |
| `src/l10n.ts` | `footAudit` の差し込みを二つへ。`rowSucceeds` を追加 | +4 |
| `l10n/bundle.l10n.ja.json` | 上の訳 | +2 |

**新しいファイルは作らない。** だから `IMPL-001` の部品の表は変わらない。

## 影響する意匠

`DESIGN.md` §4「行」の図が変わる。

```
いま:  [ 溝 16 ][ 記号 12 ][ 8 ][ 題名 …… ][ 補助の数 ][ 溝 16 ]
                                 一文
                                 コード範囲

あと:  [ 溝 16 ][ 記号 12 ][ 8 ][ 題名 …… ][ id ][ status ][ 補助の数 ][ 溝 16 ]
                                 一文
                                 後継（在るときだけ）
                                 コード範囲
```

`DESIGN.md` §9-5 が「この文書と実装が食い違ったら実装を直す。意図して変えるなら、
この文書を先に直し、統治木の ADR で理由を残す」と要求している。
**先に `DESIGN.md` を直す。** 直さずに実装を変えると `src/test/design.test.ts` が落ちる。

新しい寸法・色・書体は導入しない。status は補助の段（11px・従の色）、
後継は本文の段（13px）で、既に在る段の中に収まる。**彩度のある色は使わない**
（非現行は異常ではなく、ただの状態である。ADR-012 の「`!` と `~` に色を当てない」と同じ理由）。

## 影響するテスト

| 試験 | 何を変えるか |
|---|---|
| `src/test/consequence.test.ts` | 「34 検査すべてが橋を渡る」を二つに割る。(a) 上流の `AUDIT_CHECKS` を実行時に読み `checks_run` と突き合わせる (b) **偽のプラグインが返す混在の報告**で橋が絞らないことを木に依らずに検める。行の status と後継の受入を追加 |
| `src/test/store.test.ts` | `Snapshot` に項が増えるので見本を直す |
| `src/test/design.test.ts` | 段の外の値が入らないことは既存の門が見る。**新しい試験は要らない** |
| `tools/mutate-check.mjs` | 行を三つ足す（`checks_run` を捨てる／status を捨てる／後継を捨てる） |

**門が木の健康状態に依らなくなることが、この変更の主目的の一つである。**
いまの門は木の所見が 1 件（`guard_liveness_gap`）で、それが偶然「追跡以外」なので通っている。
木が完全に緑になると、橋が正しいまま門が赤くなる。

## 工数見積

| 段 | 内容 | 見積 |
|---|---|---|
| 1 | ADR-014・SPEC-004・SPEC-006・TEST-004・TEST-006・DESIGN.md の改訂 | 半日 |
| 2 | 橋（`audit.ts`・`graph.ts`）と `checksRun` の通し | 半日 |
| 3 | 行の status と後継（模型 → protocol → 描き手 → CSS） | 半日 |
| 4 | 門の張り替え（単体・偽プラグイン・突然変異の三行） | 半日 |
| 5 | 全門・指紋の再記録・投影・PR | 半日 |

合計 二日半。

## 順序の不変条件

`DESIGN.md` を先に直す。実装を先に変えると `design.test.ts` が落ちる（ADR-013 の設計どおり）。

`SPEC-004` を `SPEC-006` より先に直す。`SPEC-006` の脚注の数は
`SPEC-004` が返す `checks_run` に依るためである（`SPEC-006` は `SPEC-004` に依存しない
が、実装の依存はこの向きに在る）。
