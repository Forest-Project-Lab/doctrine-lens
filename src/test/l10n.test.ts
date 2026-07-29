// TEST-005 の追補 — 表示の文字列が翻訳を経ること（ADR-007）。
//
// `src/l10n.ts` は vscode を取り込むので、この試験からは直に呼べない。
// 確かめるのは資源の側、つまり「原文が英語であること」「日本語の訳が揃っていること」
// 「実装に日本語の表示文字列が残っていないこと」の三つである。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PROJECT = resolve(__dirname, "..", "..");

/**
 * 日本語（かな・漢字）または全角の約物を含むか。
 *
 * 全角約物を見ていなかったため、英語の表示に「Bound code ranges（3）」のような
 * CJK の括弧が混じるのを止められなかった（実際に起きた欠陥）。
 * 範囲: かな・漢字、CJK の約物（。、「」（）など）、全角の英数と記号。
 */
const HAS_JAPANESE = /[぀-ヿ一-鿿　-〿＀-￯]/;

function readJson(rel: string): Record<string, string> {
  return JSON.parse(readFileSync(join(PROJECT, rel), "utf8")) as Record<string, string>;
}

test("l10n の原文が英語で、日本語の訳が揃っている", () => {
  const bundle = readJson("l10n/bundle.l10n.ja.json");
  const untranslatedKeys = Object.keys(bundle).filter((k) => HAS_JAPANESE.test(k));
  assert.deepEqual(untranslatedKeys, [], "鍵（原文）に日本語が混じっている");

  // frontmatter の項の名をそのまま出す札（status・owner）は訳さない。
  // 日本語の読み手もその綴りで呼ぶので、訳すとかえって引けなくなる。
  const keptAsIs = new Set(["Status", "Owner"]);
  const untranslatedValues = Object.entries(bundle)
    .filter(([k]) => !keptAsIs.has(k))
    .filter(([, v]) => !HAS_JAPANESE.test(v) && !/^[\s\d{}.·–-]*$/.test(v))
    .map(([k]) => k);
  assert.deepEqual(untranslatedValues, [], "訳が日本語になっていない項がある");
});

test("manifest の翻訳が英語と日本語で同じ鍵を持つ", () => {
  const en = readJson("package.nls.json");
  const ja = readJson("package.nls.ja.json");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort(), "鍵が食い違う");
  for (const [key, value] of Object.entries(en)) {
    assert.ok(!HAS_JAPANESE.test(value), `英語の側に日本語が混じっている: ${key}`);
  }
  for (const [key, value] of Object.entries(ja)) {
    assert.ok(HAS_JAPANESE.test(value), `日本語の側が訳されていない: ${key}`);
  }
});

test("manifest が参照する翻訳の鍵が全て在る", () => {
  const manifest = readFileSync(join(PROJECT, "package.json"), "utf8");
  const en = readJson("package.nls.json");
  const referenced = [...manifest.matchAll(/"%([a-zA-Z0-9._]+)%"/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0, "翻訳の参照が一つも無い");
  const missing = referenced.filter((k) => k && !(k in en));
  assert.deepEqual(missing, [], `manifest が参照する鍵が翻訳に無い: ${missing.join(", ")}`);
});

test("l10n.ts の原文が、日本語の訳の鍵とすべて対応している", () => {
  // 原文を書き換えたのに訳の鍵を直し忘れると、日本語の利用者にだけ英語が出る。
  // 落ちはしないので、字面で突き合わせる以外に気づく手立てが無い。
  const source = readFileSync(join(PROJECT, "src", "l10n.ts"), "utf8");
  const bundle = readJson("l10n/bundle.l10n.ja.json");
  const used = new Set(
    [...source.matchAll(/\bt\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      (m[1] ?? "").replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    ),
  );
  assert.ok(used.size > 30, `原文を読み取れていない（${used.size} 件）`);
  const missing = [...used].filter((k) => !(k in bundle));
  assert.deepEqual(missing, [], `訳を持たない原文がある:\n${missing.join("\n")}`);
  const orphan = Object.keys(bundle).filter((k) => !used.has(k));
  assert.deepEqual(orphan, [], `使われていない訳がある:\n${orphan.join("\n")}`);
});

test("l10n が渡す文字列と webview が受ける型が食い違わない", () => {
  const source = readFileSync(join(PROJECT, "src", "l10n.ts"), "utf8");
  const built = source.slice(source.indexOf("export function webviewStrings"));
  const returned = [...built.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]);

  const declared = source.slice(source.indexOf("export interface WebviewStrings"));
  const fields = [...declared.matchAll(/^\s{2}([a-zA-Z]+):\s*string;/gm)].map((m) => m[1]);

  assert.ok(returned.length > 20, "渡す文字列が少なすぎる（読み取りに失敗している）");
  assert.deepEqual(returned.sort(), fields.sort(), "渡す側と受ける側の項が食い違う");
});

test("実装に日本語の表示文字列が残っていない", () => {
  // 注釈は日本語のままでよい（ADR-007）。禁じているのは、
  // 利用者に見える文字列を実装に直に持つことである。
  const offenders: string[] = [];
  for (const file of sourceFiles(join(PROJECT, "src"))) {
    const rel = file.slice(PROJECT.length + 1).replace(/\\/g, "/");
    // 試験と翻訳の定義は対象外。試験の文言は利用者に見えない。
    if (rel.startsWith("src/test/") || rel.startsWith("src/integration/")) continue;
    if (rel === "src/l10n.ts") continue;
    const text = stripComments(readFileSync(file, "utf8"));
    for (const literal of stringLiterals(text)) {
      if (HAS_JAPANESE.test(literal)) offenders.push(`${rel}: ${literal}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `実装に日本語の表示文字列が残っている（ADR-007 の破れ）:\n${offenders.join("\n")}`,
  );
});

// --- 道具 ------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * 注釈を落とす。文字列の中の `//` を注釈と誤らない。
 *
 * 素朴に `//` 以降を消すと、`const SVG_NS = "http://…"` のような行では
 * 同じ行に置いた表示文字列まで丸ごと消え、走査から静かに落ちる。
 * リテラルの中に居るあいだは注釈の開始と見なさない、一文字ずつの走査にする。
 */
function stripComments(text: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (c === quote) {
        quote = "";
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

function stringLiterals(text: string): string[] {
  const out: string[] = [];
  // 逃げ（バックスラッシュ）を含むリテラルも見る。含むものを丸ごと飛ばすと、
  // `"日本語の\n説明"` のような文字列が走査から静かに落ちる。
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const value = m[1] ?? m[2] ?? m[3];
    if (value) out.push(value);
  }
  return out;
}
