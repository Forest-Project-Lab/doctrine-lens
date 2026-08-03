---
id: IMPACT-002
title: 配れる状態にすることの影響
type: IMPACT
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-07-28
sources: []
depends_on: [CHANGE-002]
llm_context: task
---

# 配れる状態にすることの影響

## 影響する文書

| 文書 | 関係 | 要る変更 |
|---|---|---|
| SPEC-001 | 変更の対象 | 作業フォルダの解決を複数対応にする。取得の拍を二つに分ける |
| SPEC-005 | 変更の対象 | 表示の文字列の出どころを定める |
| SPEC-002・SPEC-004 | SPEC-001 に依存 | 取得の拍が変わるため、範囲と所見の来かたの記述を合わせる |
| IMPL-001 | 全 SPEC に依存 | 部品の表に三つ足す（状態の帯・経路・翻訳） |
| TEST-001・TEST-005 | 対応する SPEC に依存 | 受入の項を足す |

## 影響する実装

| 部品 | 変更 |
|---|---|
| `src/model/paths.ts` | 新規。経路の正規化。Windows の区切りと大小文字を吸収する |
| `src/model/workspace.ts` | 新規。複数の作業フォルダから統治木を持つものを選ぶ |
| `src/session.ts` | 作業フォルダの解決を差し替え。取得を二つの拍に分ける |
| `src/statusbar.ts` | 新規。取得の状態を地図の外でも示す |
| `src/l10n.ts` | 新規。表示の文字列を一箇所に集める |
| `package.nls.json`・`package.nls.ja.json` | 新規。manifest の文字列の翻訳 |
| `l10n/bundle.l10n.ja.json` | 新規。実行時の文字列の翻訳 |
| `src/webview/main.ts` | 文字列を本体から受け取る形にする |
| `src/panel/lensPanel.ts` | 翻訳の一式を webview へ渡す |

## 影響するテスト

| 試験 | 変更 |
|---|---|
| TEST-001 | 作業フォルダの解決（複数・Windows の経路）を足す |
| TEST-005 | 表示の文字列がすべて翻訳を経ることを足す |

## 境界

ドメインを跨がない。lens ドメインの内側で閉じる。

## 工数見積

新規の部品が五つ、翻訳の資源が三つ、既存の変更が三つ、試験が二つ。
配れない欠落の側（`private`・`.vscodeignore` ほか）は決定を含まないので数える対象にしない。
