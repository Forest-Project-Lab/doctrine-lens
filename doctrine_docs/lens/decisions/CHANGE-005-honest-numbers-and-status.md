---
id: CHANGE-005
title: 数を言い切らず数え、行に status と後継を出す
type: CHANGE
domain: lens
status: current
owner: doctrine-lens-maintainer
created: 2026-07-30
updated: 2026-08-02
sources:
  - https://github.com/Forest-Project-Lab/doctrine/issues/152
  - https://github.com/Forest-Project-Lab/doctrine/issues/153
  - https://github.com/Forest-Project-Lab/doctrine/issues/154
impacts: [SPEC-004, SPEC-006, TEST-004, TEST-006, IMPL-001]
llm_context: task
---

# 数を言い切らず数え、行に status と後継を出す

## 変更内容

三つを変える。いずれも**画面を増やさず、明細の中だけを直す**。

### 1. 「全検査」と言い切るのをやめ、上流が走らせた数を数えて出す

いまの脚注は `上流 docs-audit（全検査）を 2026-07-30 09:14 に実行` と出す。
「全検査」は主張であって数ではない。上流が検査を増やしても文言は変わらず、
減らしても変わらない。**数えていないことを数えたように書いている。**

上流 `docs-audit.py --json` の報告は `checks_run` を持つ（実測で 34 件の配列）。
橋がこれを捨てているので、画面は数を持てない。橋に通し、脚注を
`上流 docs-audit（34 検査）を 2026-07-30 09:14 に実行` にする。

### 2. 「絞っていない」ことを、木の健康状態に依らずに検める

いまの門（`src/test/consequence.test.ts`「上流の 34 検査すべてが橋を渡る」）は
`nonTrace.length > 0` を見ている。**追跡以外の所見が一件来れば通る。**

これは二つの意味で不十分である。

- **34 という数を検めていない。** 上流が 34 のうち 33 を絞っても通る。
- **木の健康状態に依っている。** いまこの木の所見は 1 件（`guard_liveness_gap`）で、
  それが偶然「追跡以外」なので通っている。**木が完全に緑になると、
  橋が正しいまま門が赤くなる。** 門が製品ではなく木を測っている。

上流の検査名の一覧を実行時に読み、`checks_run` と突き合わせる形へ替える。
あわせて、**偽のプラグインが返す混在の報告**で「橋が絞らないこと」を
木に依らずに検める（`src/test/store.test.ts` に既に在る手法を使う）。

### 3. 行に status と後継の id を出す

いまの行は `[記号][題名][id][後ろに N]` で、status を持たない。
起点の欄だけが status を出す。

実測で、これは誤読を生む。`REQ-002` を起点に置くと 21 行が出るが（`61a3775` の木）、
そのうち 4 件が非現行（`SPEC-002` が波 3、`SPEC-003` が波 4、`TEST-002` が波 4、
`TEST-003` が波 5）で、**現行と交互に混ざる。** 撤回して非現行になった文書が
「直すことになるもの」の一覧に並ぶ。

`superseded_by` は既に橋が取っている（`src/doctrine/titles.ts` の `supersededBy`）。
**取ったまま実装のどこにも使われていない**（実測で消費者は 0 件）。
これを行の副文へ出し、status も併せて出す。

## 理由（要求元）

三つとも**同じ一つの規律の破れ**である。SPEC-006 の制約に既にこう書いてある。

> **畳んだら必ず件数を書く。** 隠すことは抽象ではない。
> **良い状態を空白で表さない。** 「壊れている 0 ・ 足りない 0 ・ 循環 0」と数で言う。

「全検査」は数の代わりに言葉を置いている。門の `> 0` は数の代わりに存在を置いている。
status の欠落は、非現行という事実を空白で表している。**どれも数えずに済ませている。**

CHANGE-004 が直したのは「判断を読み手に押し付けない」ことだった。
この変更が直すのは「**数を数えずに主張しない**」ことである。

### なぜ今か

上流へ #152・#153・#154 を出した。これらは上流に概念や検査が無いので、
上流が動くまで呼び手側では解けない。**上流待ちのものと、待たずに直せるものを
分けたときに、待たずに直せる側に残ったのがこの三つである。**

### 要求元

REQ-002「一つの画面は一つの問いだけに答える」— 画面を増やさない。
REQ-004「コードを読んでいるときに、その根拠の文書へ行ける」— 後継の id は行き先である。

出どころは、利用者の指摘である。

> あくまでここはビューワーなので、ビューに纏わる問題を扱い、
> 統治側の問題はそこで切り分けるべきでないでしょうか？

この切り分けに従い、**統治の規則に触るものは上流の issue へ出し、
ビューの中の数と字面だけをここで直す。**

## 影響の初期見積

