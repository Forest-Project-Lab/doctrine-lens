#!/usr/bin/env node
// 直しを一つずつ潰して、対応する試験が本当に落ちるかを実測する。
//
// なぜ要るか: 試験は「通ること」しか教えてくれない。守っているつもりの性質に
// 対応する試験が実は無くても、全件は緑のままである。実際にこのリポジトリでは、
// 三巡ぶんの直しのうち七つが、個別に潰しても全件が通る状態で放置されていた。
// 「数だけ合わせて中身が無い試験」を、字面でなく実測で止める。
//
//   使い方: node tools/mutate-check.mjs [対象の commit。既定は HEAD]
//
// **潰すのは利用者の作業木ではない**（ADR-015）。対象の commit から一時ディレクトリへ
// detached の worktree を立て、その中だけで潰す。走らせている間に作業木で build や編集を
// しても構わない。走行が途中で死んでも作業木は無傷で、次回起動が孤児の隔離木を片づける。
// 既定は commit を潰すので、未コミットの変更は検査対象に入らない。
//
// 遅い（一件あたり全件を回す）ので `npm run check` には入れない。直しを入れた
// ときと、公開の前に回す。表に一行足すのは、新しい直しを入れた人の仕事である。
//
// **覆える範囲は限られている。** 潰せるのは下の表に並べた行だけであり、
// 「すべての直し」ではない。回すのは tsconfig.test.json が含む層
// （src/doctrine・src/model・src/shared とその依存）に限られる。
//
// 残りを他の門が見ている、とは書かない。実際に見ていないためである。
// 画面は `npm run preview` が、起動と命令は `npm run test:integration` が見るが、
// src/statusbar.ts と src/codelens/decorations.ts の繋ぎ、および preview が
// 送らない lensPanel の受け口には、**どの門も効かない**。そこへ欠陥を入れて
// すべての門が緑のままだったことを実測してある。
// 判断の側（src/model/status.ts・src/model/trace.ts）は単体試験が見る。
// 見ていないのは、その判断を編集器の物へ写す数行だけである。
// この頭注を、README と CHANGELOG の文言と食い違わせないこと。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TEST_REPORTER, capture, selfCheck, verdictOf } from "./mutate-verdict.mjs";
import {
  acquireLock,
  createIsolated,
  pruneOrphans,
  removeIsolated,
  treeState,
} from "./mutate-worktree.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

/**
 * 潰す対象。`from` を `to` に替えて、全件が赤くなることを見る。
 *
 * 赤くならなければ、その直しは試験に守られていない。
 */
