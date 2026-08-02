#!/usr/bin/env node
// 直しを一つずつ潰して、対応する試験が本当に落ちるかを実測する。
//
// なぜ要るか: 試験は「通ること」しか教えてくれない。守っているつもりの性質に
// 対応する試験が実は無くても、全件は緑のままである。実際にこのリポジトリでは、
// 三巡ぶんの直しのうち七つが、個別に潰しても全件が通る状態で放置されていた。
// 「数だけ合わせて中身が無い試験」を、字面でなく実測で止める。
//
//   使い方: node tools/mutate-check.mjs
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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
    label: "帯の食い違いの件数の条件を反転（永久に出ない）",
    file: "src/model/status.ts",
    from: "    stale: input.staleCount > 0 ? input.staleCount : 0,",
    to: "    stale: input.staleCount < 0 ? input.staleCount : 0,",
  },
  {
    label: "木が二つでも切り替えにしない（ADR-006 の到達手立てが消える）",
    file: "src/model/status.ts",
    from: '      input.candidateCount > 1 ? "doctrineLens.selectWorkspaceFolder" : "doctrineLens.open",',
    to: '      "doctrineLens.open",',
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
    label: "記号の排他を崩す（+ より ? を先に当てる）",
    file: "src/model/consequence.ts",
    from: '  if (input.isReverseOrphan) return "missing";\n  // 取れていない（null）ときは「無い」と言わない。知らないことを断定しない。\n  if (input.rangeCount === 0) return "nowhere";',
    to: '  if (input.rangeCount === 0) return "nowhere";\n  if (input.isReverseOrphan) return "missing";',
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
    label: "畳んだ件数を数え損なう（隠したことを黙る）",
    file: "src/model/consequence.ts",
    from: "unreached: Math.max(0, all.size - rows.length - inCycle.size - 1 - premises.size),",
    to: "unreached: 0,",
  },
  {
    label: "題名の三つ組を二つで受ける（全件が黙って題名を失う）",
    file: "src/doctrine/titles.ts",
    from: '"            meta, _body, _errors = fm.parse_file(path)",',
    to: '"            meta, _body = fm.parse_file(path)",',
  },
  {
    label: "題名の根の検めを外す（相対パスで空の表が成功として返る）",
    file: "src/doctrine/titles.ts",
    from: '"if not os.path.isdir(root):",',
    to: '"if False:",',
  },
  {
    label: "解析が全件落ちても成功として返す（0/N を題名の無い木と呼ぶ）",
    file: "src/doctrine/titles.ts",
    from: '"if seen > 0 and len(broken) == seen:",',
    to: '"if False:",',
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
    from: "findingsElsewhere: context.findings.filter((f) => !shown.has(f)).length,",
    to: "findingsElsewhere: context.findings.filter((f) => f.doc_id !== origin.id).length,",
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
    to: '    findings: row.findings.map((f) => ({ check: "", severity: "", message: f.message, path: "", refs: [] })),',
  },
  {
    label: "判定の引き継ぎから所見を落とす（保存のたびに壊れている 0 へ落ちる）",
    file: "src/model/cadence.ts",
    from: "    findings: round.findings,",
    to: "    findings: previous.findings,",
  },
];

