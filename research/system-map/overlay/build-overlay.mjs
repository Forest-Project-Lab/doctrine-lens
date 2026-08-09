// Phase 2 の予習: build 時の実データ overlay。
//
//   node build-overlay.mjs   →  overlay-doctrine-and-lens.json
//
// 宣言済み CLI(上流 ICD 002 trace-index-api)を build 時に一度だけ実行し、
// 対象1のアンカー(authority=doctrine の code_range)へ「実測の範囲・指紋」を重ねる。
// - 読むのは CLI の標準出力だけ(台帳 v3.2-14。.claude/.cache は読まない)。
// - doctrine 対象の鮮度判定は doctrine の機構(指紋・rev)だけを使う(v3.2-10)。
// - 実行時の外部読取りは零のまま(overlay は build 時に固定 JSON 化される。M-13 不変)。
// - CLI の返す値は「事実」であり、モデルの proposed 値と混ぜず出所付きで表示する。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModels } from "../gold-model/spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

const pluginRoot = execFileSync("node", ["tools/doctrine-path.mjs"], { cwd: repo, encoding: "utf8" }).trim();
const traceOut = execFileSync(
  "python3",
  [join(pluginRoot, "scripts", "trace-index.py"), "--root", repo, "--docs-root", join(repo, "doctrine_docs"), "--format", "json"],
  { cwd: repo, encoding: "utf8" },
);
const trace = JSON.parse(traceOut);
if (trace.schema !== "trace-index/1") {
  console.error("想定外の schema:", trace.schema);
  process.exit(1);
}
const headRev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

// 実測を重ねる対象は registry.json が正本(役割 overlay)。ここでは名を持たない。
const overlayTargets = loadModels("overlay");
if (overlayTargets.length !== 1) {
  console.error(`overlay の対象がちょうど一つでない: ${overlayTargets.length} 件。複数対象は別の主題。`);
  process.exit(2);
}
const model = overlayTargets[0];
const pathOf = (t) => (t.match(/src\/[\w\/.-]+\.ts/) ?? [null])[0];

const entries = [];
for (const a of model.anchors) {
  if (a.authority !== "doctrine" || a.target_kind !== "code_range") continue;
  const p = pathOf(a.target);
  if (!p) continue;
  const ranges = trace.ranges.filter((r) => r.path === p);
  entries.push({
    anchor_id: a.id,
    path: p,
    recorded_rev: a.source_revision,
    current_rev: headRev,
    rev_state: headRev === a.source_revision ? "same" : "advanced",
    ranges_now: ranges.map((r) => ({ id: r.id, begin_line: r.begin_line, end_line: r.end_line, fingerprint: r.fingerprint })),
  });
}

const overlay = {
  schema: "system-map/overlay/0.1",
  target: "doctrine-and-lens",
  source: "上流 ICD 002 trace-index-api(trace-index/1)を build 時に実行した標準出力",
  generated_at: new Date().toISOString().slice(0, 10),
  generated_from_rev: headRev,
  entries,
};
writeFileSync(join(here, "overlay-doctrine-and-lens.json"), JSON.stringify(overlay, null, 2));
console.log(`overlay を生成した: ${entries.length} アンカー / 現 rev ${headRev.slice(0, 7)} / 範囲計 ${entries.reduce((n, e) => n + e.ranges_now.length, 0)} 件`);