| 区分 | 見積 |
|---|---|
| 書き直す文書 | SPEC-004（所見の取得の返り値）・SPEC-006（行の形と脚注）・TEST-004・TEST-006・IMPL-001 |
| 新しく作る文書 | ADR-014（この三つをまとめて決める）・IMPACT-005 |
| 触る実装 | `src/doctrine/audit.ts`・`src/doctrine/graph.ts`・`src/model/view.ts`・`src/model/consequence.ts`・`src/shared/protocol.ts`・`src/webview/main.ts`・`src/panel/html.ts`・`src/l10n.ts`・`l10n/bundle.l10n.ja.json` |
| 触る意匠 | `DESIGN.md` §4「行」（行の形が変わる。§9-5 が「先にこの文書を直し、ADR で理由を残せ」と要求している） |
| 触る門 | `src/test/consequence.test.ts`・`src/test/titles.test.ts`・`src/test/store.test.ts`・`tools/mutate-check.mjs` |
| 降ろす文書 | 無い |

**行の形が変わるので、代価は意匠の正本にも及ぶ。** DESIGN.md を先に直さずに
実装を変えると `src/test/design.test.ts` が落ちる（それが ADR-013 の狙いである）。

正確な列挙は IMPACT-005 に置く。

## 実施の記録（段 14）

2026-08-02 に一周を終えた。

| 区分 | 見積 | 実測 |
|---|---|---|
| 書き直した文書 | 5（SPEC-004・SPEC-006・TEST-004・TEST-006・IMPL-001） | 8（見積の 5 に **ADR-014・IMPACT-004・NONGOAL-001** が加わった） |
| 新しく作った文書 | 2（ADR-014・IMPACT-005） | 2 |
| 触った実装 | 10 ファイル | 10（見積どおり。新しいファイルは作っていない） |

**見積が外したのは「雛形の節への追随」である。** ADR-014 を書いたあとで、
雛形が定める節と本文を突き合わせる実測をしたところ、43 件のうち 3 件が外れていた。

```
ADR      ADR-014      欠: 背景・却下した選択肢     ← この変更で今日書いた文書
IMPACT   IMPACT-004   欠: 影響するテスト・工数見積
NONGOAL  NONGOAL-001  欠: やらないこと・理由
```

**規律を知っていて、雛形を見ながら書いた文書がずれた。** そして
`docs-audit` は error 0 / warn 0 / advisory 0 のままだった。三件とも直した（いま 0 件）。
この実測をそのまま [doctrine#154](https://github.com/Forest-Project-Lab/doctrine/issues/154) の証拠にした。

### 門の実測

| 門 | 結果 |
|---|---|
| 単体 | 174 件すべて通る（171 → 174） |
| 突然変異 | 表の 39 件すべてを試験が捕まえる（素通り 0・不正 0） |
| 写し（画面） | 誤り 0・食い違い 0。720 / 480 / 280px で溢れ無し |
| 統合（実際の編集器） | 10 件すべて通る |
| 監査 | error 0・warn 0・advisory 1（開発環境の hooks 配線で、製品の外） |

### 門の側から出た欠陥

**写しの門が `undefined checks` を素通りさせた。** 写しの道具が `checksRun` を渡しておらず、
脚注が `Upstream docs-audit ran undefined checks at ...` と出たまま
「誤り 0・食い違い 0」と報告した。**画面に `undefined` / `NaN` / `[object Object]` /
`{0}` が出ないこと自体を門にした**（`tools/shoot-preview.mjs`）。
実際に壊して終了符号 1・4 件で発火することを確かめてある。

差し込みの失敗は型で守れない。**出来上がった字面を見るしかない。**

### 上流へ出したもの

この変更のあいだに 上流の issue 六本を、実測で裏づけて書き直した。

- [#149](https://github.com/Forest-Project-Lab/doctrine/issues/149) `title` が `to_json` の白名簿から漏れている（内部の節点は 12 項を持ち、出力は 8 項）
- [#150](https://github.com/Forest-Project-Lab/doctrine/issues/150) `trace-index.py` が `.gitignore` を見ない（30 件のうち 12 件が写し）
- [#151](https://github.com/Forest-Project-Lab/doctrine/issues/151) 同じ関係が二本の辺として返る（60 本のうち 16 本。本当の循環は 0）
- [#152](https://github.com/Forest-Project-Lab/doctrine/issues/152) コア／支援／汎用を表せない。変わるのに追えない
- [#153](https://github.com/Forest-Project-Lab/doctrine/issues/153) 製品の目的を置く型が無い（`REQ` を `_system/` に置くと ERROR になることを実証）
- [#154](https://github.com/Forest-Project-Lab/doctrine/issues/154) 雛形の節を検める検査が無い

**上流に概念や仕組みが無いものは、こちらでは何もしない。** 暫定で書けば正本が二つになる。
