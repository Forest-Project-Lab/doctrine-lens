// 上流の**宣言済み読み口**を build 時に一度だけ叩き、返った値をそのまま保存する。
//
//   node capture.mjs [--repo <path>] [--docs-root <path>] [--doctrine <path>]
//                    [--python <exe>] [--timeout-ms <n>] [--out <path>] [--print-plan]
//
// なぜ要るか: 画面は**手書きの事実を一切持たない**。描いてよいのは、この四つの口が
// 返した値だけである(doctrine#294・所有者決定 2026-08-16)。口を叩くのは build のときで、
// 出荷する成果物は実行時に通信しない。
//
// 依存してよいのは CLI の返す値だけである(上流 ICD-002・ICD-005・ICD-006・ICD-007)。
// 統治木のファイルを直に読まない —— 直読みは契約外であり、上流が形を変えても気付けない。
//
// **欠落を正常値へ変換しない。** 口が答えない・形が違う・空を返すは、それぞれ別の状態として
// 記録する。空配列に畳むと「測って 0 件だった」と「測れなかった」が同じ形になる。
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic, sweepStale } from "../lib/atomic-write.mjs";
import { stringifyStable } from "../lib/stable-json.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const one = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const brief = (s, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const repoRoot = resolve(one("--repo") ?? join(here, "..", "..", ".."));
const docsRoot = resolve(one("--docs-root") ?? join(repoRoot, "doctrine_docs"));
const outPath = resolve(one("--out") ?? join(here, "surfaces.json"));

// 区切りを含む相対は受けない(ADR-010 と同じ規律。測る対象が同梱した実行体を走らせない)。
const python = one("--python") ?? "python3";
if (/[\\/]/.test(python) && !python.startsWith("/") && !python.startsWith("~/") && !/^[A-Za-z]:[\\/]/.test(python)) {
  die(`--python は区切りの無い名前・絶対経路・~/ のいずれかで渡す: ${python}`);
}

// 時間切れが無いと、CI は落ちるのではなく止まる。
const timeoutMs = Number(one("--timeout-ms") ?? 300000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) die(`--timeout-ms は 1000 以上の整数で渡す: ${one("--timeout-ms")}`);
const RUN = { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 };

const pluginRoot = one("--doctrine")
  ? resolve(one("--doctrine"))
  : (() => {
    try {
      return execFileSync("node", [join(repoRoot, "tools", "doctrine-path.mjs"), "--require-pin"], RUN).trim();
    } catch (e) {
      die(`上流の実体が固定と食い違う、または見つからない。測らずに止める。\n  ${brief(e.stderr ?? e.stdout ?? e.message)}`, 2);
    }
  })();

/**
 * 叩く口の一覧。**ここが「画面が知りうる全部」の正本である。**
 * 増やすときはここへ足す —— 足さない限り画面には出せない。
 */
const SURFACES = [
  {
    id: "model-index",
    schema: "model-index/1",
    why: "この木に在る意味モデルの一覧。0 件は『まだ書いていない』であって『無くてよい』ではない",
    script: "render-projection.py",
    args: ["model", "--list", "--docs-root", docsRoot],
  },
  {
    id: "dep-graph",
    schema: "dep-graph/1",
    why: "文書どうしの依存辺。統治の形そのもの",
    script: "dep-graph.py",
    args: ["--root", docsRoot, "--classify-edges", "--json"],
  },
  {
    id: "trace-index",
    schema: "trace-index/1",
    why: "仕様からコードへの注釈対。**指紋まで採れている唯一の実測**",
    script: "trace-index.py",
    args: ["--root", repoRoot, "--docs-root", docsRoot, "--format", "json"],
  },
  {
    id: "docs-audit",
    schema: "docs-audit/1",
    why: "統治木そのものの検査。被覆と所見",
    script: "docs-audit.py",
    args: ["--root", docsRoot, "--json", "--fail-on", "never", "--today", one("--today") ?? new Date().toISOString().slice(0, 10)],
  },
];

if (flag("--print-plan")) {
  console.log(stringifyStable({
    repo: repoRoot, docs_root: docsRoot, doctrine: pluginRoot, out: outPath,
    surfaces: SURFACES.map((s) => ({ id: s.id, schema: s.schema, cmd: [s.script, ...s.args] })),
  }));
  process.exit(0);
}

