// doctrine:begin SPEC-004
// 追跡索引の橋渡し — 印が囲むコード範囲を上流から取る。
//
// 事実だけを取る。指紋が食い違っているかどうかの判定はここでは行わない。
// 判定は audit.ts が上流の所見として受け取る（ADR-005）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runJson, type RunOptions } from "./cli.js";
import { fail, ok, type Outcome } from "./model.js";

/** 上流 `trace-index/1` が返す一つの範囲。行の番号は 1 から数える。 */
export interface TraceRange {
  /** 結ばれた文書の id。 */
  id: string;
  /** 作業フォルダからの相対パス。`/` 区切り。 */
  path: string;
  begin_line: number;
  end_line: number;
  fingerprint: string;
  [extra: string]: unknown;
}

export interface TraceIndex {
  ranges: TraceRange[];
  [extra: string]: unknown;
}

/**
 * 統治外の宣言（`_system/.context-config.json` の `trace_exempt`）を読む。
 *
 * 形は `{パス: 理由}`。理由の無い項目・文字列でない項目は宣言として成立しないので
 * 読み飛ばす。読めなければ空とする（宣言が無いものとして扱う）。
 *
 * 上流の照合規則をこちら側に写す唯一の箇所である（SPEC-004）。
 * `trace-index.py` が絞り込んだ範囲を返す手段を持たないため、他に方法が無い。
 */
export function readExemptPaths(docsRoot: string): string[] {
  const configPath = join(docsRoot, "_system", ".context-config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const table = (parsed as { trace_exempt?: unknown })?.trace_exempt;
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const out: string[] = [];
  for (const [path, reason] of Object.entries(table as Record<string, unknown>)) {
    if (typeof path === "string" && path && typeof reason === "string" && reason.trim()) {
      out.push(path);
    }
  }
  return out.sort();
}

/**
 * 統治外の宣言との照合。上流と同じ規則にする。
 *
 * 末尾が `/` のパスは前置きの一致（配下すべて）、それ以外は完全一致。
 */
export function isExempt(relPath: string, exemptPaths: readonly string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  for (const p of exemptPaths) {
    if (p.endsWith("/")) {
      if (normalized.startsWith(p)) return true;
    } else if (normalized === p) {
      return true;
    }
  }
  return false;
}

/**
 * 印が囲む範囲を取る。統治外に宣言されたパスの範囲は落とす。
 *
 * 上流の `findings` は読まない。走査の所見は監査が畳んで返すので、
 * 同じものを二か所から読むと食い違いの元になる（SPEC-004）。
 */
export async function fetchTraceRanges(
  projectDir: string,
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<TraceRange[]>> {
  const outcome = await runJson<TraceIndex>(
    [
      join(pluginRoot, "scripts", "trace-index.py"),
      "--root", projectDir,
      "--docs-root", docsRoot,
      "--format", "json",
    ],
    options,
  );
  if (!outcome.ok) return outcome;
  if (!Array.isArray(outcome.value?.ranges)) {
    return fail<TraceRange[]>("bad-json", 'the value has no "ranges"');
  }

  const exempt = readExemptPaths(docsRoot);
  const kept = outcome.value.ranges.filter(
    (range) =>
      typeof range?.path === "string" &&
      typeof range?.id === "string" &&
      !isExempt(range.path, exempt),
  );
  // 並びを決定的にする。上流も整列して返すが、絞ったあとに保証をこちらでも持つ。
  kept.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.begin_line - b.begin_line ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ok(kept);
}
// doctrine:end SPEC-004
