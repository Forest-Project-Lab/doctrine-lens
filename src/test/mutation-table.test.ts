// 突然変異の表が、実在の行を指しているか。
//
// **この試験はここに一つだけ置く。** tools/mutate-check.mjs はまさにこの表の
// `from` を消して潰すので、他の試験と同じ束に入れると、どの行を潰しても必ず
// この試験が赤くなり、道具は「試験が落ちた＝守られている」と読む。
// 実測で、27 行のうち 25 行はこの試験だけが赤かった。つまり道具の判定は
// 自分が仕込んだ赤を見ていただけで、直しが守られているかを一切見ていない。
// 四巡目「門が一度も発火しない」・五巡目「型検査の失敗を試験の失敗と読む」と
// 同じ欠陥である。
//
// だから道具はこのファイルを除いて回す。`npm test` と CI は全件を回すので、
// 潰したまま残る事故の検知は落ちない。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PROJECT = resolve(__dirname, "..", "..");

test("突然変異の表が実在の行を指し、潰したままの行が残っていない", () => {
  // 道具が途中で殺されると、潰れたソースが作業ツリーに残る。残ったまま
  // 全件が緑になることがある（潰しの多くは一つの試験しか赤くしない）。
  // 表の `from` がすべて実在することを、ここで毎回検める。表が古いことも同時に分かる。
  const tool = readFileSync(join(PROJECT, "tools", "mutate-check.mjs"), "utf8");

  // **読めた数が、表の行数と一致することを先に検める。**
  // 以前はここが `from: (.+)` で、複数行のテンプレートリテラルを黙って読み飛ばしていた。
  // 実測で 55 行のうち 2 行が読まれず、その 2 行は字面が古びても誰も咎めなかった
  // （二度腐って、二度とも走行の途中で「対象不明」として出た）。
  // **読み飛ばしを、数の一致で塞ぐ。** 読めない行が在れば、ここで落ちる。
  // **数え方を引用符の種類に依らせない。** `label: "…"` だけを数えると、
  // 単引用符や逆引用符で書いた行が「宣言」と「読めた」の両方から同時に落ち、
  // 数は一致したままその行だけ検められない（門の穴になる）。
  const declared = [...tool.matchAll(/^ {4}label: /gm)].length;
  const rows = [
    ...tool.matchAll(
      /label: (?:"[^"]*"|'[^']*'|`[^`]*`),\s*\n\s*file: "([^"]+)",\s*\n\s*from: ([\s\S]+?),\s*\n\s*to: /g,
    ),
  ];
  assert.ok(declared >= 20, `表を読み取れていない（${declared} 件）`);
  assert.equal(
    rows.length,
    declared,
    `表の ${declared} 行のうち ${rows.length} 行しか読めていない（読み飛ばした行は検められない）`,
  );

  const missing: string[] = [];
  for (const [whole, file, literal] of rows) {
    const label = (whole as string).slice(0, 60);
    const from = parseLiteral(literal as string);
    const source = readFileSync(join(PROJECT, file as string), "utf8");
    if (!source.includes(from)) missing.push(`${label} (${file})`);
  }
  assert.deepEqual(
    missing,
    [],
    `表が指す行が実在しない（表が古いか、潰したまま残っている）:\n${missing.join("\n")}`,
  );

  // 戻し方の記録が残っていれば、前回の走行が途中で死んでいる。
  assert.ok(
    !existsSync(join(PROJECT, ".mutate-restore.json")),
    "前回の突然変異が途中で止まっている。npm run mutate を一度回すと元へ戻る。",
  );
});

test("仕様の受入がすべて受入基準の節に在り、番号が飛ばない", () => {
  // **受入は「受入基準」の節に在る。** 別の節へ紛れ込むと、そこが受入だと
  // 誰も読まない。実測で、`SPEC-006` の受入 26 件のうち 12 件が
  // 「## 実装の指紋」の節の本文として置かれ、末尾の sha256 と同居していた。
  //
  // 番号の飛びも見る。飛んでいたら、消えたのか書き忘れたのかが読めない。
  for (const file of specFiles()) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("## 受入基準")) continue;
    const name = file.slice(PROJECT.length + 1);

    const outside: string[] = [];
    let section = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("## ")) section = line.slice(3).trim();
      const m = /^(\d+)\. /.exec(line);
      if (m && section !== "受入基準" && /^(実装の指紋|覆わないもの)$/.test(section)) {
        outside.push(`${name}: ${section} の下に「${m[1]}.」`);
      }
    }
    assert.deepEqual(outside, [], "受入が受入基準の節の外に在る");

    const body = ((text.split("## 受入基準")[1] ?? "").split("\n## ")[0] ?? "") as string;
    const numbers = [...body.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    assert.ok(numbers.length > 0, `${name}: 受入を読み取れていない`);
    const expected = numbers.map((_, i) => i + 1);
    assert.deepEqual(numbers, expected, `${name}: 受入の番号が 1 から連番でない`);
  }
});

/** 統治木の仕様（`SPEC-*.md`）を集める。 */
function specFiles(): string[] {
  const dir = join(PROJECT, "doctrine_docs", "lens", "spec");
  return readdirSync(dir)
    .filter((n) => n.startsWith("SPEC-") && n.endsWith(".md"))
    .map((n) => join(dir, n));
}

