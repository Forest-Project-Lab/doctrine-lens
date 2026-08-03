// 文書が挙げる実測を、いま測り直して突き合わせる。
//
// **文書に書いた数は、書いた時点の木についての数である。** この木は統治文書を
// 足すたびに育つので、数だけを書くと翌日に嘘になる（ADR-021 決定 5）。
//
// 実際そうなった。`SPEC-006`・`ADR-014`・`CHANGE-005` の三つが揃って
// 「`DECIDED-001` を起点に置くと 17 行」と書いていたが、`DECIDED-001` は
// 辺を一本も持たず、実測は **0 行**である。正しい起点は `REQ-002` だった。
// **三つの文書が同じ誤りを持ち、誰も測り直さなかった。**
//
// ここは「`<id>` を起点に置くと `<N>` 行」という形の主張だけを拾い、
// 実際に組み立てて数を突き合わせる。合わなければ非ゼロで終わる。
//
//   node tools/check-measured-claims.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const pluginRoot = execFileSync("node", ["tools/doctrine-path.mjs"], {
  cwd: projectRoot,
  encoding: "utf8",
}).trim();

const { fetchSnapshot } = await import("../out/doctrine/graph.js");
const { buildConsequence } = await import("../out/model/consequence.js");
const { locateDocsRoot } = await import("../out/doctrine/locate.js");

/** `doctrine_docs` の中の `.md` を全部集める。 */
const docs = (dir) => {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...docs(path));
    else if (name.name.endsWith(".md")) out.push(path);
  }
  return out;
};

const claims = [];
for (const file of docs(join(projectRoot, "doctrine_docs"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/`([A-Z]+-\d+)` を起点に置くと (\d+) 行/g)) {
    claims.push({ file: file.slice(projectRoot.length + 1), id: m[1], rows: Number(m[2]) });
  }
}
if (claims.length === 0) {
  console.log("実測の主張が一つも無い（形が変わったなら、この道具を直すこと）。");
  process.exit(0);
}

const docsRoot = locateDocsRoot(projectRoot);
const outcome = await fetchSnapshot(projectRoot, docsRoot, pluginRoot, {
  pythonPath: "python3",
  timeoutMs: 120000,
  cwd: projectRoot,
});
if (!outcome.ok) {
  console.error(`統治木を取れない: ${outcome.detail ?? ""}`);
  process.exit(2);
}
const snapshot = outcome.value.snapshot;
const context = {
  findings: snapshot.findings,
  ranges: snapshot.ranges,
  reverseOrphans: snapshot.reverseOrphans ? new Set(snapshot.reverseOrphans) : null,
  registry: snapshot.registry,
};

const wrong = [];
for (const claim of claims) {
  const consequence = buildConsequence(snapshot.graph, claim.id, context);
  const rows = consequence.waves.flatMap((w) => w.rows).length;
  const mark = rows === claim.rows ? "ok  " : "違う";
  console.log(`${mark} ${claim.file}: ${claim.id} → 主張 ${claim.rows} 行 / 実測 ${rows} 行`);
  if (rows !== claim.rows) wrong.push(`${claim.file}: ${claim.id} は ${rows} 行（${claim.rows} と書いてある）`);
}

if (wrong.length > 0) {
  console.error(`\n文書の実測が、いまの木と合わない ${wrong.length} 件:`);
  for (const line of wrong) console.error(`  - ${line}`);
  console.error("\n数を直すか、刻印を添えて「いつの木か」を書くこと（ADR-021 決定 5）。");
  process.exit(1);
}
console.log(`\n実測の主張 ${claims.length} 件は、いまの木と合う。`);
