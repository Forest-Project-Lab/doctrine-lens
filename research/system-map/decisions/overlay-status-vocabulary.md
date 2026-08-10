# DESIGN-002: 実測 overlay の状態語彙を正本へ移し、機械が数える(実験ブランチ内の設計判断の記録)

- 日付: 2026-08-10
- 位置づけ: **これは実験ブランチ内の設計判断の記録**であり、統治木の ADR ではない。
  Phase 2 の終了裁定で ADR を起こす。所有者の裁定は 2026-08-10 の「語彙の正本化 —
  両方を正本へ移す」による(引き継ぎの問い 4)。

## 決定

1. 実測 overlay の状態は**二階建て**である。アンカー一件ごとの状態(六)と、
   対象一件ごとの総括(四)を混ぜない。
2. 総括の語彙は `registry.json` の `policy.overlay_statuses` が持つ。
   「測る対象が無い」を表す `empty_status` を明示し、**記録 0 件と一対一で対応**させる。
3. アンカーの状態の対応表は `policy.display.overlay_status_entry` が持つ。
   **語彙そのものは生成器(`overlay/build-overlay.mjs`)の綴りが正本**であり、
   表と生成器が一致することを段 `display-static` が毎回数える。
4. 時間切れ・受け皿超過は**新しい状態を作らず** `unverifiable` の理由で言う。
   状態を増やすと画面と了解の記録の両方が増え、増えたことを誰も検めない。
5. 「実測」と名乗ってよいのはちょうど二状態である。数を正本の側で固定する。

判断理由(要旨): 六つの状態は生成器のコードにしか無く、`schema.json` にも
`registry.json` にも無かった。したがって `test-single-source.mjs` の走査対象に一つも
当たらず、**M-S1 が塞ごうとしている穴が overlay については開いたままだった。**
実際に、画面はそのうち四つを黙って落としていた(PR6 の RED)。

**別の schema ファイル(`overlay.schema.json`)は作らなかった。** 作ると正本が三つに
なり、「どれが本当か」を人が覚えることになる。いま在るのは (a) 総括の語彙一覧、
(b) 生成器の綴り、(c) 両者を突き合わせる段 —— **(c) が在るので (a) と (b) が
離れれば落ちる**。ファイルを増やさずに同じ性質が得られる。

## アンカー一件ごとの状態(六)

この表は正本ではない。正本は生成器の綴りであり、対応は `policy.display` が持つ。

| 状態 | 生成箇所 | 意味 | **何を言っていないか** |
|---|---|---|---|
| `unbound-repo` | 接頭が束ねられていない | この接頭の木が `--repo` / `--docs-root` で束ねられていない | 対象が壊れているとは言っていない |
| `unverifiable` | CLI が答えない | 空・非 JSON・想定外の形・失敗・時間切れ・受け皿超過 | 範囲が無いとは言っていない |
| `unparsed` | 指す先を読めない | アンカーの指す先を経路として読めない | 経路が実在しないとは言っていない |
| `measured` | 走査成功・範囲あり | この rev のこの経路に、この指紋の範囲が在った | **印が意味の上で正しい場所に在るとは言っていない**(`source_limits`) |
| `degraded` | 走査成功・上流の所見あり | 範囲は在るが、この経路について上流が所見を挙げている | 所見の重さは言っていない |
| `no-ranges` | 走査成功・範囲なし | 走査は通ったが、この経路に注釈対が無い | 印を打ち忘れたのか要らないのかは言っていない |

## 対象一件ごとの総括(四)

`measured` / `degraded` / `unverifiable` / `no-candidates`。
前の三つはアンカーの状態の最悪値であり、`worktree.dirty` と `worktree.shallow` を
畳み込む。`no-candidates` は**測る対象が一つも無かった**ことを言い、記録 0 件と
一対一で対応する(書込時と読込時の両方で検める)。

**`no-candidates` を `measured` と同じ形にしていたのが、この記録を書く直接の理由である。**
どの `.some()` も空配列では偽になるので、何も測っていない走行が最良の状態を名乗っていた。

## 由来を辿れない木

`worktree.dirty` / `shallow` / `generated_from_rev` は、git でない木では **`null`** である。
`false` ではない。以前は `(null || "") !== ""` が偽になり、由来ゼロの木が
「清らかな木」として記録されていた —— **分からないことを、問題が無いことに変換していた。**

## H 層の扱い

`human_validation: UNASSESSED — independent participant unavailable`

状態語彙が読み手に区別できるかは H 層の問いであり、機械では答えられない。
`usability-tests/h-layer-protocol.md` の T6(希少状態の読み分け)に連なるが、実施していない。

## 実装(この記録と同じ変更で実施)

| 物 | 中身 |
|---|---|
| `gold-model/registry.json` | `policy.overlay_statuses`(総括・`empty_status`)・`policy.overlay_candidate`・`policy.display.overlay_status_entry` |
| `gold-model/spec.mjs` | 読み込み時に全単射と `empty_status` の所属を検める |
| `overlay/build-overlay.mjs` | `no-candidates` の生成・落ち方の言い分け・由来不明の `null` |
| `prototype/build.mjs` | 六状態を別々の文で出す・未知の語は `unknown_token` へ |
| `prototype/test-display-static.mjs` | 生成器の綴りと表の突き合わせ(**採れなければ ERROR**) |
| `prototype/test-chaos.mjs` | 壊れた道具・答えない CLI・由来の無い木で、状態が正しく付くこと |

## 別 issue へ送るもの

- 総括が `worktree.shallow` を `degraded` へ畳むか、独立の欄にするか。ここでは畳む(現状維持)。
- 上流が `findings` の**重さ**を返さないので、`degraded` は所見の有無しか言えない。
  重さを問える口が要るなら doctrine#212 へ提案する。
