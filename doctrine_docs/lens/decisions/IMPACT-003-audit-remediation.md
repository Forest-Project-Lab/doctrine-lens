---
id: IMPACT-003
title: 公開前監査の直しの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
depends_on: [CHANGE-003]
llm_context: task
---

# 公開前監査の直しの影響

## 影響する文書

| 文書 | 関係 | 要る変更 |
|---|---|---|
| SPEC-001 | 変更の対象 | 起動条件を定める。設定の scope を定める |
| SPEC-005 | 変更の対象 | キー割り当てを持たないことを定める |
| ICD-001 | SPEC-001 が依存 | 上流の入力の数え違い（三つ→四つ）を直す |
| IMPL-001 | 全 SPEC に依存 | 部品の表を実体に合わせる |
| TEST-001 | SPEC-001 に依存 | 受入基準 6〜10 の行を足し、合否基準の項数を直す |
| TEST-002 | SPEC-002 に依存 | 合否基準の項数を直す（七項→十項） |
| TEST-005 | SPEC-005 に依存 | 受入基準 8〜10 の行を足し、項数を直す |
| NONGOAL-001 | 常時注入 | 雛形の空欄を実体で埋める |

## 影響する実装

| 部品 | 変更 |
|---|---|
| `package.json` | キー割り当てを外す。設定に scope を付ける。起動条件を足す。配布の script |
| `src/statusbar.ts` | 食い違いの数を session から取る。判定の時刻の文言を正す |
| `src/session.ts` | 食い違いの数を状態に載せる |
| `src/panel/html.ts` | `lang` を編集器の表示言語から取る |
| `src/panel/lensPanel.ts` | 表示言語を器へ渡す |
| `src/webview/main.ts` | 死蔵した訳を使う。全角約物を外す。判定の時刻を描く |
| `src/l10n.ts` | 使う場所の無い訳を落とす。数を伴う文言を書式にする |
| `src/test/l10n.test.ts` | 全角約物を検出できるようにする |
| `.vscodeignore`・`.gitignore` | `docs/` ほかの穴を塞ぐ |
| `.devcontainer/setup-claude-bypass.sh` | 設定の併合を実際の再帰にする |
| `README.md` | Marketplace の読み手向けの導入手順を先に置く |

## 影響するテスト

| 試験 | 変更 |
|---|---|
| `src/test/l10n.test.ts` | 全角約物の検出を足す（これが無いと同種の混入を今後も止められない） |
| `src/test/manifest.test.ts` | 新規。配布 manifest の性質（キー割り当て・scope・起動条件）を字面で守る |

## 境界

ドメインを跨がない。lens ドメインの内側で閉じる。

## 工数見積

決定が三つ、実装の変更が十一、試験が二つ、統治文書の追随が八。
いずれも小さい。数が多いだけである。
