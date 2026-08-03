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
// ここは「`<id>` を起点に置くと `<N>` 行」という形の**主張**だけを拾い、
// **誤りの引用は拾わない**（変更の記録は「こう書いてあったが誤りだった」を引くので、
// それを測ると直した記録そのものが門を赤くする）。
// 実際に組み立てて数を突き合わせる。合わなければ非ゼロで終わる。
//
// **刻印が在るなら、その木で測る。** 初版は「数を直すか、刻印を添えて『いつの木か』を
// 書くこと」と言いながら、添えた刻印を読まずに、いつも作業木で測っていた。
// 逃げ道を示して、その逃げ道を塞いでいた（CHANGE-024）。刻印を読むと、
// **主張は書いた時点で正しかったか**を問える——これは木が育っても変わらない。
//
//   node tools/check-measured-claims.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  // **字面を一字一句で縛らない**（CHANGE-028）。初版は「`<id>` を起点に置くと <N> 行」
  // だけを拾っていたので、`CHANGE-020` の「`ADR-008`（取得を二つの拍に分ける）を
  // 起点に置くと、明細は 0 行である」を一度も見なかった。**その主張は実際に偽になっていた**
  // （書いた時点は 0 行、いまは 13 行。同じ変更が `ADR-008` に辺を足したためである）。
  for (const m of text.matchAll(/`([A-Z]+-\d+)`[^\n`]{0,40}?を起点に置くと[^\n]{0,24}?(\d+)\s*行/g)) {
    // **誤りの引用を、主張として読まない。** 変更の記録は「こう書いてあったが誤りだった」
    // を引く。その引用まで測ると、**直した記録そのものが門を赤くする**（実測でそうなった）。
    // 直前の 200 字に「誤り」を含む語が在れば、それは引用である。
    const before = text.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
    if (/誤り|間違|実在しない|取り違え|書いていたが|と書いていた/.test(before)) continue;
    // **刻印を読む。** 主張の前後 200 字に「`<sha>` の木」が在れば、その木で測る。
    // 刻印は「いつの木についての数か」を言う（ADR-021 決定 5）。
    const around = text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 200);
    const stamp = around.match(/`([0-9a-f]{7,40})`\s*の木/);
    claims.push({
      file: file.slice(projectRoot.length + 1),
      id: m[1],
      rows: Number(m[2]),
      at: stamp ? stamp[1] : null,
    });
  }
}
// **零件を緑と読まない**（ADR-023・CHANGE-028）。文書に在るはずのものを一件も
// 拾えないなら、点検が済んだのではなく**点検できていない**。
// 下限も置く——正規表現が静かに痩せたときに、件数の落ち込みで気づける。
const FLOOR = 4;
if (claims.length < FLOOR) {
  console.error(`実測の主張を ${claims.length} 件しか拾えなかった（下限 ${FLOOR}）。`);
  console.error("文書の字面が変わったのなら tools/check-measured-claims.mjs の正規表現を直すこと。");
  console.error("主張そのものを消したのなら、この下限を下げること（数を黙って減らさない）。");
  process.exit(2);
}

/** 一つの木（作業木、または刻印が指す commit を展開した木）で数を測る。 */
const contextOf = async (root, docsRoot) => {
  const outcome = await fetchSnapshot(root, docsRoot, pluginRoot, {
    pythonPath: "python3",
    timeoutMs: 120000,
    cwd: root,
  });
  if (!outcome.ok) return { ok: false, detail: outcome.detail ?? "" };
  const snapshot = outcome.value.snapshot;
  return {
    ok: true,
    graph: snapshot.graph,
    context: {
      findings: snapshot.findings,
      ranges: snapshot.ranges,
      reverseOrphans: snapshot.reverseOrphans ? new Set(snapshot.reverseOrphans) : null,
      registry: snapshot.registry,
    },
  };
};

/** 刻印が指す木を一時の場所へ展開する。使い終わったら消す。
 *
 * 浅い複製では commit が手元に無い。そのときは「無い」と名指して止める——
 * **取れなかったことを、合わなかったことに化けさせない**（ADR-023）。 */
const treeAt = (sha) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: projectRoot });
  } catch {
    console.error(`刻印 ${sha} の commit がこの複製に無い（浅い複製かもしれない）。`);
    console.error("CI なら actions/checkout の fetch-depth を 0 にする（CHANGE-024）。");
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), "doctrine-lens-at-"));
  execFileSync("bash", ["-c", `git archive ${sha} | tar -x -C ${JSON.stringify(dir)}`], {
    cwd: projectRoot,
  });
  return dir;
};

// 木ごとに一度だけ組む。刻印の無い主張は作業木で測る。
const trees = new Map();
const treeFor = async (sha) => {
  const key = sha ?? "";
  if (trees.has(key)) return trees.get(key);
  const built = sha
    ? await (async () => {
        const dir = treeAt(sha);
        const got = await contextOf(dir, join(dir, "doctrine_docs"));
        return { ...got, dir };
      })()
    : await contextOf(projectRoot, locateDocsRoot(projectRoot));
  trees.set(key, built);
  return built;
};

const wrong = [];
let stamped = 0;
for (const claim of claims) {
  const tree = await treeFor(claim.at);
  if (!tree.ok) {
    console.error(`統治木を取れない（${claim.at ?? "作業木"}）: ${tree.detail}`);
    process.exit(2);
  }
  if (claim.at) stamped += 1;
  const consequence = buildConsequence(tree.graph, claim.id, tree.context);
  const rows = consequence.waves.flatMap((w) => w.rows).length;
  const where = claim.at ? `${claim.at} の木` : "いまの木";
  const mark = rows === claim.rows ? "ok  " : "違う";
  console.log(`${mark} ${claim.file}: ${claim.id} → 主張 ${claim.rows} 行 / 実測 ${rows} 行（${where}）`);
  if (rows !== claim.rows) {
    wrong.push(`${claim.file}: ${claim.id} は ${where}で ${rows} 行（${claim.rows} と書いてある）`);
  }
}
for (const tree of trees.values()) if (tree.dir) rmSync(tree.dir, { recursive: true, force: true });

if (wrong.length > 0) {
  console.error(`\n文書の実測が、その木と合わない ${wrong.length} 件:`);
  for (const line of wrong) console.error(`  - ${line}`);
  console.error("\n数を直すか、刻印を添えて「いつの木か」を書くこと（ADR-021 決定 5）。");
  console.error("刻印を添えた主張は、その commit の木で測る（CHANGE-024）。");
  process.exit(1);
}
console.log(
  `\n実測の主張 ${claims.length} 件（うち刻印つき ${stamped} 件）は、それぞれの木と合う。`,
);
