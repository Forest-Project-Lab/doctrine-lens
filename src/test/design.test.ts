// 意匠の適合（ADR-013・SPEC-006 受入基準 10・12）。
//
// **正本は DESIGN.md である。** この試験は DESIGN.md から段（許す値の集合）を
// 読み取り、CSS がその外の値を使っていないかを見る。試験の中に値を書き写さない。
// 写すと正本が二つになり、片方だけ直したときに何も起きなくなる。
//
// 意匠が凡庸になるのは、値が多いからである。旧実装は余白が六種類（うち四つが
// 4px 格子の外）、角丸が三種類、書体が八段（隣り合う比の中央値 1.02）あった。
// 段が無いのではなく、段を名乗る値が散らばっていた。字面で止める。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PROJECT = resolve(__dirname, "..", "..");
const DESIGN = readFileSync(join(PROJECT, "DESIGN.md"), "utf8");
const HTML = readFileSync(join(PROJECT, "src", "panel", "html.ts"), "utf8");

/** DESIGN.md の CSS を取り出す。`STYLE` のテンプレート文字列がそれである。 */
const STYLE = (() => {
  const at = HTML.indexOf("const STYLE = `");
  assert.ok(at > 0, "html.ts の STYLE を読み取れない");
  const from = HTML.indexOf("`", at) + 1;
  return HTML.slice(from, HTML.indexOf("`", from));
})();

/** DESIGN.md の節を一つ取り出す。 */
function section(number: number): string {
  const from = DESIGN.indexOf(`\n## ${number}. `);
  assert.ok(from > 0, `DESIGN.md に ${number}. 節が無い`);
  const next = DESIGN.indexOf(`\n## ${number + 1}. `);
  return DESIGN.slice(from, next > 0 ? next : undefined);
}

/** 宣言の値だけを見る。属性名や選択子に混じった数を拾わないため。 */
function declarations(property: RegExp): string[] {
  return [...STYLE.matchAll(new RegExp(`(?:^|[;{\\s])(${property.source})\\s*:([^;}]*)`, "gm"))].map(
    (m) => m[2] ?? "",
  );
}

