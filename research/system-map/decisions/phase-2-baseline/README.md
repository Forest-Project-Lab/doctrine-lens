# Phase 2 開始時点の基準線(2026-08-09/10)

台帳 v3.2 と所有者裁定(`ADR-031`)に基づく。**動いている対象を古い写しのまま測らないため、
開始時点をここで固定する。** 以後の RED はここを起点に数える。

生ログは `logs/` に置いた。終了コードだけでなく、検査件数と対象 SHA をここに記す。

## 固定した対象

| | 値 | 取得 |
|---|---|---|
| Lens `main` | `91243700450705074f86f24bc41aa3ef038beb11`(v0.10.0) | 2026-08-09 21:23 UTC |
| Lens の作業枝 | `phase-2/baseline`(`main` から) | |
| Lens の open PR / Issue | 0 件 / #12 のみ | |
| Lens の CI(`9124370`) | `check` 成功・`system-map verify` 成功 | |
| Doctrine `main` | `773198b84df3140f82ed97b8a4e85da1e54cade6` | |
| Doctrine の版 | 0.11.0(tag `v0.11.0` = `03fb4bfc8be46e23b42cb94622609b9aa5fcabcd`) | |
| Doctrine の open Issue / PR | #212・#210・#208 / 0 件 | |
| **手元の導入実体** | `~/.claude/plugins/cache/forest-project-lab/doctrine/**0.10.0**` | |
| Lens の tag | `system-map/phase-0`・`system-map/phase-1-continue` | |

**版のずれ**: 手元の全門は 0.10.0 に対して回っている。0.10.0 には `scripts/map-draft-check.py` も
`skills/system-map-draft/` も無い(どちらも 0.11.0 で入った)。誰もこれを申告していない。
導入台帳の `doctrine@forest-project-lab` の唯一の登録は `projectPath` が別のプロジェクトを指しており、
`tools/doctrine-path.mjs` はこのプロジェクト向けの登録が見つからないまま先頭の項を黙って採っている。

## 環境の前提

この devcontainer では `git` が `dubious ownership` で止まる。`docs:measured` は `git cat-file` と
`git archive` を使うため、先に次が要る。

```bash
git config --global --add safe.directory /workspaces/doctrine_lens
```

`verify.mjs` のブラウザ三段は chromium が要る。CI は導入するが手元は入っていないことがある。

```bash
npx playwright install chromium-headless-shell
```

導入前に測ると三段が落ちる。**その状態を「基準線が赤い」と読んではならない。**
道具が無いことと、判定が赤いことは別である。

## 全門の結果(すべて終了コード 0)

| 門 | 終了コード | 件数 |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm test` | 0 | 通過 247 / 失敗 0 / 飛ばし 0 |
| `npm run compile` | 0 | `dist/extension.js` 228.7kb ・ `dist/webview.js` |
| `npm run docs:check` | 0 | 重さ error 0 / warn 0 / advisory 12 |
| `npm run docs:lint` | 0 | **重さ error の所見 0 件**(doctrine 0.10.0 で測定) |
| `npm run docs:terms` | 0 | 根の文書 5 件が辞書と合う |
| `npm run docs:measured` | 0 | 実測の主張 5 件(刻印つき 5 件)が木と合う |
| `npm run test:integration` | 0 | 通過 10 件 |
| `node .../prototype/verify.mjs` | 0 | 全 6 段通過 |
| `npm run package` | 0 | 12 ファイル / 105.9 KB |

`docs:check` の advisory 12 件のうち 9 件は `research/` 配下の .md が統治木の外で未分類であること、
3 件は印に見えて読めない綴りである。**そのうち一件が `target-1-doctrine-and-lens.json` の 718 行目**であり、
これは後述の M-17(アンカーの接頭)の RED と同じ場所を指している。

## `verify.mjs` の内訳

```
validator(四対象)    各 PASS 14 / FAIL 0 / SKIP 2
build                M-13 静的走査・M-14 計算(四対象を束ねて 最大 3 操作 / 到達 9 / 非該当 15)
test-gates           M-14 計算経路の正負
test-m13-browser     操作単位の assert・オフライン・負例 5
test-m14-browser     全到達要素の実クリック計測・全リンクの到達
test-labels-browser  ラベルの重なり 正 1 / 負 1
```

## 開始時点で実測した欠陥

### 1. 何も検めていない合格 — 10 件

`validate.mjs` の検査は `filter した集合を回し、違反が無ければ合格` の形をしている。
**集合が空でも合格になる。** 実測(検査ごとに見た件数):

| 対象 | M-01 | M-02 | M-03 | M-04 | M-05 | M-06 | M-07 | M-08 | M-09 | M-10 | M-11 | M-12 | M-15 | M-16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| doctrine-and-lens | 40 | 10 | 11 | 2 | 4 | 2 | 27 | 11 | 11 | 13 | 1 | 7 | 1 | 2 |
| lens-shipping | 22 | 6 | 7 | **0** | 3 | 1 | 18 | 7 | 7 | 4 | 1 | 8 | **0** | 1 |
| celery | 21 | 5 | 7 | **0** | 4 | **0** | 18 | 7 | 7 | 3 | 1 | 8 | **0** | **0** |
| fixture-rare-states(架空) | 15 | 3 | 3 | **0** | 6 | 1 | 14 | 3 | 3 | 1 | **0** | 4 | 1 | 1 |

太字の 8 件は「0 件を検めて合格」である。加えて M-14 を対象ごとに判ずると:

```
doctrine-and-lens          到達可能 8 / 非該当 2 / 最大 3
lens-shipping              到達可能 1 / 非該当 5 / 最大 2
celery                     到達可能 0 / 非該当 5 / 最大 -Infinity   ← 空
fixture-rare-states(架空)   到達可能 0 / 非該当 3 / 最大 -Infinity   ← 空
```

現在は四対象を束ねて数えているため隠れている(束ねると最大 3・到達 9)。
**合わせて 10 件。** これが以後の RED の起点である。

### 2. 模型を一切見ない SKIP

`validate.mjs` の末尾にある M-13・M-14 の SKIP は、模型の中身を参照しない二行の文である。
SKIP は終了コードに影響しない。同じファイルの冒頭が「SKIP は合格ではない」と宣言しているのと食い違う。

### 3. 実現先の種別の不一致

`gates.mjs` は実現先を `code_range` と `test` に限る。`validate.mjs` は実現を**一切見ない**。
検証用スキーマは `artifact` を含む種別を許す。上流の起草した模型が `artifact` を実現先に使い、
第一の門は通ったのに build で落ちた(#212 第1信ギャップ7・第2信で独立に再現)。

### 4. `test` の枝は一度も正で通っていない

四対象のアンカーの種別の実測: `code_range` 8 / `artifact` 5 / `document` 5 / `external_doc` 3 /
**`test` 0**。実現先として認めている二種のうち片方が、一度も正の例で通っていない。

### 5. `review_status` は全対象で `proposed` のみ

`confirmed` は一件も無い。したがって「`proposed` が正本表示に混ざらない」(M-07 の後半)は
検めようがない。実装もどこにも無い。

## 変えていないもの

帰結の画面・`REQ-000`・上流のスキーマ・`main` の既定の挙動。H 層は `UNASSESSED` のまま。
#210 は所有者の判定待ちのまま。
