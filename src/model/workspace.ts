// doctrine:begin SPEC-001
// 作業フォルダが複数のとき、どの統治木を見るかを決める（ADR-006）。
//
// ここは編集器の機能を使わない純粋な関数だけで書く（IMPL-001）。
// 実際のフォルダの一覧と統治木の解決は呼び手が渡す。
import { forCompare } from "./paths.js";

/** 統治木を持つ作業フォルダ一つ。 */
export interface TreeCandidate {
  /** 作業フォルダの絶対パス。 */
  readonly folder: string;
  /** その中で解決した統治木の絶対パス。 */
  readonly docsRoot: string;
  /** 画面に出す名前。作業フォルダの名前。 */
  readonly label: string;
}

/**
 * 作業フォルダの一覧から、統治木を持つものだけを候補として集める。
 *
 * `resolve` は一つのフォルダを受けて統治木を返すか `null` を返す関数である。
 * 並びは決定的にする（フォルダの絶対パスの整列順）。
 */
export function collectCandidates(
  folders: readonly string[],
  resolve: (folder: string) => string | null,
): TreeCandidate[] {
  const found: TreeCandidate[] = [];
  for (const folder of folders) {
    const docsRoot = resolve(folder);
    if (docsRoot) {
      found.push({ folder, docsRoot, label: basename(folder) });
    }
  }
  return found.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
}

/**
 * 候補から実際に見るものを選ぶ（ADR-006）。
 *
 * 1. 利用者が明示に選んだフォルダが候補に在ればそれ。
 * 2. 無ければ整列順の先頭。
 * 3. 候補が空なら `null`。
 *
 * 覚えていたフォルダが候補から消えていたら、黙って先頭へ落ちる。
 * フォルダを閉じただけで何も出なくなるのは、利用者の意図ではない。
 */
export function chooseCandidate(
  candidates: readonly TreeCandidate[],
  remembered: string | undefined,
): TreeCandidate | null {
  if (candidates.length === 0) return null;
  if (remembered) {
    const key = forCompare(remembered);
    const match = candidates.find((c) => forCompare(c.folder) === key);
    if (match) return match;
  }
  return candidates[0] ?? null;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
// doctrine:end SPEC-001
