---
id: IMPACT-021
title: 借りてきた道具を消すことの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
depends_on: [CHANGE-021]
impacts: [IMPL-001]
llm_context: task
---

# 借りてきた道具を消すことの影響

## 影響する文書

| 文書 | 何を直したか |
|---|---|
| `SPEC-007` | 覆わない範囲の一覧から `tools/doc-manager/` を落とす |
| `.context-config.json` | `trace_exempt` から一行落とす |
| `README.md` | claude-harness キットの説明から落とす |
| `IMPACT-021` | 新設（この文書） |

## 消したもの

| | 実測 |
|---|---|
| `tools/doc-manager/` | **7 ファイル・1173 行** |
| `package.json` の命令 | **5 つ**（`docs:aggregate`・`docs:fetch`・`docs:extract`・`docs:diff`・`docs:refresh`） |

**取り戻せる。** `git checkout 40dd24f -- tools/doc-manager/`。

## 影響する門

**無い。** 門が一つも掛かっていなかった——試験 0・CI 0・`trace_exempt`。
**それが消してよい根拠でもある。**

## ついでに直した、初回の利用者に効くもの

| 何 | 前 | 後 |
|---|---|---|
| `engines` | `vscode` だけ。README は「Node 22 が要る」と書いていた | **`node: ">=22"` を書いた** |
| 複製の根 | README「指すな」・実装「受け付けて `plugin/` へ降りる」 | **実体のとおりに書いた** |
| `pythonPath` の説明 | 「既定は `python3`」だけ | **拒む形（相対路）と、その理由を書いた** |

## 実測

| 何 | 前 | 後 |
|---|---|---|
| `tools/` の行数 | 1445 + 道具 | **道具だけ** |
| `npm run check` | exit 0 | **exit 0** |
| 単体試験 | 232 | **232**（門は一つも掛かっていなかった） |

## 順序の不変条件

**取り戻す先を先に書く。** 消してから書くと、書く人が履歴を掘ることになる。

**門が掛かっていないことを、先に確かめる。** 掛かっていれば、
消すことは門を消すことになる。この 7 ファイルは試験 0・CI 0 だった。