test("仕様の受入がすべて、番号つきの試験か「画面側」の宣言で受け持たれている", () => {
  // **番号を飾りにしない。** 実測で、`SPEC-006` の受入 15〜22 に対し試験は
  // 16・17・19・15・20・21・25 とばらばらだった。誰も突き合わせていないので
  // ずれても気づかない。受入 21（語の定義）には番号つきの試験が一件も無く、
  // 仕様に番号の無い主題が四つ番号を占めていた（`CHANGE-011`）。
  //
  // 単体試験で見られない受入（編集器・実物の画面・CSS）は `TEST-006` が
  // 「画面側」と宣言する。**宣言も試験も無い受入を、ここで落とす。**
  const spec = readFileSync(
    join(PROJECT, "doctrine_docs", "lens", "spec", "SPEC-006-consequence-list.md"),
    "utf8",
  );
  const body = ((spec.split("## 受入基準")[1] ?? "").split("\n## ")[0] ?? "") as string;
  const numbers = [...body.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.ok(numbers.length > 20, `受入を読み取れていない（${numbers.length} 件）`);

  const acceptance = readFileSync(
    join(PROJECT, "doctrine_docs", "lens", "test", "TEST-006-consequence-acceptance.md"),
    "utf8",
  );
  const declared = new Set(
    [...acceptance.matchAll(/^\| (\d+) \| 画面側/gm)].map((m) => Number(m[1])),
  );

  const tested = new Set<number>();
  for (const file of testSources(join(PROJECT, "src", "test"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/^test\(\s*"006-(\d+)[a-z]?\. /gm)) {
      tested.add(Number(m[1]));
    }
  }

  const orphans = numbers.filter((n) => !tested.has(n) && !declared.has(n));
  assert.deepEqual(orphans, [], "試験も「画面側」の宣言も無い受入が在る");

  const strays = [...tested].filter((n) => !numbers.includes(n)).sort((a, b) => a - b);
  assert.deepEqual(strays, [], "仕様に無い受入番号を名乗る試験が在る");
});

test("主張を一つも持たない試験が無い（零件の主張で通さない）", () => {
  // 通らない道を通ったことにする門は、落ちないので気づかれない。
  // 実測で三つ在った——`symlink` の試験は `if (found !== null)` の中だけに主張を置き、
  // この環境では `null` が返るので**本体が一度も走らなかった**。
  //
  // **括弧の数で本体を切らない。** 最初にそうしたら、正規表現リテラル `/[{;]/` の
  // `{` に騙されて、主張を持つ試験を三本「持たない」と報せた。
  // **門を作るときに、門が嘘をついた。** 行頭の `test(` で区切る。
  const bare: string[] = [];
  for (const file of testSources(join(PROJECT, "src", "test"))) {
    const text = readFileSync(file, "utf8");
    const starts = [...text.matchAll(/^test\(\s*"((?:[^"\\]|\\.)*)"/gm)];
    for (const [index, match] of starts.entries()) {
      const from = match.index ?? 0;
      const to = starts[index + 1]?.index ?? text.length;
      const body = text.slice(from, to);
      if (!body.includes("assert") && !body.includes("t.skip")) {
        bare.push(`${file.slice(PROJECT.length + 1)}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(bare, [], "主張を一つも持たない試験が在る");
});

test("試験の名が重複していない（潰しの報告が、どれが捕まえたかを名で言う）", () => {
  // `tools/mutate-verdict.mjs` の `namesOfFailed` は `not ok N - <名>` から
  // **名前だけ**を取る。同じ名の試験が二つ在ると、報告のどちらを指しているかが
  // 読めなくなる。node:test は同名を黙って許すので、ここで止める。
  //
  // 実測でそうなった——受入の番号を仕様に足したとき、既に別の主題が同じ番号を
  // 使っており、`006-23`・`006-24`・`006-25`・`006-25b` が二つずつ在った。
  // 潰しの報告は「006-25 が捕まえた」と刷るが、どちらの 006-25 かは分からない。
  const names: string[] = [];
  for (const file of testSources(join(PROJECT, "src", "test"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^test\(\s*"((?:[^"\\]|\\.)*)"/gm)) {
      names.push((m[1] as string).replace(/\\"/g, '"'));
    }
  }
  assert.ok(names.length > 50, `試験名を読み取れていない（${names.length} 件）`);

  const seen = new Map<string, number>();
  for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([name, n]) => `${name} ×${n}`);
  assert.deepEqual(duplicated, [], "同じ名の試験が在る");
});

/** `src/test` 直下の `*.test.ts` を集める。 */
function testSources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

/**
 * 表に書いてある文字列リテラル（`'…'`・`"…"`・`` `…` ``）を、値へ解く。
 *
 * 逆引用符（テンプレートリテラル）は複数行を跨ぐ。表の `from` は実際の
 * ソースの数行をそのまま書き写すので、この形が要る。
 */
function parseLiteral(literal: string): string {
  const text = literal.trim();
  const quote = text[0] as string;
  const body = text.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i] as string;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    if (next === "n") out += "\n";
    else if (next === quote) out += quote;
    else out += next ?? "";
  }
  return out;
}