const run = (command) => {
  try {
    execFileSync("sh", ["-c", command], { cwd: projectRoot, encoding: "utf8", stdio: "pipe" });
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

/**
 * 型検査と試験を**別々に**回し、赤くなった試験の名前も返す。
 *
 * 一つの `&&` でつなぐと、型検査だけが咎めた潰しも「落ちた」＝守られている、と
 * 読まれる。試験は一行も走っていないのにである。合否は試験の終了符号だけで決め、
 * 型検査が落ちる潰しは「潰し方が不正（表を直せ）」として別に扱う。
 */
const check = () => {
  if (!run(`npx tsc -p tsconfig.test.json`)) return { verdict: "型検査が落ちた", failed: [] };
  const out = capture(`node --test ${TEST_GLOB}`);
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  return { verdict: failed.length > 0 ? "試験が落ちた" : "試験は通った", failed };
};

/** 走らせて、終了符号に関わらず出力を返す。 */
const capture = (command) => {
  try {
    return execFileSync("sh", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
};

// 潰している最中に殺されても元へ戻す。
//
// try/finally はシグナルでは走らない。シグナルの受け口を置いても、この道具は
// ほぼ全区間 execFileSync の中に居るので、事象ループが空くまで受け口が動けない。
// 実測で、Ctrl-C の直後には潰れたソースと古い束の両方が残った。
// だから、潰す前に「戻し方」をディスクへ書く。次に走らせたとき最初にそれを見て、
// 残っていれば戻す。殺され方に依らない（SIGKILL でも効く）。
//
// **親の殻を止めても、この道具は止まらない。** 実測: 走らせた殻を止めたあと、
// この node の処理は生き続け、次の行を潰し、記録を書き直していた。止めた側は
// 「止めた」と思って記録から戻し、その裏で新しい潰しが当たっていた。
// 木が二箇所潰れたまま「全件が緑」に見える状態が残る。
// 止めるときは、この処理の pid を確かめて落とすこと。落としたあと、
// **記録が残っていれば必ず戻すこと**（残っていれば潰れたままである）。
//
// 走らせている間、木を触らないこと。同時に `npm run build:test` を叩くと、
// 互いの束を作り直して両方の判定が汚れる。これも実測している。
const JOURNAL = join(projectRoot, ".mutate-restore.json");

const recoverFromJournal = () => {
  if (!existsSync(JOURNAL)) return;
  try {
    const { file, original } = JSON.parse(readFileSync(JOURNAL, "utf8"));
    writeFileSync(join(projectRoot, file), original, "utf8");
    console.log(`前回の走行が途中で止まっていた。${file} を元へ戻した。`);
  } catch (error) {
    console.error(`戻し方の記録を読めない（${JOURNAL}）。手で確かめること。`, error);
    process.exit(2);
  }
  rmSync(JOURNAL, { force: true });
};

let restoring = null;
const restore = () => {
  if (!restoring) return;
  writeFileSync(restoring.path, restoring.original, "utf8");
  restoring = null;
  rmSync(JOURNAL, { force: true });
};
process.on("exit", restore);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

recoverFromJournal();

if (check().verdict !== "試験は通った") {
  console.error("先に全件を緑にすること（いまの木で型検査か試験が落ちている）。");
  process.exit(2);
}
console.log(`baseline: 緑（潰す対象 ${MUTATIONS.length} 件）\n`);

const unguarded = [];
const invalid = [];
for (const { label, file, from, to } of MUTATIONS) {
  const path = join(projectRoot, file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(from)) {
    console.log(`?? ${label} — 対象の行が見つからない（${file}）。表が古い。`);
    invalid.push(`${label}（対象不明）`);
    continue;
  }
  // 先に戻し方を書いてから潰す。順を逆にすると、その隙間で殺されたときに
  // 戻し方が無いまま潰れたソースだけが残る。
  writeFileSync(JOURNAL, JSON.stringify({ file, original }), "utf8");
  restoring = { path, original };
  writeFileSync(path, original.replace(from, to), "utf8");
  let result;
  try {
    result = check();
  } finally {
    restore();
  }
  const { verdict, failed } = result;
  const mark =
    verdict === "試験が落ちた" ? "落ちた  " : verdict === "型検査が落ちた" ? "型のみ!!" : "通った!!";
  // 赤くなった試験の名前も刷る。取り違え（別の理由で落ちているだけ）が目で分かる。
  const why = failed.length > 0 ? `  ← ${failed.slice(0, 2).join(" / ")}` : "";
  console.log(`${mark} ${label}${why}`);
  if (verdict === "型検査が落ちた") invalid.push(`${label}（型検査だけが咎めた）`);
  else if (verdict === "試験は通った") unguarded.push(label);
}

// 束ねを元に戻しておく。
run("npx tsc -p tsconfig.test.json");

if (unguarded.length > 0) {
  console.error(`\n試験に守られていない直しが ${unguarded.length} 件:`);
  for (const line of unguarded) console.error(`  - ${line}`);
}
if (invalid.length > 0) {
  console.error(`\n潰し方が不正な行が ${invalid.length} 件（表を直すこと）:`);
  for (const line of invalid) console.error(`  - ${line}`);
}
if (unguarded.length > 0 || invalid.length > 0) process.exit(1);
console.log(`\n表に載せた ${MUTATIONS.length} 件は、いずれも試験が捕まえる。`);
console.log("（表に無い直しについては何も言っていない。頭注を読むこと。）");
