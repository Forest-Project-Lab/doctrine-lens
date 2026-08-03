// doctrine:begin SPEC-001
// 上流の登録簿をその場で読む。
//
// これがあるおかげで、このドメインは型コードの一覧も status の語彙も持たずに済む
// （REQ-003）。上流が型を増やせば、こちらを変えなくても新しい型が地図に現れる。
//
// 読むのは `_registry` だけである。`_registry` は標準ライブラリしか使わず、
// 読み込みに副作用を持たない（上流の冒頭がその保証限界を明記している）。
import { join } from "node:path";

import { runJson, type RunOptions } from "./cli.js";
import { fail, ok, type Outcome, type Registry } from "./model.js";

/**
 * 上流の登録簿を読んで JSON を出す問い合わせ。値の正本は上流にある。
 *
 * 先頭で探索路から作業フォルダ（`""` と `"."`）を落とす。python は `-c` のとき
 * `sys.path[0]` に作業フォルダを入れるので、落とさないと `json` すら
 * その場所から先に読まれる。共有の機械で作業フォルダが誰でも書ける場所だと、
 * 置かれた `json.py` がこの問い合わせで走る（起動のたび・保存のたびに走る）。
 * 呼ぶ側でも私有の作業フォルダを渡すが（cli.ts の safeCwd）、二重に塞ぐ。
 */
const PROBE = [
  "import sys",
  'sys.path[:] = [p for p in sys.path if p not in ("", ".")]',
  "sys.path.insert(0, sys.argv[1])",
  "import json",
  "import _registry as r",
  "json.dump({",
  '  "types": list(r.TYPES),',
  '  "currentStatuses": sorted(r.CURRENT_STATUSES),',
  '  "allStatuses": list(r.ALL_STATUSES),',
  "}, sys.stdout)",
].join("\n");

/**
 * 上流の登録簿の写しを得る。
 *
 * 写しを保存しない。呼ぶたびに読み直すため、上流を更新した直後から新しい値が効く。
 */
export async function fetchRegistry(
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<Registry>> {
  const outcome = await runJson<unknown>(["-c", PROBE, join(pluginRoot, "scripts")], options);
  if (!outcome.ok) return outcome;

  // **形を検める。** グラフ・範囲・所見・逆孤児はいずれも検めており、ここだけが
  // 素通しだった。項を一つ欠いた値が返ると `new Set(undefined)` が空集合になり、
  // 「現行が一語も無い」＝全行が非現行、に化ける（ADR-023）。
  const value = outcome.value;
  if (!value || typeof value !== "object") {
    return fail<Registry>("bad-json", "the registry is not an object");
  }
  const record = value as Record<string, unknown>;
  const lists: Record<string, string[]> = {};
  for (const key of ["types", "currentStatuses", "allStatuses"]) {
    const raw = record[key];
    if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
      return fail<Registry>("bad-json", `the registry has no string list "${key}"`);
    }
    lists[key] = raw as string[];
  }
  return ok<Registry>({
    types: lists["types"] as string[],
    currentStatuses: lists["currentStatuses"] as string[],
    allStatuses: lists["allStatuses"] as string[],
  });
}
// doctrine:end SPEC-001