const MUTATIONS = [
  {
    label: "世代の判定を外す（捨てた地図が蘇る）",
    file: "src/doctrine/graph.ts",
    from: "if (generation === this.#generation) this.#snapshot = outcome.value.snapshot;",
    to: "this.#snapshot = outcome.value.snapshot;",
  },
  {
    label: "待ち合わせを while から if へ戻す（二重に走る）",
    file: "src/doctrine/graph.ts",
    from: "while (this.#inFlight && !this.#canJoin(this.#inFlight, key, requestedAt)) {",
    to: "if (this.#inFlight && !this.#canJoin(this.#inFlight, key, requestedAt)) {",
  },
  {
    label: "束ねの鍵から設定を落とす（古い設定の結果を受け取る）",
    file: "src/doctrine/graph.ts",
    from: "JSON.stringify([projectDir, docsRoot, pluginRoot, withAudit, options]);",
    to: "JSON.stringify([projectDir, docsRoot, pluginRoot, withAudit]);",
  },
  {
    label: "汚れの判定を外す（保存前の姿へ相乗りする）",
    file: "src/doctrine/graph.ts",
    from: "return !(this.#dirtyAt > inFlight.startedAt && this.#dirtyAt <= requestedAt);",
    to: "return true;",
  },
  {
    label: "監査した木の照合を外す（別の木の判定を出す）",
    file: "src/doctrine/audit.ts",
    from: 'if (typeof audited === "string" && forCompare(resolve(audited)) !== forCompare(resolve(docsRoot))) {',
    to: "if (false) {",
  },
  {
    label: "台帳の廃版検めを外す（退役した版を走らせる）",
    file: "src/doctrine/locate.ts",
    from: "if (existsSync(join(installPath, ORPHANED))) return null;",
    to: "// 潰した",
  },
  {
    label: "pluginPath の実体検めを外す（案内が的外れになる）",
    file: "src/doctrine/locate.ts",
    from: 'return existsSync(join(inside, "scripts", "docs-audit.py")) ? inside : null;',
    to: "return candidate;",
  },
  {
    label: "複製の根を指されたときの落としを外す（README 通りでも見つからない）",
    file: "src/doctrine/locate.ts",
    from: 'const inside = join(candidate, "plugin");',
    to: 'const inside = join(candidate, "no-such-directory");',
  },
  {
    label: "carryAudit の withAudit 条件を外す（速い拍を判定として採る）",
    file: "src/model/cadence.ts",
    from: "const audited = round.withAudit && !round.failed && round.staleIds !== null;",
    to: "const audited = !round.failed && round.staleIds !== null;",
  },
  {
    label: "carryAudit の failed 条件を外す（古い判定に新しい時刻が付く）",
    file: "src/model/cadence.ts",
    from: "const audited = round.withAudit && !round.failed && round.staleIds !== null;",
    to: "const audited = round.withAudit && round.staleIds !== null;",
  },
  {
    label: "知らないファイルを「無関係」と決めつける（新しい印が永久に拾われない）",
    file: "src/model/trace.ts",
    from: '  // まだ知らないファイル。印が新しく足されたかもしれないので、範囲だけ訊く。\n  return "probe";',
    to: '  return "ignore";',
  },
  {
    label: "印の集合の異同を見ない（訊いても足された印に気づかない）",
    file: "src/model/trace.ts",
    from: "  if (a.length !== b.length) return false;",
    to: "  return true;\n  if (a.length !== b.length) return false;",
  },
  {
    label: "一度も監査していない回の食い違いを空集合にする（食い違い無しと言う）",
    file: "src/model/cadence.ts",
    from: "  staleIds: null,",
    to: "  staleIds: new Set(),",
  },
  {
    label: "一度も監査していない回の検査名を空配列にする（0 検査を走らせたと言う）",
    file: "src/model/cadence.ts",
    from: "  checksRun: null,\n};",
    to: "  checksRun: [],\n};",
  },
  {
    label: "取れていない食い違いの件数を 0 と断定する",
    file: "src/model/status.ts",
    from: "    stale: input.staleCount === null ? null : input.staleCount > 0 ? input.staleCount : 0,",
    to: "    stale: (input.staleCount ?? 0) > 0 ? (input.staleCount ?? 0) : 0,",
  },
  {
    label: "登録簿の形を検めない（項を欠いた値が空集合に化ける）",
    file: "src/doctrine/registry.ts",
    from: '    if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {',
    to: "    if (false) {",
  },
  {
    label: "範囲が取れていない回に「起点が無い」と案内する",
    file: "src/model/view.ts",
    from: `    emptyReason: !context.openFile
      ? strings.noOriginNoFile
      : consequence.rangesKnown
        ? fill(strings.noOrigin, context.openFile)
        : fill(strings.noOriginRangesUnknown, context.openFile),`,
    to: `    emptyReason: context.openFile
      ? fill(strings.noOrigin, context.openFile)
      : strings.noOriginNoFile,`,
  },
  {
    label: "帯の食い違いの件数の条件を反転（永久に出ない）",
    file: "src/model/status.ts",
    from: "    stale: input.staleCount === null ? null : input.staleCount > 0 ? input.staleCount : 0,",
    to: "    stale: input.staleCount === null ? null : input.staleCount < 0 ? input.staleCount : 0,",
  },
  {
    label: "木が二つでも切り替えにしない（ADR-006 の到達手立てが消える）",
    file: "src/model/status.ts",
    from: '      input.candidateCount > 1 ? "doctrineLens.selectWorkspaceFolder" : "doctrineLens.open",',
    to: '      "doctrineLens.open",',
  },
  {
    label: "取れなかった登録簿を、空集合に潰す（全行が非現行に化ける）",
    file: "src/model/consequence.ts",
    from: `  const currentStatuses: ReadonlySet<string> | null = context.registry
    ? new Set(context.registry.currentStatuses)
    : null;`,
    to: "  const currentStatuses: ReadonlySet<string> | null = new Set(context.registry?.currentStatuses ?? []);",
  },
  {
    label: "判じられない回にも status を隠す（取れなかったが全部現行に化ける）",
    file: "src/model/view.ts",
    from: 'status: row.notCurrent === false ? "" : row.status,',
    to: 'status: row.notCurrent === true ? row.status : "",',
  },
  {
    label: "現行の行にも status を出し続ける（消し忘れ）",
    file: "src/model/view.ts",
    from: 'status: row.notCurrent === false ? "" : row.status,',
    to: "status: row.status,",
  },
  {
    label: "判じられない回に非現行を 0 と数える（測っていないものを良い知らせにする）",
    file: "src/model/consequence.ts",
    from: `        notCurrent:
          currentStatuses === null ? null : rows.filter((r) => r.notCurrent === true).length,`,
    to: "        notCurrent: rows.filter((r) => r.notCurrent === true).length,",
  },
  {
    label: "status を言っていない節点を「非現行」と数える（数と行が食い違う）",
    file: "src/model/consequence.ts",
    from: '  if (typeof status !== "string" || status === "") return null;',
    to: '  if (typeof status !== "string") return true;',
  },
  {
    label: "起点が循環に入った回に、起点を二重に引く（届かない件数が 1 減る）",
    file: "src/model/consequence.ts",
    from: "      all.size - rows.length - inCycle.size - (inCycle.has(origin.id) ? 0 : 1) - premises.size,",
    to: "      all.size - rows.length - inCycle.size - 1 - premises.size,",
  },
  {
    label: "現行の判定を反転（現行だけが語り出す）",
    file: "src/model/consequence.ts",
    from: "  return !currentStatuses.has(status);",
    to: "  return currentStatuses.has(status);",
  },
  {
    label: "部分失敗の詳細を捨てる・登録簿（設定の誤りが一時的失敗に見える）",
    file: "src/doctrine/graph.ts",
    from: 'partial.push({ what: "registry", reason: registryOutcome.reason, detail: registryOutcome.detail });',
    to: 'partial.push({ what: "registry", reason: registryOutcome.reason, detail: "" });',
  },
  {
    label: "部分失敗の詳細を捨てる・範囲",
    file: "src/doctrine/graph.ts",
    from: 'partial.push({ what: "ranges", reason: rangesOutcome.reason, detail: rangesOutcome.detail });',
    to: 'partial.push({ what: "ranges", reason: rangesOutcome.reason, detail: "" });',
  },
  {
    label: "部分失敗の詳細を捨てる・監査",
    file: "src/doctrine/graph.ts",
    from: 'partial.push({ what: "findings", reason: findingsOutcome.reason, detail: findingsOutcome.detail });',
    to: 'partial.push({ what: "findings", reason: findingsOutcome.reason, detail: "" });',
  },
  {
    label: "台帳のプロジェクト優先を外す（別のプロジェクト向けの版が走る）",
    file: "src/doctrine/locate.ts",
    from: "entries.find((e) => e.projectPath && forCompare(resolve(e.projectPath)) === here) ??",
    to: "entries.find(() => false) ??",
  },
  {
    label: "経路の区切りの正規化を外す（Windows でだけ範囲が外れる）",
    file: "src/model/trace.ts",
    from: 'const normalized = relPath.replace(/\\\\/g, "/");',
    to: "const normalized = relPath;",
  },
  {
    label: "帯の begin <= end の保証を外す（逆さの帯が出る）",
    file: "src/model/trace.ts",
    from: "return { id: range.id, begin, end: Math.max(begin, end), stale: staleIds.has(range.id) };",
    to: "return { id: range.id, begin, end, stale: staleIds.has(range.id) };",
  },
  {
    label: "保存の合図の絞りを外す（無関係な保存で CLI が七本走る）",
    file: "src/model/trace.ts",
    from: '  if (!relPath) return "ignore";',
    to: '  if (!relPath) return "ignore";\n  if (1) return "refresh";',
  },
  {
    label: "相対値の実行体を受け入れる（pythonPath・pluginPath の両方が破れる）",
    file: "src/doctrine/cli.ts",
    from: "  return isAbsolute(raw) ? raw : null;",
    to: "  return raw;",
  },
  {
    label: "pluginPath だけ規律を分ける（片方を塞いでも同じことができる）",
    file: "src/doctrine/locate.ts",
    from: "    const candidate = resolveUserPath(override);",
    to: '    const candidate = resolve(projectDir || ".", override.trim());',
  },
  {
    label: "待ち時間の丸めを外す（負で例外、32bit 超で全取得が数ミリ秒）",
    file: "src/doctrine/cli.ts",
    from: "  return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);",
    to: "  return value;",
  },
  {
    label: "子プロセスの作業フォルダを /tmp へ戻す（任意コード実行）",
    file: "src/doctrine/cli.ts",
    from: '    privateCwd = mkdtempSync(join(tmpdir(), "doctrine-lens-run-"));',
    to: "    privateCwd = tmpdir();",
  },
  {
    label: "波の距離を最長から最短へ戻す（直せない順を正しい順として出す）",
    file: "src/model/consequence.ts",
    from: "if (known === undefined || candidate > known) {",
    to: "if (known === undefined) {",
  },
  {
    label: "直かどうかを距離で判じる（循環の相手から来た行が「起点の直の前提」を名乗る）",
    file: "src/model/consequence.ts",
    from: "hit.from === origin.id",
    to: "at === 1",
  },
  {
    label: "相互のペアで影響を上書きする（同じ事実の行が ~ に化ける）",
    file: "src/model/consequence.ts",
    from: 'if (!(bucket.get(to) === "depends-directly")) bucket.set(to, kind);',
    to: "bucket.set(to, kind);",
  },
  {
    label: "影響の理由に起点を名指す（三段先で嘘になる）",
    file: "src/model/consequence.ts",
    from: '? { kind: "impacted", by: hit.from }',
    to: '? { kind: "impacted", by: origin.id }',
  },
  {
    label: "逆孤児が取れていない回に + を当てる",
    file: "src/model/consequence.ts",
    from: '  if (input.isReverseOrphan === true) return "missing";',
    to: '  if (input.isReverseOrphan !== false) return "missing";',
  },
  {
    label: "範囲が取れていない回に「コード 0 か所」と断定する",
    file: "src/model/consequence.ts",
    from: "      codeRanges: rangesKnown ? rows.reduce((n, r) => n + r.ranges.length, 0) : null,",
    to: "      codeRanges: rows.reduce((n, r) => n + r.ranges.length, 0),",
  },
  {
    label: "範囲が取れていない回に「範囲が無い N」と断定する",
    file: "src/model/consequence.ts",
    from: "        noRange: rangesKnown ? rows.filter((r) => r.ranges.length === 0).length : null,",
    to: "        noRange: rows.filter((r) => r.ranges.length === 0).length,",
  },
  {
    label: "所見が取れていない回に「壊れている 0」と断定する",
    file: "src/model/consequence.ts",
    from: `        broken:
          context.findings === null ? null : rows.filter((r) => hasHeavyFinding(r.findings)).length,`,
    to: "        broken: rows.filter((r) => hasHeavyFinding(r.findings)).length,",
  },
  {
    label: "逆孤児が取れていない回に「足りない 0」と断定する",
    file: "src/model/consequence.ts",
    from: `        missing:
          context.reverseOrphans === null
            ? null
            : rows.filter((r) => (context.reverseOrphans as ReadonlySet<string>).has(r.id)).length,`,
    to: "        missing: rows.filter((r) => context.reverseOrphans?.has(r.id) === true).length,",
  },
  {
    label: "上流の逆孤児の未取得を空配列へ潰す（+ が永久に出ない）",
    file: "src/doctrine/graph.ts",
    from: "      reverseOrphans: orphanOutcome.ok ? orphanOutcome.value : null,",
    to: "      reverseOrphans: orphanOutcome.ok ? orphanOutcome.value : [],",
  },
  {
    label: "上流の検査名の未取得を空配列へ潰す（0 検査を走らせたと言う）",
    file: "src/doctrine/graph.ts",
    from: "      checksRun: findingsOutcome?.ok ? findingsOutcome.value.checksRun : null,",
    to: "      checksRun: findingsOutcome?.ok ? findingsOutcome.value.checksRun : [],",
  },
  {
    label: "取れていない事実を記号と比べる（誤った理由の脚注が出る）",
    file: "src/model/view.ts",
    from: "    (s.facts.broken !== null && s.facts.broken !== s.bySymbol.broken) ||",
    to: "    s.facts.broken !== s.bySymbol.broken ||",
  },
  {
    label: "記号の排他を崩す（+ より ? を先に当てる）",
    file: "src/model/consequence.ts",
    from: '  if (input.isReverseOrphan === true) return "missing";\n  // 取れていない（null）ときは「無い」と言わない。知らないことを断定しない。\n  if (input.rangeCount === 0) return "nowhere";',
    to: '  if (input.rangeCount === 0) return "nowhere";\n  if (input.isReverseOrphan === true) return "missing";',
  },
  {
    label: "重さの語彙を上流から奪う（info まで壊れていることにする）",
    file: "src/model/consequence.ts",
    from: 'return findings.some((f) => f.severity === "error" || f.severity === "warn");',
    to: "return findings.length > 0;",
  },
  {
    label: "循環の塊を波に混ぜる（順の決まらないものに順を付ける）",
    file: "src/model/consequence.ts",
    from: "    if (inCycle.has(id)) continue;",
    to: "    if (false) continue;",
  },
  {
    label: "直の前提の行き先を出さない（数だけを出して手が無い）",
    file: "src/model/consequence.ts",
    from: `    premisesDirect: [...(reversed(neighbours).get(origin.id)?.keys() ?? [])]
      .filter((id) => id !== origin.id && all.has(id) && !inCycle.has(id))
      .sort(),`,
    to: "    premisesDirect: [],",
  },
  {
    label: "直の前提に推移の全部を並べる（280px で読めない）",
    file: "src/model/consequence.ts",
    from: "    premisesDirect: [...(reversed(neighbours).get(origin.id)?.keys() ?? [])]",
    to: "    premisesDirect: [...premises]\n      .concat([...(reversed(neighbours).get(origin.id)?.keys() ?? [])])",
  },
  {
    label: "畳んだ件数を数え損なう（隠したことを黙る）",
    file: "src/model/consequence.ts",
    from: `    unreached: Math.max(
      0,
      all.size - rows.length - inCycle.size - (inCycle.has(origin.id) ? 0 : 1) - premises.size,
    ),`,
    to: "    unreached: 0,",
  },
  {
    label: "所見を追跡の検査だけに絞る（上流の判断を橋の上で捨てる）",
    file: "src/doctrine/audit.ts",
    from: "  return ok({ findings: outcome.value.findings, checksRun });",
    to: '  return ok({ findings: outcome.value.findings.filter((f) => f.check.startsWith("trace")), checksRun });',
  },
  {
    label: "走らせた検査の一覧を捨てる（脚注が数を持てなくなる）",
    file: "src/doctrine/audit.ts",
    from: "  return ok({ findings: outcome.value.findings, checksRun });",
    to: "  return ok({ findings: outcome.value.findings, checksRun: [] });",
  },
  {
    label: "所見を doc_id だけで引く（refs で結ばれた文書が × を失う）",
    file: "src/model/consequence.ts",
    from: "return findings.filter((f) => f.doc_id === id || (f.refs ?? []).includes(id));",
    to: "return findings.filter((f) => f.doc_id === id);",
  },
  {
    label: "題名を主文から落とす（画面が id だけになる — 利用者が最初に言った不満）",
    file: "src/model/view.ts",
    from: "return meta.get(id)?.title?.trim() || id;",
    to: "return id;",
  },
  {
    label: "循環の塊ではなく一巡から件数を数える（成分の要素が黙って消える）",
    file: "src/model/consequence.ts",
    from: "const inCycle = new Set(tangles.flat().filter((id) => all.has(id)));",
    to: "const inCycle = new Set(cycles.flatMap((c) => c.path));",
  },
  {
    label: "起点自身の所見を捨てる（起点が壊れていても 0 と言う）",
    file: "src/model/consequence.ts",
    from: "const originFindings = findingsFor(origin.id, context.findings);",
    to: "const originFindings: AuditFinding[] = [];",
  },
  {
    label: "「外」を「起点以外」へ戻す（画面に出ている所見を外と数える）",
    file: "src/model/consequence.ts",
    from: "const hidden = (context.findings ?? []).filter((f) => !shown.has(f));",
    to: "const hidden = (context.findings ?? []).filter((f) => f.doc_id !== origin.id);",
  },
  {
    label: "前提を「繋がらない」へ混ぜる（辿る向きの違いを影響なしと読ませる）",
    file: "src/model/consequence.ts",
    from: "    premiseCount: premises.size,",
    to: "    premiseCount: 0,",
  },
  {
    label: "範囲を取れなかったことを「無い」と断定する（全部 ? に化ける）",
    file: "src/model/consequence.ts",
    from: "        rangeCount: rangesKnown ? ranges.length : null,",
    to: "        rangeCount: ranges.length,",
  },
  {
    label: "直の辺が在ることを捨てる（迂回路だけを名乗る）",
    file: "src/model/consequence.ts",
    from: "      alsoDirect: directNeighbours.has(id),",
    to: "      alsoDirect: false,",
  },
  {
    label: "所見を message だけに潰す（severity と path を捨てる）",
    file: "src/model/view.ts",
    from: "    findings: row.findings.map(toFindingView),",
    to: '    findings: row.findings.map((f) => ({ check: "", severity: "", doc_id: "", message: f.message, path: "", refs: [] })),',
  },
  {
    label: "判定の引き継ぎから所見を落とす（保存のたびに壊れている 0 へ落ちる）",
    file: "src/model/cadence.ts",
    from: "    findings: round.findings,",
    to: "    findings: previous.findings,",
  },
  {
    label: "承認語の判定を自前でやる（カルクの表まで語として拾う）",
    file: "src/doctrine/glossary.ts",
    from: "    if (!meaning || !approved.has(word)) continue;",
    to: "    if (!meaning) continue;",
  },
  {
    label: "辞書の場所を canonical_for ではなく決め打ちにする",
    file: "src/doctrine/glossary.ts",
    from: 'if (claims.some((c) => c === "glossary")) return node.path;',
    to: 'if (node.path.endsWith("glossary.md")) return node.path;',
  },
  {
    label: "長い語を先に見るのをやめる（逆孤児の中の孤児を二重に拾う）",
    file: "src/doctrine/glossary.ts",
    from: "const words = [...glossary.keys()].sort((a, b) => b.length - a.length);",
    to: "const words = [...glossary.keys()];",
  },
  {
    label: "出ていない所見の行き先を捨てる（件数だけ出して手が無い）",
    file: "src/model/consequence.ts",
    from: '    findingsElsewhereAt: [...new Set(hidden.flatMap((f) => attachedTo(f)))]\n      .filter((id) => id !== origin.id && !premises.has(id))\n      .sort(),',
    to: "    findingsElsewhereAt: [],",
  },
  {
    label: "前提を「起点に繋がらない」へ混ぜる（同じ文書を前提とも無関係とも言う）",
    file: "src/model/consequence.ts",
    from: "      .filter((id) => id !== origin.id && !premises.has(id))",
    to: "      .filter((id) => id !== origin.id)",
  },
  {
    label: "属さない所見を「行き先が在る」側へ混ぜる（探しても見つからない）",
    file: "src/model/consequence.ts",
    from: "    findingsUnattached: hidden.filter((f) => !attachedTo(f).length).length,",
    to: "    findingsUnattached: 0,",
  },
  {
    label: "refs で紐づく所見を見落とす（行き先が在るのに無いと言う）",
    file: "src/model/consequence.ts",
    from: "  for (const ref of Array.isArray(finding.refs) ? finding.refs : []) {\n    if (typeof ref === \"string\" && ref) out.add(ref);\n  }",
    to: "",
  },
];

