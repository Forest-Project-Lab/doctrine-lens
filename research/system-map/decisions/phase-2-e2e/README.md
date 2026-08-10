# Phase 2 E2E — 二対象で鎖の全部を通す(作業の記録)

- 日付: 2026-08-10
- 位置づけ: **実験ブランチ内の作業の記録**であり、統治木の ADR ではない。
- 対象: **二つ**(所有者決定)。`doctrine-lens`(この木)と `doctrine`(上流)。
  **Doctrine に依存しない第三のリポジトリは実施していない**(下記「未達」)。

## 上流の固定

CI と同じ手順で固定 commit を取得した。

| | 値 |
|---|---|
| 固定(`doctrine.pin.json`) | 版 0.11.0 / tag `v0.11.0` / commit `03fb4bfcbe46e23b42cb94622609b9aa5fcabcd` の記録 |
| 実際に取得した commit | `pin/fetched-commit.txt`(`git rev-parse HEAD` で照合) |
| 道具の照合 | `pin/resolution.json` — **`pin_state: matched-version-only`** |

**commit の保証は、この手順の中の `git rev-parse HEAD` から来ている。**
道具側の `--require-pin` は版しか比べない(複製から引いた実体は commit を持たない)。
PR7 で `--require-commit` を作ったので、commit まで要る段はそちらで止められる。

## 対象 A: doctrine-lens(この木)

| 段 | 結果 | 記録 |
|---|---|---|
| 第一門 `map-draft-check.py` | **所見 0 / 機械検証不能 10 / 出所 34** | `doctrine-lens/logs/map-draft-check.json` |
| 第二門 `validate.mjs` ほか全 14 段 | PASS 72 / FAIL 0 / VACUOUS 18(了解済)/ SKIP 0 | `doctrine-lens/logs/verify/*.json` |
| 束ね `npm run package` | 12 ファイル / 115,815 byte | `vsix/identity.json` |
| VSIX の導入 | `forest-project-lab.doctrine-lens@0.10.0` | `vsix/install-check.json` |
| 実機の画面 | 拡張機能ホストで System Map が開く(11 件通過) | `src/integration/suite/extension.test.ts` |

機械検証不能 10 件の内訳は URL 5 件(取得しない)と、接頭 `doctrine` が
`--repo-prefix`(`doctrine-lens`)と異なるため対象外の 5 件である。
後者は**構造的**である —— `map-draft-check.py` は `--repo` と `--repo-prefix` を各一つしか
取らないので、二リポジトリ模型では必ずどちらかの出所が原理的に検証不能になる。

## 対象 B: doctrine(上流・固定した木)

技能 `system-map-draft`(固定した 0.11.0)の手順で候補模型を起草した。

| 段 | 結果 | 記録 |
|---|---|---|
| 起草 | 要素 10 / Flow 10 / 契約 5 / シナリオ 2 / アンカー 8 | `doctrine/draft-doctrine.json` |
| 第一門 `map-draft-check.py` | **所見 0 / 機械検証不能 0 / 出所 38** | `doctrine/logs/map-draft-check.json` |
| 第二門 `validate.mjs` | PASS 14 / FAIL 0 / **VACUOUS 3** | `doctrine/logs/validate.json` |
| overlay 生成 | 状態 `measured` / 記録 5 件 / 範囲計 5 | `doctrine/overlay-doctrine-upstream.json` |
| build(overlay 同梱) | M-14 PASS(到達可能な要素 4 件) | `doctrine/logs/build.json` |
| `gates.mjs`・ブラウザ二段 | 全件通過 | `doctrine/logs/*.json` |
| 画面 | `doctrine/shots/` 2 枚 | — |

第二門の VACUOUS 3 件は M-06・M-07b・M-16 —— **起草物に `verified` の契約が一つも無く、
`confirmed` の実体も無いから**である。昇格は人の仕事であり、起草者は候補しか置けない。
VACUOUS は合格ではないので、了解の記録が無ければ赤い(この写しでは了解を置いて通した)。

### 第一門が実際に落としたもの(起草の一巡目)

**11 件の所見が出た。**内訳は二種類である。

1. **引用が本文に無い(9 件)。** 括弧の全角と半角を取り違えていた
   (`「Skill(8つ)」` と書いたが本文は `「Skill（8つ）」`)。
   出所は「読んだ場所」であって「読んだつもりの場所」ではない、と門が言った。
2. **印の無いファイルを「コード範囲」と称していた(1 件)。**
   `plugin/skills/doc-author/SKILL.md` を `code_range` のアンカーにしたが、
   このファイルには注釈の印が打たれていない。**私の過大主張であり、門が正しく落とした。**
   種別を `document` へ直し、要素の実現を理由つきの「対象外」にした。
3. 出所がディレクトリを指していた(1 件)。ファイルを指すよう直した。

## 出荷する byte の同一性

VSIX の中の `extension/dist/extension.js` を取り出し、手元の `dist/extension.js` と
byte 比較した(sha256 一致)。さらに束ねの `\uXXXX` を復号し、生成物の特徴的な一文
(「この実測が言っていないこと」「この対象は【架空】である」ほか)が**出荷物の中に在る**
ことを見た。

**言えるのはここまでである。** 同じ byte を出荷していることと、拡張機能ホストで画面が
開くことは示した。**編集器の中で人がリンクを押したことは確かめていない。**

## 「所見 0」が意味すること

使った `map-draft-check.py` は上流 0.11.0 のものであり、**上流自身が #212 第3信で
「現時点ではまだ弱いまま」と述べている版**である(台帳上の素通し経路は約 35 本)。

対象 A の実測は **所見 0 件 / 機械検証不能 10 件 / 出所 34 件**、
対象 B は **所見 0 件 / 機械検証不能 0 件 / 出所 38 件**。

所見 0 件は「**検めた出所に違反が無かった**」という意味であり、
機械検証不能の件数についてこの門は何も言っていない。

## 実クリックの証拠の鎖(合成である)

「人が編集器の中で押した」ことは、以下の三つを継いだものであって、一つの試験ではない。

1. `test-m14-browser.mjs` が**同じ HTML** に対して実ブラウザで実クリックし、
   開いた先がアンカーの指す先と一致することを測っている(操作数 3 以内も同時に測る)。
2. VSIX が出荷するのが**同じ byte** であることを指紋で結んだ(上記)。
3. 拡張機能ホストで命令が実行され、画面が作られ、その HTML が渡ることを確かめた。

**webview は別の描画文脈であり、拡張機能 API から DOM を問う手段もクリックを送る手段も
無い。** したがって `human_validation: UNASSESSED — independent participant unavailable`。

## 未達(先に置く)

- **第三の独立リポジトリ** — 所有者決定により 2 対象。未実施。
  `target-3-celery.json` は代替にならない(全 5 要素が `not_applicable` で、M-14 の検査対象が 0)。
- **起草物を目録へ昇格していない。** `draft-doctrine.json` は `decisions/` に置いたままで、
  出荷する目録(`registry.json`)には入れていない。入れると全ての静止画と掃引が変わり、
  未確認の候補が VSIX へ入る —— **所有者判断である。**
- **H 層** — `UNASSESSED`。
- **M-07b** — 起草物でも `VACUOUS`。まだ一度も検められていない。
- `map-draft-check.py` の弱さ — 上流の次の反復。
- **overlay の総括の粗さ(この走行で気付いた)** — 全ての記録が `no-ranges` でも総括は
  `measured` になる。束ねた木を取り違えたときに、記録の側だけが「注釈対が無い」と言い、
  総括は最良の状態を名乗る。#212 へ挙げる。
