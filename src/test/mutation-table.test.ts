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
import { existsSync, readFileSync } from "node:fs";
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
  const declared = [...tool.matchAll(/^ {4}label: "/gm)].length;
  const rows = [
    ...tool.matchAll(
      /label: "([^"]+)",\s*\n\s*file: "([^"]+)",\s*\n\s*from: ([\s\S]+?),\s*\n\s*to: /g,
    ),
  ];
  assert.ok(declared >= 20, `表を読み取れていない（${declared} 件）`);
  assert.equal(
    rows.length,
    declared,
    `表の ${declared} 行のうち ${rows.length} 行しか読めていない（読み飛ばした行は検められない）`,
  );

  const missing: string[] = [];
  for (const [, label, file, literal] of rows) {
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

