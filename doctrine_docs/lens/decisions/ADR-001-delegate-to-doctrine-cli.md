---
id: ADR-001
title: グラフの取得を doctrine の Python CLI に委ねる
type: ADR
domain: lens
status: accepted
owner: doctrine-lens-maintainer
created: 2026-07-28
updated: 2026-08-03
sources: []
impacts: [SPEC-001]
llm_context: task
---

# グラフの取得を doctrine の Python CLI に委ねる

## 背景

この拡張機能は統治木を読んで地図を描く。読む手段は二つある。
frontmatter を自前で解析する方法と、上流 doctrine の CLI が出す JSON を読む方法である。

上流の `dep-graph.py` は `--classify-edges --json` で節点と辺の全体を一度に返す。
実出力で形を確かめた。必要な情報はすべて含まれている。

## 却下した選択肢

**frontmatter を TypeScript で自前解析する。** `python3` に依存せず、保存の瞬間に反映でき、速い。
しかしこの案は、型・status・置き場所の規則を拡張機能の側にもう一つ持つことを意味する。
上流の `_registry.py` が変われば、ゲートは新しい規則で動き、画面だけが古い規則で描く。
仕様と実装の乖離は doctrine が検出対象としている失敗の型であり、それを描く道具が作り込むのは筋が通らない。

**CLI を正とし、編集中だけ TypeScript の速報を出す二層構成。** 速さと正しさを両取りできる。
しかし「いま画面が示しているのはどちらか」を読み手に説明する責任が生じる。
最初のスライスで払う代償として重い。速さが問題になってから足す。

## 決定

グラフの取得は上流 doctrine の Python CLI に委ねる。拡張機能は統治の規則を一切持たない。

## 帰結

- `python3` と doctrine プラグインが動作の前提になる。どちらも無い環境では、地図を出さず案内を示す。
  これは欠陥ではない。統治木の無い場所に描く地図は無い。
- 上流が型を増やせば、拡張機能を変更しなくても新しい型が地図に現れる。
- 取得は子プロセスの起動を伴うため、frontmatter の自前解析より遅い。
  保存のたびの再取得ではなく、束ねた再取得にする必要がある。
- 上流の JSON の形が変われば、このドメインが追随する。追随の責任の所在は ICD-001 に記した。
