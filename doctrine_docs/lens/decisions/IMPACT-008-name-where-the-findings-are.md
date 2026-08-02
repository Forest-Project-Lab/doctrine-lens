---
id: IMPACT-008
title: 出していない所見に行き先を与えることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-02
updated: 2026-08-02
sources: []
depends_on: [CHANGE-008]
impacts: [SPEC-006, TEST-006]
llm_context: task
---

# 出していない所見に行き先を与えることの影響

## 影響する文書

| 文書 | 何を直すか | 現行のままか |
|---|---|---|
| `SPEC-006` | 脚注の形（行き先の id）・制約に「行き先が無いなら無いと言う」・受入 22 | 現行のまま |
| `TEST-006` | 受入を一項、退行観点を二項 | 現行のまま |
| `ADR-019` | 新設 | — |
| `IMPL-001` | **変わらない。** 新しいファイルを作らない | 現行のまま |

## 影響する実装

| ファイル | 何を変えるか |
|---|---|
| `src/model/consequence.ts` | `findingsElsewhere`（数）を `findingsUnattached`（数）と `findingsElsewhereAt`（id の並び）へ割る。`attachedTo` を足す |
| `src/model/view.ts` | 脚注を二行に。`findingsAt` を渡す |
| `src/shared/protocol.ts` | `ConsequenceView.findingsAt` |
| `src/webview/main.ts` | 脚注に押せる id を描く |
| `src/panel/html.ts` | `.foot .at`（DESIGN.md の段の中） |
| `src/l10n.ts`・`l10n/bundle.l10n.ja.json` | 文言の差し替えと追加 |

**新しいファイルは作らない。**

## 影響するテスト

| 試験 | 何を変えるか |
|---|---|
| `src/test/consequence.test.ts` | 受入を 4 件追加（006-25・25b・25c・25d）。既存の 2 件の期待を新しい形へ |
| `tools/mutate-check.mjs` | 表に 3 行（行き先を捨てる／属さないものを混ぜる／refs を見落とす） |

## 工数見積

| 段 | 内容 | 実測 |
|---|---|---|
| 1 | 実測で二種類に分かれることを確かめる | 半日 |
| 2 | CHANGE-008・ADR-019・IMPACT-008 | 半日 |
| 3 | 実装と受入 | 半日 |
| 4 | 全門・PR | 半日 |

合計 二日。

## 順序の不変条件

**実測を先にした。** 起票の前に「出ていない所見が二種類ある」ことを、
人工の所見を足して確かめている。確かめずに書いていたら、
「全部に行き先を与える」という誤った変更になっていた
（文書に属さない所見には行き先が作れない）。
