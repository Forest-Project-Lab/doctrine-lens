---
id: CHANGE-019
title: 自分で作った門を、自分が読んでいなかった
type: CHANGE
domain: lens
status: proposed
owner: doctrine-lens-maintainer
created: 2026-08-03
updated: 2026-08-03
sources: []
impacts: [SPEC-006, TEST-006]
llm_context: task
---

# 自分で作った門を、自分が読んでいなかった

## 何が起きていたか

**`npm run check` が赤いまま、「全門が緑」と報告し続けていた。**

```console
$ npm run check
check exit=1

文書の実測が、いまの木と合わない 4 件:
  - ADR-014: REQ-002 は 21 行（19 と書いてある）
  - CHANGE-005: REQ-002 は 21 行（19 と書いてある）
  - CHANGE-012: DECIDED-001 は 0 行（17 と書いてある）
  - SPEC-006: REQ-002 は 21 行（19 と書いてある）
```

原因は**出力の読み方**である。毎回こう絞っていた。

```console
$ npm run check 2>&1 | grep -E "^# (pass|fail)|totals"
# pass 230
# fail 0
totals: error=0 warn=0 advisory=1
```

**`docs:measured` の出力は、この絞りに一行も掛からない。** 自分で `check` に足した段を、
自分が一度も読んでいなかった。**終了コードも見ていなかった。**

## 三つ重なっていた

| | 何 |
|---|---|
| 1 | **出力を絞って読み、終了コードを見ていなかった** |
| 2 | **CI がその段を走らせていない**（`docs:measured`・`preview`・`mutate` の三つ） |
| 3 | 門そのものが**誤りの引用を主張として読んだ** |

3 は門の側の欠陥である。変更の記録は「こう書いてあったが**誤りだった**」を引く。
`CHANGE-012` は `CHANGE-016` で直した誤りを引用しており、
**直した記録そのものが門を赤くしていた。**

## CI が走らせていない門

```
CI で走る  typecheck  test  compile  docs:check  test:integration  package
CI に無い  docs:measured  preview  mutate
```

`TEST-006` は受入 10・11・34 の受け持ちを「**画面側（`npm run preview`）**」と宣言している。
だが **CI は `preview` を呼ばない。** 手元で誰かが走らせたときにしか検められない。

**宣言した受け持ちが、機械の経路に無い。**

## 変更内容

1. **門の出力を絞って読まない。** 報告する前に**終了コードを見る**。
2. **CI に `docs:measured` と `preview` を足す。** どちらも数十秒である。
3. `mutate` は 25 分かかるので CI には入れない。**入れない理由を書く**——
   `PROC` に当たる文書が無いので、`TEST-007` の合否基準に書く。
4. 門が**誤りの引用を主張として読まない**ようにする（直前の文脈に「誤り」等が在れば飛ばす）。
5. **古い `.vsix` を消す。** 作るたびに上書きされる形にし、根に残さない。
6. **統合試験にも主張を持たせる。** 「主張ゼロの試験」の門を `src/integration/` へ広げる。

## 同じ日に、同じ形が三度目

`CHANGE-018` は「捨てた画面の写しが `.gitignore` の中に残った」だった。
**同じ形が、製品そのもので起きていた。**

```console
$ ls -l doctrine-lens.vsix        # 2026-08-02 21:03
$ 中身の版: 0.6.0 / 木の版: 0.9.2  # 三版うしろ
$ grep vsix .gitignore
*.vsix
```

**公開経路は「`.vsix` を手で上げる」である。** つまり、この古い写しがそのまま
利用者へ届きうる。写しの残骸は `npm run preview` で作り直せば直るが、
**こちらは配る道の入口に在る。**

`npm run package` は毎回作り直すので、**古いものが残っていること自体が危うい。**
消して、作るたびに上書きされる形へ寄せる。

## 受入 1 の受け持ちが、「例外が出なかった」だけだった

`TEST-006` は受入 1（**利用者が何も選ばずに、カーソルの居る範囲が指す文書が起点になる**）の
受け持ちを「画面側（`npm run test:integration`）」と宣言していた。

**その統合試験は、主張を一つも持っていなかった。**

```ts
await vscode.commands.executeCommand("doctrineLens.open");
// webview が開いたことは、命令が例外なく終わったことで足りる。
```

**この製品の中核の受入が、「落ちなかった」だけで通っていた。**
同じ形が `005-5` にも在った（10 件中 2 件）。

### 検められるところまでしか主張しない

主張を足そうとして、**明細の起点そのものは拡張機能ホストから読めない**と分かった——
起点は webview へ `postMessage` で渡るので、痕跡が残らない。

**できないことを、できるふりで書かない。** 受入 1 を二つに割った。

| 何 | 受け持ち |
|---|---|
| カーソルから**範囲が引ける** | `npm run test:integration`（同じ `rangeAtLine` を通る） |
| その起点で**明細が描かれる** | `npm run preview`（実物の画面） |

範囲の解決を殺して、**2 件が赤くなる**ことを確かめた。

```
AssertionError: カーソルの位置から範囲が引けていない: src/model/consequence.ts
8 passing / 2 failing
```

### 「主張ゼロの試験」の門が、統合試験を見ていなかった

`CHANGE-013` で足した門は `src/test/` だけを走査しており、
**`src/integration/` は対象外**だった。だから二件を見逃した。

## 見えている難所

**`preview` は playwright を要る。** CI で走らせるには browser の導入が要り、
`test:integration` の `xvfb` と同じ扱いになる。**時間を測ってから入れる。**

## 理由（要求元）

`ADR-017`「自分の門が緑であることを正しさの証拠にしない」——
**そもそも門を読んでいなければ、緑かどうかも知らない。**

## 影響の初期見積

| 区分 | 見積 |
|---|---|
| 書き直す文書 | `TEST-006`（受け持ちの宣言）・`TEST-007`（合否基準） |
| 新しく作る文書 | 影響の記録 |
| 触る実装 | 無し |
| 触る門 | `.github/workflows/check.yml`・`tools/check-measured-claims.mjs` |
