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
// src/webview・src/panel・src/session・src/extension は一行も見ない。
// 画面の側は `npm run preview` が、編集器の側は `npm run test:integration` が見る。
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
    to: 'const inside = join(candidate, "この名前のフォルダは無い");',
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
    label: "L2 の辺を鍵で引き直す（左列の箱が辺を失う）",
    file: "src/model/layout.ts",
    from: "const leftBy = new Map(left.map((p) => [p.key, p]));",
    to: "const leftBy = new Map<string, Placed>();",
  },
  {
    label: "配置が返す辺を捨てる（L0 とレーンの線が消える）",
    file: "src/model/layout.ts",
    from: "edges: edgesByKey(edges, placed),",
    to: "edges: [],",
  },
  {
    label: "保存レンズの焦点を捨てる（選び直すと深度だけ落ちる）",
    file: "src/shared/protocol.ts",
    from: "  return { name, lens, focus };",
    to: "  return { name, lens };",
  },
  {
    label: "空のドメインを弾く・L1（domain 無し文書の箱へ入れない）",
    file: "src/model/depth.ts",
    from: "if (lens.depth >= 1 && focus.domain !== null) {",
    to: "if (lens.depth >= 1 && focus.domain) {",
  },
  {
    label: "空のドメインを弾く・L2（消えた文書からの復帰が L0 まで落ちる）",
    file: "src/model/depth.ts",
    from: "if (focus.domain !== null && [...visible.values()].some((n) => n.domain === focus.domain)) {",
    to: "if (focus.domain && [...visible.values()].some((n) => n.domain === focus.domain)) {",
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
    from: "entries.find((e) => e.projectPath && resolve(e.projectPath) === here) ?? entries[0];",
    to: "entries[0];",
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
    label: "配置の自己ループ落としを外す（自分への線が引かれる）",
    file: "src/model/layout.ts",
    from: "    if (edge.src === edge.dst) continue;\n    const from = byKey.get(edge.src);",
    to: "    const from = byKey.get(edge.src);",
  },
  {
    label: "L2 の自己ループ落としを外す（同じ箱が三つ並ぶ）",
    file: "src/model/layout.ts",
    from: "    if (edge.src === edge.dst) continue;\n    if (edge.dst === focusKey && !incoming.includes(edge.src)) incoming.push(edge.src);",
    to: "    if (edge.dst === focusKey && !incoming.includes(edge.src)) incoming.push(edge.src);",
  },
  {
    label: "保存の合図の絞りを外す（無関係な保存で CLI が七本走る）",
    file: "src/model/trace.ts",
    from: "  if (!relPath) return false;",
    to: "  if (!relPath) return false;\n  if (1) return true;",
  },
  {
    label: "相対 pythonPath を受け入れる（ADR-010 の保証が破れる）",
    file: "src/doctrine/cli.ts",
    from: "  return isAbsolute(raw) ? raw : null;",
    to: "  return raw;",
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
const check = () => {
  if (!run("npx tsc -p tsconfig.test.json")) return "型検査が落ちた";
  return run("node --test 'out/test/*.test.js'") ? "試験は通った" : "試験が落ちた";
};

// 潰している最中に殺されても元へ戻す。
//
// try/finally はシグナルでは走らない。シグナルの受け口を置いても、この道具は
// ほぼ全区間 execFileSync の中に居るので、事象ループが空くまで受け口が動けない。
// 実測で、Ctrl-C の直後には潰れたソースと古い束の両方が残った。
// だから、潰す前に「戻し方」をディスクへ書く。次に走らせたとき最初にそれを見て、
// 残っていれば戻す。殺され方に依らない（SIGKILL でも効く）。
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

if (check() !== "試験は通った") {
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
  let verdict;
  try {
    verdict = check();
  } finally {
    restore();
  }
  const mark =
    verdict === "試験が落ちた" ? "落ちた  " : verdict === "型検査が落ちた" ? "型のみ!!" : "通った!!";
  console.log(`${mark} ${label}`);
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
