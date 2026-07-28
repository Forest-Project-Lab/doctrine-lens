// doctrine:begin SPEC-004
// 監査の橋渡し — 判定を上流から受け取る。
//
// このスライスで読むのは、検査名が `trace` で始まる所見だけである。
// 指紋が食い違っているかどうかは上流が判じる。こちらは指紋を突き合わせない（ADR-005）。
import { dirname, join, resolve } from "node:path";

import { forCompare } from "../model/paths.js";
import { runJson, type RunOptions } from "./cli.js";
import { fail, ok, type Outcome } from "./model.js";

/** 上流 `docs-audit/1` が返す一つの所見。 */
export interface AuditFinding {
  /** 検査の名。上流が名づける。 */
  check: string;
  /** `error` / `warn` / `advisory`。上流が定める。 */
  severity: string;
  /** 所見が指す文書の id。無いこともある。 */
  doc_id: string;
  /** 統治木からの相対パス。無いこともある。 */
  path: string;
  message: string;
  refs: string[];
  [extra: string]: unknown;
}

export interface AuditReport {
  findings: AuditFinding[];
  /** 上流が実際に監査した統治木の絶対経路。 */
  root?: unknown;
  [extra: string]: unknown;
}

/** 追跡に関わる検査名の前置き。上流の検査名の付け方に従う。 */
const TRACE_PREFIX = "trace";

/**
 * 所見のうち追跡に関わるものだけを取り出す。
 *
 * 前置きで選ぶので、上流が `trace_` で始まる検査を増やしても、
 * こちらを変えずに拾える。検査名の一覧をこちらが持たない（REQ-003）。
 */
export function traceFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return findings.filter(
    (f) => typeof f?.check === "string" && f.check.startsWith(TRACE_PREFIX),
  );
}

/**
 * 指紋が食い違っている文書の id を集める。
 *
 * 判定そのものは上流が済ませてある。ここでしているのは、
 * 上流が挙げた所見から id を拾うことだけである。
 */
export function staleDocumentIds(findings: readonly AuditFinding[]): Set<string> {
  const out = new Set<string>();
  for (const finding of traceFindings(findings)) {
    if (finding.check !== "trace_stale") continue;
    if (typeof finding.doc_id === "string" && finding.doc_id) out.add(finding.doc_id);
    for (const ref of Array.isArray(finding.refs) ? finding.refs : []) {
      if (typeof ref === "string" && ref) out.add(ref);
    }
  }
  return out;
}

/**
 * 監査が判定を出せる構成か。
 *
 * 上流の監査は作業フォルダの直下から統治木を探す（`--root-from`）。
 * 統治木が下位のディレクトリに在ると、別の木を監査するか、
 * 「統治木なし」を JSON でない形で吐いて終わる。どちらも黙って誤る。
 *
 * `--root <統治木>` に替えても直らない。上流は走査の根を統治木の親から決めるため、
 * 実装が別の場所に在ると全ての仕様が「実装が無い」と誤検出になる。
 *
 * よって、根直下に在る木のときだけ判定を取りに行く。それ以外は取りに行かず、
 * 取れないことを呼び手へ伝える。誤った判定を出すより、出さないほうがよい。
 */
export function canAudit(projectDir: string, docsRoot: string): boolean {
  // 突き合わせは forCompare を通す。素の `===` だと、経路の大小文字を区別しない
  // 環境（Windows・macOS）で `C:\Foo` と `c:\foo` が別物に見え、監査が黙って止まる。
  const parent = dirname(resolve(docsRoot));
  return forCompare(resolve(projectDir)) === forCompare(parent);
}

/**
 * 監査を走らせ、追跡に関わる所見だけを返す。
 *
 * `--fail-on never` で呼ぶ。所見が在ることは失敗ではない。
 * 判定を出せない構成では走らせず、その旨を返す（`canAudit` を見よ）。
 */
export async function fetchTraceFindings(
  projectDir: string,
  docsRoot: string,
  pluginRoot: string,
  options: RunOptions,
): Promise<Outcome<AuditFinding[]>> {
  if (!canAudit(projectDir, docsRoot)) {
    return fail<AuditFinding[]>(
      "absent",
      "the doctrine tree is not directly under the workspace folder",
    );
  }
  const outcome = await runJson<AuditReport>(
    [
      join(pluginRoot, "scripts", "docs-audit.py"),
      "--root-from", projectDir,
      "--json",
      "--fail-on", "never",
    ],
    options,
  );
  if (!outcome.ok) return outcome;
  if (!Array.isArray(outcome.value?.findings)) {
    return fail<AuditFinding[]>("bad-json", 'the value has no "findings"');
  }
  // 上流が実際に監査した木を突き合わせる。
  //
  // `canAudit` は「作業フォルダの直下に在るか」しか見ない。設定で別の木を指すと、
  // その条件は満たしたまま、上流は自分で見つけた木のほうを監査する。判定の出所が
  // 表示している木と食い違い、しかもそれは画面のどこにも出ない。
  const audited = outcome.value.root;
  if (typeof audited === "string" && forCompare(resolve(audited)) !== forCompare(resolve(docsRoot))) {
    return fail<AuditFinding[]>(
      "absent",
      `the audit resolved a different tree (${audited})`,
    );
  }
  return ok(traceFindings(outcome.value.findings));
}
// doctrine:end SPEC-004
