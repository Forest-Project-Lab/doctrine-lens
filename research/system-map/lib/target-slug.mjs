// 対象の id から、ファイル名に使える綴りを作る。
//
// なぜ要るか: 対象の id は人が読む名であり、括弧も日本語も入る
// (`fixture-rare-states(架空)`)。そのままファイル名にすると、置き場によっては
// 扱えない綴りが混ざる。かといって **読み側が名前で索くのは間違いである** ——
// 名前は人のためのものであり、索く鍵は各ファイルが自分で宣言した `target` である。
//
// つまりここが作るのは「人が見て分かる名前」だけで、**同一性の根拠ではない**。
// 別々の id が同じ名前へ潰れると、片方が黙って上書きされる。だから潰れたら止める。

/** ファイル名に使える綴りへ落とす。落とせなければ例外で止まる(空の名前を作らない)。 */
export function slugOf(id) {
  const s = String(id ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) throw new Error(`対象の id からファイル名を作れない(使える字が一つも無い): ${JSON.stringify(id)}`);
  return s;
}

/**
 * 名前が潰れ合っていないことを確かめる。
 *
 * **潰れを黙って通すと、二つの対象の実測が一つのファイルを奪い合い、
 * 後から書いた方だけが残る。**「片方が測られていない」ことは、どこにも現れない。
 */
export function assertUniqueSlugs(ids) {
  const byslug = new Map();
  for (const id of ids) {
    const s = slugOf(id);
    byslug.set(s, [...(byslug.get(s) ?? []), id]);
  }
  const collided = [...byslug.entries()].filter(([, v]) => v.length > 1);
  if (collided.length) {
    throw new Error(
      "対象の名前が潰れ合っている(別々の対象が同じファイル名になる): " +
        collided.map(([s, v]) => `${v.join(" と ")} → ${s}`).join(" / "),
    );
  }
}