function pxIn(text: string): number[] {
  return [...text.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
}

// --- 段を DESIGN.md から読み取る -------------------------------------------

/** 余白の格子。「4 / 8 / 12 / 16 / 24 / 32」の囲みから読む。 */
const SPACING = (() => {
  const block = /```\s*\n([\d\s/]+)\n```/.exec(section(5));
  assert.ok(block, "DESIGN.md 5 節に余白の段の囲みが無い");
  const values = (block[1] as string).split("/").map((v) => Number(v.trim()));
  assert.ok(values.length >= 4 && values.every(Number.isFinite), "余白の段を読み取れない");
  return new Set([0, ...values]);
})();

/** 角丸の段。「`4`（行の背景）と `8`（起点の欄）」の行から読む。 */
const RADII = (() => {
  const line = /角丸は[^\n]*?。([^\n]*)/.exec(section(5));
  assert.ok(line, "DESIGN.md 5 節に角丸の段が無い");
  const values = [...(line[1] as string).matchAll(/`(\d+)`/g)].map((m) => Number(m[1]));
  assert.ok(values.length > 0, "角丸の段を読み取れない");
  return new Set(values);
})();

/**
 * 書体の段。3 節は二つの族（比例と等幅）を別の表で定める。
 *
 * 族をまたいで比べない。比例の 13px と等幅の 12px は「隣り合う段」ではなく、
 * 族の違いである。まぜて比べると、正しい音階が違反に見える。
 */
const [PROPORTIONAL, MONOSPACE] = (() => {
  const parts = section(3).split(/\*\*等幅は/);
  assert.equal(parts.length, 2, "3 節が比例と等幅に分かれていない");
  const sizes = (text: string): number[] => [
    ...new Set([...text.matchAll(/\|\s*(\d+)px\s*\|/g)].map((m) => Number(m[1]))),
  ];
  const proportional = sizes(parts[0] as string);
  const mono = sizes(parts[1] as string);
  assert.ok(proportional.length >= 3, `比例の段を読み取れない（${proportional}）`);
  assert.ok(mono.length >= 1, `等幅の段を読み取れない（${mono}）`);
  return [proportional, mono];
})();

const FONT_SIZES = new Set([...PROPORTIONAL, ...MONOSPACE]);

/**
 * 太さ。3 節の表から読む。
 *
 * 地の文からは拾わない。「`500` を使わない」という**禁止の文**から 500 を
 * 許す値として拾い、門が禁止を許可として読んでいた（実測で素通りした）。
 * 許す値は表にだけ書く。
 */
const WEIGHTS = (() => {
  const at = section(3).indexOf("**太さは");
  assert.ok(at > 0, "DESIGN.md 3 節に太さの段が無い");
  const rows = [...section(3).slice(at).matchAll(/^\|\s*(\d{3})\s*\|/gm)].map((m) =>
    Number(m[1]),
  );
  assert.ok(rows.length >= 2, `太さの表を読み取れない（${rows}）`);
  return new Set(rows);
})();

/** 使ってよい主題の変数。DESIGN.md に名が出るものだけ。 */
const VARIABLES = new Set([...DESIGN.matchAll(/--vscode-[a-zA-Z-]+/g)].map((m) => m[0]));

// --- 適合 ------------------------------------------------------------------

test("余白が DESIGN.md の 4px 格子の外へ出ていない", () => {
  const offenders: string[] = [];
  for (const value of declarations(/padding|margin|gap|row-gap|column-gap/)) {
    for (const px of pxIn(value)) {
      if (!SPACING.has(Math.abs(px))) offenders.push(`${px}px（${value.trim()}）`);
    }
  }
  assert.deepEqual(offenders, [], `格子の外の余白: ${offenders.join(" / ")}`);
});

test("角丸が DESIGN.md の二段だけである", () => {
  const offenders: number[] = [];
  for (const value of declarations(/border-radius/)) {
    for (const px of pxIn(value)) if (!RADII.has(px)) offenders.push(px);
  }
  assert.deepEqual(offenders, [], `段に無い角丸: ${offenders.join(" / ")}`);
});

test("書体の大きさが DESIGN.md の段だけである", () => {
  const offenders: number[] = [];
  for (const value of declarations(/font-size/)) {
    for (const px of pxIn(value)) if (!FONT_SIZES.has(px)) offenders.push(px);
  }
  assert.deepEqual(offenders, [], `段に無い大きさ: ${offenders.join(" / ")}`);
});

test("隣り合う書体の段の比が 1.15 を下回らない（段を名乗るだけの段を作らない）", () => {
  // 旧実装は八段あったが、隣り合う比の中央値が 1.02 だった。物理的に見分けが付かない。
  // 族ごとに見る。族が違えば、大きさが近くても字面で見分けが付く。
  for (const [name, family] of [
    ["比例", PROPORTIONAL],
    ["等幅", MONOSPACE],
  ] as const) {
    const steps = [...family].sort((a, b) => a - b);
    const tight: string[] = [];
    for (let i = 1; i < steps.length; i += 1) {
      const ratio = (steps[i] as number) / (steps[i - 1] as number);
      if (ratio < 1.15) tight.push(`${steps[i - 1]}→${steps[i]}（${ratio.toFixed(3)}）`);
    }
    assert.deepEqual(tight, [], `${name}に見分けの付かない段: ${tight.join(" / ")}`);
    assert.ok(steps.length <= 4, `${name}の段が多すぎる（${steps.length}）`);
  }
});

test("太さが 400 と 600 だけである（500 を使わない）", () => {
  const offenders: number[] = [];
  for (const value of declarations(/font-weight/)) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && !WEIGHTS.has(n)) offenders.push(n);
  }
  assert.deepEqual(offenders, [], `段に無い太さ: ${offenders.join(" / ")}`);
});

