// この木そのものを測り、文書に書く実測を刷る。
//
// **測った数は、測った時点の木についての数である。** この木は統治文書を足すたびに
// 育つので、`CHANGE-010` の一周の中だけでも節点は 67 → 70 と動いた。
// 数だけを書くと、書いた翌日に嘘になる。
//
// だから文書には**刻印を添えて**書く（「2026-08-02 の木・70 文書で測ると」）。
// 刻印が在れば、読み手は「いつの話か」を知り、古びたことも自分で分かる。
//
// この道具は、その数を出す。手で数えない。
//
//   node tools/measure-tree.mjs
//
// `npm run check` には入れない（統治木を三度歩くので遅い）。文書を書くときに回す。
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const pluginRoot = execFileSync("node", ["tools/doctrine-path.mjs"], {
  cwd: projectRoot,
  encoding: "utf8",
}).trim();

const { fetchSnapshot } = await import("../out/doctrine/graph.js");
const { buildConsequence } = await import("../out/model/consequence.js");
const { locateDocsRoot } = await import("../out/doctrine/locate.js");

const docsRoot = locateDocsRoot(projectRoot);
const outcome = await fetchSnapshot(projectRoot, docsRoot, pluginRoot, {
  pythonPath: "python3",
  timeoutMs: 120000,
  cwd: projectRoot,
});
if (!outcome.ok) {
  console.error(`統治木を取れない: ${outcome.detail ?? ""}`);
  process.exit(1);
}
const snapshot = outcome.value.snapshot;
const nodes = snapshot.graph.nodes;
const context = {
  findings: snapshot.findings ?? [],
  ranges: snapshot.ranges,
  reverseOrphans: new Set(snapshot.reverseOrphans),
  registry: snapshot.registry,
};

const domainOf = new Map(nodes.map((n) => [n.id, n.domain]));
let rows = 0;
let notCurrent = 0;
let crossing = 0;
for (const node of nodes) {
  const consequence = buildConsequence(snapshot.graph, node.id, context);
  for (const row of consequence.waves.flatMap((w) => w.rows)) {
    rows += 1;
    if (row.notCurrent) notCurrent += 1;
    if (domainOf.get(row.id) !== domainOf.get(node.id)) crossing += 1;
  }
}

const pct = (n) => ((100 * n) / rows).toFixed(1);
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
}).trim();

console.log(`刻印: ${head} の木・節点 ${nodes.length}`);
console.log("");
console.log(`全 ${nodes.length} 起点で出る行の総数        ${rows}`);
console.log(`  うち非現行                       ${notCurrent}（${pct(notCurrent)}%）`);
console.log(`  うち現行                         ${rows - notCurrent}（${pct(rows - notCurrent)}%）`);
console.log(
  `type が id の接頭辞と一致          ${nodes.filter((n) => n.id.split("-")[0] === n.type).length}/${nodes.length}`,
);
console.log(`ドメインを越える行                 ${crossing}/${rows}`);
console.log(
  `review_by を持つ節点               ${nodes.filter((n) => n.review_by).length}/${nodes.length}`,
);
console.log(`登録簿が現行と呼ぶ status          ${(snapshot.registry?.currentStatuses ?? []).length} 語`);
console.log(`上流が走らせた検査                 ${snapshot.checksRun.length} 件`);
