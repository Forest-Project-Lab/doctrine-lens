// doctrine:begin SPEC-001
// 経路の正規化。
//
// 上流は作業フォルダからの相対・`/` 区切りで返す。編集器は環境ごとの区切りで持つ。
// 突き合わせを一箇所に集めないと、Windows でだけ静かに外れる。
//
// ここは編集器の機能を使わない純粋な関数だけで書く（IMPL-001）。

/** 区切りを `/` に揃え、末尾の `/` を落とす。 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * 経路の突き合わせに使う形へ直す。
 *
 * Windows では大小文字を区別しない。`C:\Foo` と `c:\foo` は同じ場所である。
 * 区別する側（Linux・macOS の既定）で潰すと、大小違いの別ファイルが同じに見える。
 * そのため、どちらで動いているかを引数で受ける。既定は動いている環境に従う。
 */
export function forCompare(path: string, caseInsensitive = isCaseInsensitivePlatform()): string {
  const posix = toPosix(path);
  return caseInsensitive ? posix.toLowerCase() : posix;
}

/** いま動いている環境が経路の大小文字を区別しないか。 */
export function isCaseInsensitivePlatform(): boolean {
  return process.platform === "win32" || process.platform === "darwin";
}

/**
 * `absolute` が `root` の中に在るなら、`root` からの相対を `/` 区切りで返す。
 * 外に在るなら `null`。
 *
 * `root` そのものを渡したときは空文字ではなく `null` を返す。
 * 「根そのもの」は上流が返す範囲の経路になりえないためである。
 */
export function toRelative(
  root: string,
  absolute: string,
  caseInsensitive = isCaseInsensitivePlatform(),
): string | null {
  const rootKey = forCompare(root, caseInsensitive);
  const pathKey = forCompare(absolute, caseInsensitive);
  if (!rootKey || !pathKey) return null;
  if (!pathKey.startsWith(`${rootKey}/`)) return null;
  // 切り出しは正規化した長さで行い、返す値は元の大小文字を保つ。
  return toPosix(absolute).slice(rootKey.length + 1);
}

/**
 * `absolute` が `root` の中か、`root` そのものか。
 *
 * 統治木の中の文書かどうかを判じるのに使う。`toRelative` と違い、
 * 根そのものも中と見なす。
 */
export function isInside(
  root: string,
  absolute: string,
  caseInsensitive = isCaseInsensitivePlatform(),
): boolean {
  const rootKey = forCompare(root, caseInsensitive);
  const pathKey = forCompare(absolute, caseInsensitive);
  if (!rootKey || !pathKey) return false;
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}
// doctrine:end SPEC-001