test("色を主題の変数からだけ取り、固定の hex を持たない", () => {
  const hex = [...STYLE.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(hex, [], `固定の色がある: ${hex.join(" / ")}`);
  const functions = [...STYLE.matchAll(/\b(rgba?|hsla?)\(/g)].map((m) => m[1]);
  assert.deepEqual(functions, [], `主題の外の色がある: ${functions.join(" / ")}`);
});

test("使っている主題の変数が、すべて DESIGN.md に載っている", () => {
  const used = [...new Set([...STYLE.matchAll(/--vscode-[a-zA-Z-]+/g)].map((m) => m[0]))];
  const missing = used.filter((name) => !VARIABLES.has(name));
  assert.deepEqual(missing, [], `DESIGN.md に無い変数を使っている: ${missing.join(" / ")}`);
});

test("彩度のある色が、記号の一文字にだけ載っている", () => {
  // charts-red / charts-yellow を、背景・罫・釦・見出しに使わない。
  // 使うと「波及している＝悪い」という嘘を画面がつく。
  const offenders: string[] = [];
  for (const rule of STYLE.split("}")) {
    if (!/--vscode-charts-/.test(rule)) continue;
    for (const line of rule.split(/[{;]/)) {
      if (!/--vscode-charts-/.test(line)) continue;
      const property = /([a-z-]+)\s*:/.exec(line)?.[1] ?? "";
      if (property !== "color") offenders.push(`${property}: charts`);
    }
  }
  assert.deepEqual(offenders, [], `彩度を文字色以外へ使っている: ${offenders.join(" / ")}`);
});

test("! と ~ の記号に彩度のある色を当てていない", () => {
  for (const symbol of ["fix", "review"]) {
    const rule = new RegExp(`\\.row\\.${symbol}\\b[^}]*--vscode-charts-`);
    assert.ok(!rule.test(STYLE), `${symbol} に判定の色を当てている（異常ではないのに）`);
  }
});

test("影・ぼかし・階調を一つも書かない（高さは面の段だけで表す）", () => {
  const banned = /box-shadow|text-shadow|filter\s*:|backdrop-filter|linear-gradient|radial-gradient/g;
  const found = [...STYLE.matchAll(banned)].map((m) => m[0]);
  assert.deepEqual(found, [], `影か階調がある: ${found.join(" / ")}`);
});

test("画面に svg 要素が一つも無い（SPEC-006 受入基準 10）", () => {
  // 注釈は対象外。「svg を作らない」と書いた行に反応すると、
  // 規律を書き留めることが違反になる。見るのは実際に作る綴りだけである。
  const files = ["src/panel/html.ts", "src/webview/main.ts"];
  for (const rel of files) {
    const text = readFileSync(join(PROJECT, rel), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const found = [...text.matchAll(/<svg|createElementNS|["'`]svg["'`]|\.viewBox/g)].map(
      (m) => m[0],
    );
    assert.deepEqual(found, [], `${rel} に svg がある: ${found.join(" / ")}`);
  }
});

test("記号の溝が固定幅で、行の左端が縦に揃う", () => {
  // 走査性の源である。文字を読む前に「後半は全部 ? だ」が縦の縞として見える。
  assert.ok(
    /\.row\s*\{[^}]*grid-template-columns:\s*\d+px\s+minmax\(0,\s*1fr\)/.test(STYLE),
    "行が固定幅の溝と可変の本文の二列になっていない",
  );
});

test("面が縦に潰れない（minmax(0, 1fr) を使う）", () => {
  // 素の 1fr は中身の最小の高さを下回れず、明細の面が 0 まで潰れる。
  assert.ok(/grid-template-rows:[^;]*minmax\(0,\s*1fr\)/.test(STYLE), "面の行が潰れる書き方である");
});

test("横に巻かず、長い語が面から出ない（幅 280px で確かめる：受入基準 11）", () => {
  assert.ok(/overflow-x:\s*hidden/.test(STYLE), "横に巻く");
  // id とパスは区切りの無い長い語である。折らないと狭い幅で面から出る。
  assert.ok(/word-break:\s*break-all/.test(STYLE), "長い語を折る指定が無い");
});

test("読み幅が一つで、字の大きさに依らない単位で書かれている", () => {
  // ch はその要素自身の字の大きさを基準にする。節ごとに右端がずれ、
  // 区切りの罫の長さが揃わなくなる（実測で 500 / 600 / 900px にばらけた）。
  const relative = [...STYLE.matchAll(/max-width:\s*[\d.]+(ch|em|rem)/g)].map((m) => m[0]);
  assert.deepEqual(relative, [], `読み幅が字の大きさに依存している: ${relative.join(" / ")}`);
  const widths = [...new Set([...STYLE.matchAll(/max-width:\s*(\d+)px/g)].map((m) => m[1]))];
  assert.ok(widths.length <= 1, `読み幅が二つ以上ある: ${widths.join(" / ")}`);
  const declared = /読み幅は `(\d+)px`/.exec(section(8))?.[1];
  assert.ok(declared, "DESIGN.md 8 節に読み幅が無い");
  if (widths.length === 1) assert.equal(widths[0], declared, "CSS の読み幅が DESIGN.md と違う");
});

test("幅ごとの分岐を一つも持たない（境目の前後で別の設計を保たない）", () => {
  const queries = [...STYLE.matchAll(/@media[^{]*/g)].map((m) => m[0].trim());
  assert.deepEqual(queries, [], `幅ごとの分岐がある: ${queries.join(" / ")}`);
});

test("起点の欄が面であって、面の上に罫を重ねていない", () => {
  // 高さは面の段だけで表す（DESIGN.md 6 節）。面に罫を足すと段が二重になる。
  const rule = /\.origin\s*\{[^}]*\}/.exec(STYLE)?.[0] ?? "";
  assert.ok(rule, ".origin の規則が無い");
  assert.ok(!/border(?!-radius)/.test(rule), `面に罫を足している: ${rule}`);
});

test("DESIGN.md が九つの節を持つ（正本の書式を崩さない）", () => {
  const headings = [...DESIGN.matchAll(/^## (\d)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(headings, [1, 2, 3, 4, 5, 6, 7, 8, 9], "節の並びが崩れている");
});

test("意匠の値が実装の他の場所に散らばっていない", () => {
  // 寸法や色を持ってよいのは html.ts の STYLE だけである（ADR-013）。
  const text = readFileSync(join(PROJECT, "src", "webview", "main.ts"), "utf8");
  const offenders = [...text.matchAll(/\d+px|--vscode-|#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
  assert.deepEqual(offenders, [], `描き手が意匠の値を持っている: ${offenders.join(" / ")}`);
});