/** 一つの口を叩く。**失敗の形を潰さない** —— どう失敗したかが後で読める形で返す。 */
function capture(s) {
  const base = { id: s.id, schema_expected: s.schema, why: s.why };
  let out;
  try {
    out = execFileSync(python, [join(pluginRoot, "scripts", s.script), ...s.args], RUN);
  } catch (e) {
    const why = e.code === "ETIMEDOUT" || e.signal === "SIGTERM"
      ? `時間切れ(${timeoutMs}ms)`
      : /maxBuffer/i.test(String(e.message)) ? "返す値が受け皿の上限を超えた"
        : `CLI が失敗した(終了コード ${e.status ?? "不明"})`;
    return { ...base, status: "unverifiable", reason: `${why} — ${brief(e.stderr ?? e.message)}`, data: null };
  }
  if (!out.trim()) return { ...base, status: "unverifiable", reason: "終了コードは 0 だが返す値が空である", data: null };
  let j;
  try { j = JSON.parse(out); } catch { return { ...base, status: "unverifiable", reason: `返す値が JSON でない — ${brief(out, 200)}`, data: null }; }
  // **知らない形を「たぶん大丈夫」で読まない。** 読むと、画面が知らない値を実測として印字する。
  if (j.schema !== s.schema) return { ...base, status: "unverifiable", reason: `想定外の schema: ${j.schema}`, data: null };
  return {
    ...base,
    status: "captured",
    reason: null,
    // 版の三鍵は上流 ICD-002「測った木の版と作り手」の宣言。**こちらで git を叩いて作らない。**
    // 名乗らない道具のときは undefined と null を分ける —— 「言わなかった」と「言えなかった」は別である。
    source_revision: "source_revision" in j ? j.source_revision : undefined,
    source_dirty: "source_dirty" in j ? j.source_dirty : undefined,
    generator: j.generator ?? null,
    data: j,
  };
}

const captured = SURFACES.map(capture);

// **同じ木を測ったか。** 上流 ICD-002 が「複数の返す値の source_revision が同値であることを
// 『同じ木を測った』ことの照合に使う」と宣言している。食い違えば、画面は別々の瞬間の断片を
// 一枚の絵として出すことになる。**畳まずに記録する。**
const revs = [...new Set(captured.filter((c) => c.status === "captured").map((c) => c.source_revision ?? null))];
const sameTree = revs.length === 1 && typeof revs[0] === "string";

const result = {
  schema: "system-map/surfaces/1",
  $comment:
    "上流の宣言済み読み口を build 時に一度だけ叩いて保存した物。**手書きの事実を含まない。** "
    + "画面はこの一枚だけから描く。status が captured でない口は、空ではなく『測れなかった』として描くこと。",
  captured_from: {
    doctrine: pluginRoot,
    // 絶対経路は載せない(上流が root に絶対経路を載せないのと同じ配慮。機械をまたいで共有する物である)。
    repo: "(この木)",
    docs_root: "(この木の統治木)",
  },
  same_tree: sameTree,
  same_tree_reason: sameTree
    ? null
    : revs.length === 0 ? "捕れた口が一つも無い"
      : revs.length > 1 ? `口ごとに測った木の版が違う: ${revs.map((r) => String(r).slice(0, 12)).join(" / ")}`
        : "口が測った木の版を名乗らなかった",
  source_revision: sameTree ? revs[0] : null,
  surfaces: captured,
  totals: {
    captured: captured.filter((c) => c.status === "captured").length,
    unverifiable: captured.filter((c) => c.status !== "captured").length,
  },
};

sweepStale(outPath);
writeAtomic(outPath, stringifyStable(result) + "\n");

for (const c of captured) {
  console.log(`  ${c.status === "captured" ? "捕れた  " : "測れない"} ${c.id.padEnd(14)} ${c.status === "captured" ? `rev ${String(c.source_revision ?? "(名乗らず)").slice(0, 12)} / 汚れ ${c.source_dirty}` : c.reason}`);
}
console.log(`\n捕れた ${result.totals.captured} / 測れない ${result.totals.unverifiable} — 同じ木を測ったか: ${sameTree ? "はい" : "いいえ(" + result.same_tree_reason + ")"}`);

// **一つでも捕れなければ止める。** 欠けたまま画面を作ると、欠けたことが画面から読めない。
// 画面の側は「測れなかった」を描けるが、それは**捕れた口の中の欠落**の話である。
if (result.totals.unverifiable > 0) process.exit(1);
