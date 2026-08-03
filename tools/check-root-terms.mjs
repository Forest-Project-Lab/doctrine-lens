// 統治木の外に在る根の文書を、用語チェッカーに掛ける。
//
// **統治木の外に在るものは、統治の外に在る。** これで四度目である
// （`ICD-001` の `canonical_for` は辺ではない／`.preview/shots/` は gitignore の中／
// `IMPL-001` の表は指紋ではない／そして根の文書は `doctrine_docs/` の外）。
//
// `docs-linter.py --batch` は統治木の中だけを走る。`README.md`・`AGENTS.md`・
// `CLAUDE.md`・`DESIGN.md`・`CHANGELOG.md` は木の外なので、辞書が一度も当たらない。
// 上流は自分の CI で同じ段を持っている（`term-check.py README.md …`）。
// こちらには無かった。実測で 3 件の違反が溜まっていた（CHANGE-025）。
//
// **ERROR だけを見る。** 用語チェッカーは未定義語の初出も助言として挙げるが、
// それは地の文の判断であり、機械が決めることではない（上流の `_termcheck` の頭注）。
//
//   node tools/check-root-terms.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const projectRoot = process.cwd();
const pluginRoot = execFileSync("node", ["tools/doctrine-path.mjs"], {
  cwd: projectRoot,
  encoding: "utf8",
}).trim();

// 根に在る `.md` のうち、人が手で書くもの。生成物と統治木は含めない。
const TARGETS = ["README.md", "AGENTS.md", "CLAUDE.md", "DESIGN.md", "CHANGELOG.md"];

const missing = TARGETS.filter((f) => !existsSync(f));
if (missing.length > 0) {
  // **消えた文書を、通ったことにしない。** 名指した対象が無いなら、
  // それは点検が済んだのではなく、点検できていない（ADR-023）。
  console.error(`点検の対象が無い: ${missing.join("・")}`);
  console.error("消したなら tools/check-root-terms.mjs の一覧からも消すこと。");
  process.exit(2);
}

let out = "";
try {
  out = execFileSync("python3", [`${pluginRoot}/scripts/term-check.py`, ...TARGETS], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
} catch (err) {
  // 用語チェッカーは所見が在っても 0 で終わる（助言なので）。
  // 非ゼロは道具自身の異常であり、点検の結果ではない。
  console.error(`用語チェッカーが異常終了した: ${err.status ?? err.message}`);
  process.exit(2);
}

// **点検できなかった回を、合った回に化けさせない**（ADR-023・CHANGE-029）。
// 上流の用語チェッカーは内部例外を握り潰して stdout に一行出し、**exit 0 を返す**
// （頭注が「常に終了コード 0（リンタの一機能として Hook 連鎖を壊さない）」と明記している）。
// `[ERROR]` だけを見ると、**辞書を一度も引けなかった回が緑になる。**
if (/term-check: internal error/.test(out)) {
  console.error("用語チェッカーが内部で落ちた（点検は済んでいない）:");
  console.error(out.trim());
  process.exit(2);
}

const errors = out.split("\n").filter((line) => line.includes("[ERROR]"));
if (errors.length > 0) {
  console.error(`根の文書に ${errors.length} 件の ERROR:`);
  for (const line of errors) console.error(line.trim());
  console.error("\n辞書は `doctrine_docs/_system/glossary.md` に在る（ADR-018）。");
  process.exit(1);
}
console.log(`根の文書 ${TARGETS.length} 件は、辞書と合う（${TARGETS.join("・")}）。`);
