// 鮮度の判定規則。**正本は上流の宣言であり、この綴りは導出である。**
//
// 上流 `doctrine_docs/graph/ICD.md`「測った木の版と作り手」(ADR-155・ADR-172 決定3):
//
//   鮮度の判定規則: 記録時といまの `source_revision` が共に完全 SHA で等しく、かつ、
//   いまの `source_dirty` が false なら「同一」。共に完全 SHA で異なれば「相違」。
//   どちらかが null、または、いまの `source_dirty` が true か null なら「不明」。
//   三値であり、不明を肯定(同一)に丸めない。**読み手はこの規則を再定義しない。**
//
// なぜ一箇所へ寄せるか: 以前この規則は `build-overlay.mjs` の一行の三項式に埋まっており、
// 画面の側が別の分岐で読み替えていた。規則が二箇所に在ると、片方だけが直る。
// #294 第13信で上流が「読み手はこの規則を再定義しない」と宣言したので、こちらは
// **宣言から導く一つの関数**を持ち、他の場所では書かない(`test-single-source.mjs` が守る)。

/** 完全 SHA(コミットを一意に指す指紋)。短縮形や記号的な名前は「不明」へ倒す。 */
export const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * 三値を返す。`same` | `differs` | `unknown`。
 *
 * `currentDirty` は**いまの木**の汚れ(`source_dirty`)。宣言どおり、真か null なら
 * 「同一」を名乗らせない —— 未コミットの変更が在る木は、rev が同じでも中身が同じとは
 * 限らないからである。
 *
 * @param {{recordedRev: string|null, currentRev: string|null, currentDirty: boolean|null}} x
 * @returns {"same"|"differs"|"unknown"}
 */
export function revState({ recordedRev, currentRev, currentDirty }) {
  // どちらかが完全 SHA でなければ、比べる術が無い。
  if (!FULL_SHA.test(recordedRev ?? "") || !FULL_SHA.test(currentRev ?? "")) return "unknown";
  // **共に完全 SHA で異なれば「相違」。** 汚れの有無に依らない ——
  // 汚れは差を増やすだけで、既に在る差を消さない(下の註を見よ)。
  if (recordedRev !== currentRev) return "differs";
  // 等しい。ここで初めて汚れが効く。**false のときだけ**「同一」と言える ——
  // true も null も「言えない」側であり、肯定へ丸めない。
  if (currentDirty !== false) return "unknown";
  return "same";
}

// **宣言の曖昧さについて(#294 第7信で上流へ上げた)**
//
// 宣言の三文は、次の一点で重なる:
//
//   両方が完全 SHA で **異なり**、かつ、いまの `source_dirty` が true のとき、
//   第二文は「相違」と言い、第三文は「不明」と言う。
//
// ここでは**第二文を採った**。理由: rev が異なることは既に測れており、汚れはその差を
// 打ち消さない。汚れが効くのは「同じである」と**肯定する**ときだけである。
// 上流が逆に裁定したらこの関数を直す。**規則の正本はこちらではない。**
