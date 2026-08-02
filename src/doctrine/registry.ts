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
import type { Outcome, Registry } from "./model.js";

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
  return runJson<Registry>(["-c", PROBE, join(pluginRoot, "scripts")], options);
}
// doctrine:end SPEC-001