// 潰す先。**利用者の作業木ではない**（ADR-015）。走り出しに隔離木を作って差し替える。
// 既定のままだと作業木を指すので、隔離木を作る前に潰しへ入らないこと。
let workRoot = null;

const run = (command) => {
  try {
    execFileSync("sh", ["-c", command], { cwd: workRoot, encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

/**
 * 型検査と試験を**別々に**回す。
 *
 * 一つの `&&` でつなぐと、型検査だけが咎めた潰しも「落ちた」＝守られている、と
 * 読まれる。試験は一行も走っていないのにである。合否は試験の終了符号だけで決め、
 * 型検査が落ちる潰しは「潰し方が不正（表を直せ）」として別に扱う。
 */
// 表の照合そのものは、この判定から外す。
//
// src/test/mutation-table.test.ts は「表の from が実在する」ことを検める。
// 道具はまさにその from を消して潰すので、同じ束で回すと、どの行を潰しても
// 必ずその一件が赤くなる。実測で 27 行のうち 25 行はそれだけが赤かった。
// つまり判定が自分の仕込んだ赤を見ていただけで、直しが守られているかを
// 一切見ていなかった。除いて回す（npm test と CI は全件を回す）。
const TEST_GLOB =
  "$(ls out/test/*.test.js | grep -v mutation-table)";

// doctrine:begin SPEC-007
// 判定器は tools/mutate-verdict.mjs に置く（検査器自身を試験できる場所へ出すため）。
// 合否は試験processの終了符号とシグナルで決め、`not ok` の照合は人へ見せる補助に留める。
const TEST_COMMAND = `node --test-reporter=${TEST_REPORTER} --test ${TEST_GLOB}`;

/**
 * 型検査と試験を**別々に**回し、赤くなった試験の名前も返す。
 *
 * 一つの `&&` でつなぐと、型検査だけが咎めた潰しも「落ちた」＝守られている、と
 * 読まれる。試験は一行も走っていないのにである。合否は試験の終了符号だけで決め、
 * 型検査が落ちる潰しは「潰し方が不正（表を直せ）」として別に扱う。
 */
const check = () => {
  if (!run(`npx tsc -p tsconfig.test.json`)) return { verdict: "型検査が落ちた", failed: [] };
  return verdictOf(capture(TEST_COMMAND, workRoot));
};

/** 判定が何の上に載っていたかを刻む。後から誰でも読めるようにする。 */
const provenance = () => {
  // 隔離木は detached なので、その HEAD がそのまま「潰した対象」である。
  const head = workRoot ? capture("git rev-parse HEAD", workRoot) : { status: 1 };
  const commit = head.status === 0 ? head.stdout.trim() : "（取れなかった）";
  return [
    `Node: ${process.version}`,
    `reporter: ${TEST_REPORTER}（明示。既定に委ねない）`,
    `試験: ${TEST_COMMAND}`,
    `対象: ${commit}`,
    `潰した木: ${workRoot ?? "（未作成）"}（隔離。作業木ではない）`,
  ].join("\n");
};

/** 判定不能。数字を出す資格が無いので、元へ戻して止める。 */
const abortOnCheckerFault = (label, result) => {
  restore();
  console.error(`\n検査器の異常のため止めた（${label}）。`);
  console.error(`  ${result.why ?? "理由不明"}`);
  console.error(`  拾えた not ok の行: ${result.failed.length} 件`);
  console.error(`\n${provenance()}`);
  console.error("\nこの走行の判定は読めない。score を出さない。");
  process.exit(2);
};
// doctrine:end SPEC-007

// doctrine:begin SPEC-008
// 潰す先を、利用者の作業木から捨てられる隔離木へ移した（ADR-015）。
//
// 以前はここで作業木のソースを直接書き換え、戻し方を .mutate-restore.json に置いていた。
// 実測で次が起きていた —— Ctrl-C の直後に潰れたソースと古い束が残る。親の殻を止めても
// この処理は生き続け、止めた側が記録から戻した裏で新しい潰しが当たり、**木が二箇所
// 潰れたまま「全件が緑」に見える状態が残る。**同時に build を叩くと互いの束を壊し合う。
//
// 戻し方の記録は事故のあとの回復手段でしかなく、破壊的な書き込み自体は防がない。
// だから書き込む先を変えた。作業木へは一バイトも書かない。隔離木は使い捨てなので、
// 走行が途中で死んでも作業木は無傷であり、次回起動が孤児の木だけを片づける。
const targetRef = process.argv[2] ?? "HEAD";

const before = treeState(projectRoot);
const orphans = pruneOrphans(projectRoot);
for (const path of orphans) console.log(`前の走行が残した隔離木を片づけた: ${path}`);

let lock;
try {
  lock = acquireLock(projectRoot);
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}

let commit;
try {
  commit = execFileSync("git", ["rev-parse", targetRef], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
} catch {
  lock.release();
  console.error(`潰す対象を解決できない（${targetRef}）。`);
  process.exit(2);
}

try {
  workRoot = createIsolated(projectRoot, commit);
} catch (error) {
  lock.release();
  console.error("隔離木を作れない。", error);
  process.exit(2);
}
console.log(`隔離木: ${workRoot}（${commit.slice(0, 8)} を detached で展開。作業木は触らない）`);

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  if (workRoot) removeIsolated(projectRoot, workRoot);
  lock.release();
};
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

/** 隔離木の中で一行を戻す。木ごと捨てるが、次の一行の baseline を保つために戻す。 */
let restoring = null;
const restore = () => {
  if (!restoring) return;
  writeFileSync(restoring.path, restoring.original, "utf8");
  restoring = null;
};
// doctrine:end SPEC-008

// 判定器を先に検める。ここが壊れていれば、以降の数字は全部読めない。
const faults = selfCheck();
if (faults.length > 0) {
  console.error("判定器が自分を検められない。score を出さない。");
  for (const fault of faults) console.error(`  - ${fault}`);
  console.error(`\n${provenance()}`);
  process.exit(2);
}

const baseline = check();
if (baseline.verdict === "検査器の異常") abortOnCheckerFault("baseline", baseline);
if (baseline.verdict !== "試験は通った") {
  console.error(`先に全件を緑にすること（${commit.slice(0, 8)} で型検査か試験が落ちている）。`);
  process.exit(2);
}
console.log(`baseline: 緑（潰す対象 ${MUTATIONS.length} 件）`);

// **何を検めているのかを、先頭で言う。** この道具は commit を潰すので、作業木に
// 未コミットの変更が在れば、緑は**手元の版についての緑ではない。**
// 実際そうなった——新しい行を足して未コミットのまま回し、五行が「対象不明」に
// なるまで、古い版を検めていることに気づかなかった（ADR-017）。
// 走り終えたあとの由来書きにも出るが、それでは 20 分遅い。
{
  const dirty = capture("git status --porcelain", projectRoot);
  const lines = dirty.status === 0 ? dirty.stdout.split("\n").filter(Boolean) : [];
  if (lines.length > 0) {
    console.log(
      `\n注意: 作業木に未コミットの変更が ${lines.length} 件ある。` +
        `検めているのは ${commit.slice(0, 8)} であって、手元の版ではない。\n` +
        "  手元の版を検めるには、先にコミットすること。",
    );
  }
}
console.log("");

const unguarded = [];
const invalid = [];
for (const { label, file, from, to } of MUTATIONS) {
  const path = join(workRoot, file);
  // 隔離木は commit と追跡下の差分から作る。**未追跡の新しいファイルは入らない。**
  // 素の readFileSync だと ENOENT で走行ごと落ち、それまでの判定も読めなくなる。
  // 表の行として不正と報せ、残りを走らせきる。
  let original;
  try {
    original = readFileSync(path, "utf8");
  } catch {
    console.log(`?? ${label} — ${file} が隔離木に無い。未追跡なら先に git add すること。`);
    invalid.push(`${label}（隔離木に無い: ${file}）`);
    continue;
  }
  if (!original.includes(from)) {
    console.log(`?? ${label} — 対象の行が見つからない（${file}）。表が古い。`);
    invalid.push(`${label}（対象不明）`);
    continue;
  }
  restoring = { path, original };
  writeFileSync(path, original.replace(from, to), "utf8");
  let result;
  try {
    result = check();
  } finally {
    restore();
  }
  const { verdict, failed } = result;
  // 判定不能を「通った」＝守られていない側へ寄せない。足場の故障を、守られていない
  // 直しの一覧に混ぜると、直す先を誤らせる。故障は故障として立てて止める。
  if (verdict === "検査器の異常") abortOnCheckerFault(label, result);
  const mark =
    verdict === "試験が落ちた" ? "落ちた  " : verdict === "型検査が落ちた" ? "型のみ!!" : "通った!!";
  // 赤くなった試験の名前も刷る。取り違え（別の理由で落ちているだけ）が目で分かる。
  const why = failed.length > 0 ? `  ← ${failed.slice(0, 2).join(" / ")}` : "";
  console.log(`${mark} ${label}${why}`);
  if (verdict === "型検査が落ちた") invalid.push(`${label}（型検査だけが咎めた）`);
  else if (verdict === "試験は通った") unguarded.push(label);
}

// 報告は隔離木を消す前に組む（消したあとでは HEAD を引けない）。
const report = provenance();

if (unguarded.length > 0) {
  console.error(`\n試験に守られていない直しが ${unguarded.length} 件:`);
  for (const line of unguarded) console.error(`  - ${line}`);
}
if (invalid.length > 0) {
  console.error(`\n潰し方が不正な行が ${invalid.length} 件（表を直すこと）:`);
  for (const line of invalid) console.error(`  - ${line}`);
}
console.log(`\n${report}`);

// 作業木が一バイトも動いていないことを確かめる。動いていたら掃除はしない（利用者の
// dirty state を勝手に戻さない。ADR-015）。報せるだけにする。
cleanup();
if (treeState(projectRoot) !== before) {
  console.error(
    "\n作業木の状態が走行の前後で変わっている。この道具は作業木へ書かないので、" +
      "別の何かが触った疑いがある。手で確かめること（この道具は掃除しない）。",
  );
  process.exit(2);
}

if (unguarded.length > 0 || invalid.length > 0) process.exit(1);
console.log(`\n表に載せた ${MUTATIONS.length} 件は、いずれも試験が捕まえる。`);
console.log("（表に無い直しについては何も言っていない。頭注を読むこと。）")
