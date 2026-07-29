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
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
    label: "相対 pythonPath の解決を外す（.venv/bin/python が ENOENT）",
    file: "src/doctrine/cli.ts",
    from: "resolvePython(options.pythonPath, options.cwd),",
    to: "options.pythonPath,",
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
    label: "空のドメインを弾く（domain 無し文書の箱へ入れない）",
    file: "src/model/depth.ts",
    from: "if (lens.depth >= 1 && focus.domain !== null) {",
    to: "if (lens.depth >= 1 && focus.domain) {",
  },
];

const runTests = () => {
  try {
    execFileSync("sh", ["-c", "npx tsc -p tsconfig.test.json && node --test 'out/test/*.test.js'"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
};

if (!runTests()) {
  console.error("先に全件を緑にすること（いまの木で試験が落ちている）。");
  process.exit(2);
}
console.log("baseline: 緑\n");

const unguarded = [];
for (const { label, file, from, to } of MUTATIONS) {
  const path = join(projectRoot, file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(from)) {
    console.log(`?? ${label} — 対象の行が見つからない（${file}）。表が古い。`);
    unguarded.push(`${label}（対象不明）`);
    continue;
  }
  writeFileSync(path, original.replace(from, to), "utf8");
  let caught;
  try {
    caught = !runTests();
  } finally {
    writeFileSync(path, original, "utf8");
  }
  console.log(`${caught ? "落ちた  " : "通った!!"} ${label}`);
  if (!caught) unguarded.push(label);
}

// 束ねを元に戻しておく。
execFileSync("npx", ["tsc", "-p", "tsconfig.test.json"], { cwd: projectRoot, stdio: "pipe" });

if (unguarded.length > 0) {
  console.error(`\n試験に守られていない直しが ${unguarded.length} 件:`);
  for (const line of unguarded) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("\nすべての直しが試験に守られている。");
