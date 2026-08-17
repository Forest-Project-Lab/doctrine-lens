// build 時の実測 overlay。
//
//   node build-overlay.mjs [--repo <prefix>=<path>]... [--docs-root <prefix>=<path>]...
//                          [--doctrine <path>] [--out-dir <path>] [--python <実行体>]
//                          [--timeout-ms <n>] [--check] [--print-plan] [--allow-dirty]
//
// --check は **鮮度**を見る(いまの rev で生成した物と一致するか)。決定論は、同じ rev で
// 二度生成して比べることで確かめる —— TZ と LC_ALL を変えても byte 一致することを実測した。
//
// 宣言済み CLI(上流 ICD 002 trace-index-api)を build 時に一度だけ実行し、対象の
// アンカーへ「実測の範囲・指紋」を重ねる。
// - 読むのは CLI の返す値だけ(台帳 v3.2-14。`.claude/.cache` は読まない)。
// - doctrine 対象の鮮度判定は doctrine の機構だけを使う(v3.2-10)。
// - 実行時の外部読取りは零のまま(overlay は build 時に固定 JSON 化される。M-13 不変)。
//
// **落ちたアンカーを黙って消さない。** 以前は `src/*.ts` に合う物だけを拾い、
// 合わなければ `continue` していた。空配列と「見つからなかった」と「見に行けなかった」が
// 同じ形になっていた。いまは候補ごとに必ず一件を出し、書き出す前に件数を照合する。
//
// **入力は明示する。** 以前は自分の置き場から三つ上を対象リポジトリと決め打ち、
// 統治木を `doctrine_docs` と決め打っていた。`process.cwd()` へも既定へも黙って寄せない。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModels, targetIds, OVERLAY_SCHEMA_ID, OVERLAY_EMPTY_STATUS } from "../gold-model/spec.mjs";
import { parseAnchorTarget } from "../lib/anchor-target.mjs";
import { overlayCandidates } from "../lib/overlay-candidates.mjs";
import { stringifyStable } from "../lib/stable-json.mjs";
import { writeAtomic, sweepStale } from "../lib/atomic-write.mjs";
import { revState } from "../lib/rev-state.mjs";
import { slugOf, assertUniqueSlugs } from "../lib/target-slug.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const one = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const many = (n) => argv.reduce((acc, a, i) => (a === n && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const brief = (s, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** `<prefix>=<path>` を解く。空白だけ・相対は使い方の誤りであって「未指定」ではない。 */
function binding(spec, what) {
  const eq = spec.indexOf("=");
  if (eq <= 0) die(`--${what} は <接頭>=<経路> の形で渡す: ${spec}`);
  const prefix = spec.slice(0, eq).trim();
  const raw = spec.slice(eq + 1);
  if (!prefix) die(`--${what} の接頭が空である: ${spec}`);
  if (!raw.trim()) die(`--${what} の経路が空である(未指定ではなく使い方の誤りとして扱う): ${spec}`);
  if (!raw.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(raw)) die(`--${what} の経路は絶対で渡す(cwd へ黙って寄せない): ${spec}`);
  return [prefix, resolve(raw)];
}

const repos = new Map(many("--repo").map((s) => binding(s, "repo")));
const docsRoots = new Map(many("--docs-root").map((s) => binding(s, "docs-root")));
const outDir = one("--out-dir") ? resolve(one("--out-dir")) : here;

// 呼ぶ道具を差し替えられるようにする。**壊れた道具の振る舞いは、壊れた道具でしか
// 確かめられない**(test-chaos.mjs が偽の実行体を差す)。
// 区切りを含む相対は受けない —— 測る対象のリポジトリが同梱した実行体が走ってしまう
// (src/doctrine/cli.ts の resolvePython と同じ規律。ADR-010)。
const python = one("--python") ?? "python3";
if (/[\\/]/.test(python) && !python.startsWith("/") && !python.startsWith("~/") && !/^[A-Za-z]:[\\/]/.test(python)) {
  die(`--python は区切りの無い名前・絶対経路・~/ のいずれかで渡す: ${python}`);
}

// 答えない道具にぶら下がらない。**時間切れが無いと、CI は落ちるのではなく止まる。**
const timeoutMs = Number(one("--timeout-ms") ?? 120000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) die(`--timeout-ms は 1000 以上の整数で渡す: ${one("--timeout-ms")}`);
// 既定の受け皿(1 MiB)は大きな木で溢れる。溢れたことを「測れなかった」とだけ言うと
// 原因が読めない。広げたうえで、溢れたときは溢れたと言う。
const RUN = { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 };

// 既定は「この木を doctrine-lens として束ねる」だけ。**明示が在ればそれが勝つ。**
if (!repos.has("doctrine-lens")) repos.set("doctrine-lens", resolve(here, "..", "..", ".."));
if (!docsRoots.has("doctrine-lens")) docsRoots.set("doctrine-lens", join(repos.get("doctrine-lens"), "doctrine_docs"));

// 固定とずれた実体で測ると、記録は「測った」と名乗るのに中身は別の版の話になる。
// **止める。** ただし生の例外で止めない —— この木では、使い方と環境の誤りは
// 終了コード 2 と日本語の一行である。
const pluginRoot = one("--doctrine")
  ? resolve(one("--doctrine"))
  : (() => {
    try {
      return execFileSync("node", [join(repos.get("doctrine-lens"), "tools", "doctrine-path.mjs"), "--require-pin"], RUN).trim();
    } catch (e) {
      die(`上流の実体が固定と食い違う、または見つからない。測らずに止める。\n  ${brief(e.stderr ?? e.stdout ?? e.message)}`, 2);
    }
  })();

if (flag("--print-plan")) {
  // **何を測るつもりかを言う。** 束ねた木と置き場だけでは、対象を増やしたときに
  // 「増えた対象を測るつもりが在るのか」を外から確かめられない。
  console.log(stringifyStable({
    repos: Object.fromEntries(repos),
    docs_roots: Object.fromEntries(docsRoots),
    out_dir: outDir,
    doctrine: pluginRoot,
    targets: targetIds("overlay"),
  }));
  process.exit(0);
}

/** 束ねた木ごとに、宣言済み CLI を一度だけ呼ぶ。返す値以外を読まない。 */
const traceCache = new Map();
function traceOf(prefix) {
  if (traceCache.has(prefix)) return traceCache.get(prefix);
  const root = repos.get(prefix);
  const docs = docsRoots.get(prefix);
  let result;
  // `self` は道具が名乗る自己記述 —— 測った木の版・汚れ・道具の版(doctrine 0.12.0 / ICD-002・ICD-005)。
  // **これが在る限り、こちらで git を叩いて版を作らない。** 叩くと、叩いた瞬間と CLI が
  // 読んだ瞬間がずれ、ずれても誰も気付けない(それが版を足してもらった理由である)。
  const blank = { revision: undefined, dirty: undefined, generator: null };
  if (!root) result = { status: "unbound-repo", reason: `接頭 ${prefix} が --repo で束ねられていない`, ranges: [], findings: [], self: blank };
  else if (!docs) result = { status: "unbound-repo", reason: `接頭 ${prefix} の統治木が --docs-root で束ねられていない`, ranges: [], findings: [], self: blank };
  else {
    try {
      const out = execFileSync(python, [join(pluginRoot, "scripts", "trace-index.py"), "--root", root, "--docs-root", docs, "--format", "json"], RUN);
      if (!out.trim()) result = { status: "unverifiable", reason: "終了コードは 0 だが返す値が空である", ranges: [], findings: [], self: blank };
      else {
        let t;
        try { t = JSON.parse(out); } catch (e) { t = null; result = { status: "unverifiable", reason: `返す値が JSON でない — ${out.slice(0, 200)}`, ranges: [], findings: [], self: blank }; }
        if (t) {
          if (t.schema !== "trace-index/1") result = { status: "unverifiable", reason: `想定外の schema: ${t.schema}`, ranges: [], findings: [], self: blank };
          // 上流は findings を返している。以前はそれを捨てていた。捨てると
          // 「走査は成功したが所見が在る」を「所見なし」と同じ形で出すことになる。
          // 所見は捨てない。ただし **経路ごとに絞る** —— 木全体の件数を記録へ入れると、
          // overlay 自身の内容が次の走査の所見を増やし、同じ入力から違う物が出る
          // (実測で 7 → 9 に動いた。自分の記録が自分の測定を変えていた)。
          else {
            // 版を名乗らない道具(0.12.0 より前)なら undefined のまま置く。
            // **「名乗らなかった」を「null(分からない)」と混ぜない** —— 前者は道具が古く、
            // 後者は道具が調べて分からなかった、という別の事実である。
            result = {
              status: "measured", reason: null, ranges: t.ranges ?? [], findings: t.findings ?? [],
              self: {
                revision: "source_revision" in t ? t.source_revision : undefined,
                dirty: "source_dirty" in t ? t.source_dirty : undefined,
                generator: t.generator ?? null,
              },
            };
          }
        }
      }
    } catch (e) {
      // 落ち方を言い分ける。「測れなかった」だけでは、直しようが無い。
      const why = e?.killed || e?.signal
        ? `時間切れ(${timeoutMs} ms を超えても答えない)`
        : e?.code === "ENOBUFS"
          ? `返す値が受け皿(${RUN.maxBuffer} バイト)を超えた`
          : `CLI が失敗した — ${brief(e.stderr ?? e.message, 200)}`;
      result = { status: "unverifiable", reason: why, ranges: [], findings: [], self: blank };
    }
  }
  traceCache.set(prefix, result);
  return result;
}

/**
 * 束ねた木の汚れ。**道具が名乗った値だけを使う。**
 *   true/false  道具が見て答えた
 *   null        道具が言わなかった(古い道具)、または道具が調べて分からなかった
 * 自分で `git status` を叩かない —— 叩いた瞬間と CLI が読んだ瞬間はずれる。
 */
const dirtyOf = (prefix) => traceOf(prefix).self?.dirty ?? null;

/** 道具そのものの版。同じ実体を全ての接頭で使うので、自分の木の分を代表に採る。 */
const generatorOf = (prefix) => traceOf(prefix).self?.generator ?? null;

/**
 * 測った木の版。**道具が名乗ればそれを使う。**
 * 名乗らない道具(0.12.0 より前)のときだけ、こちらで見た値へ落ちる —— そのときは
 * 「見た瞬間」と「CLI が読んだ瞬間」がずれうる。落ちたことは記録に残らないので、
 * 固定を上げることでしか閉じられない(だから固定を上げた)。
 */
const revisionOf = (prefix) => {
  const t = traceOf(prefix);
  return "revision" in (t.self ?? {}) ? (t.self.revision ?? null) : gitOf(prefix).head;
};

const revCache = new Map();
function gitOf(prefix) {
  if (revCache.has(prefix)) return revCache.get(prefix);
  const root = repos.get(prefix);
  const run = (args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: timeoutMs }).trim(); } catch { return null; } };
  // **版と汚れは、もう自分で作らない**(宣言済みの読み口が名乗る。上の traceOf を見よ)。
  // ここに残すのは、道具が答えない二つだけである ——
  //   committed_on  測った rev の commit 日(壁時計を読まないため)
  //   shallow       浅い複製かどうか(rev_state の照合が history を要るため)
  // 二つとも「道具が言わないので、こちらで見た」と分かる形で記録する。
  const head = root ? run(["rev-parse", "HEAD"]) : null;
  const shallowRaw = root ? run(["rev-parse", "--is-shallow-repository"]) : null;
  const info = {
    head,
    // 壁時計を読まない。記録する日付は **測った rev についての事実**にする。
    // 解決できなければ日付を合成せず null で言う。
    committed_on: head ? run(["show", "-s", "--format=%cs", head]) : null,
    shallow: shallowRaw === null ? null : shallowRaw === "true",
  };
  revCache.set(prefix, info);
  return info;
}

const overlays = [];
for (const model of loadModels("overlay")) {
  const candidates = overlayCandidates(model);
  const entries = [];
  for (const a of candidates) {
    const parsed = parseAnchorTarget(a.target);
    if (parsed.kind !== "path") {
      entries.push({
        anchor_id: a.id, status: "unparsed", repo: null, path: null, raw_target: a.target,
        reason: `指す先を経路として読めない(${parsed.reason ?? parsed.kind})`,
        recorded_rev: a.source_revision ?? null, current_rev: null, rev_state: "unknown", ranges_now: [],
      });
      continue;
    }
    const t = traceOf(parsed.repo);
    const observedRev = revisionOf(parsed.repo);
    if (t.status === "unbound-repo" || t.status === "unverifiable") {
      entries.push({
        anchor_id: a.id, status: t.status, repo: parsed.repo, path: parsed.path, raw_target: a.target,
        reason: t.reason, recorded_rev: a.source_revision ?? null, current_rev: observedRev, rev_state: "unknown", ranges_now: [],
      });
      continue;
    }
    const ranges = t.ranges.filter((r) => r.path === parsed.path);
    const findings = (t.findings ?? []).filter((f) => f.path === parsed.path);
    entries.push({
      anchor_id: a.id,
      status: ranges.length ? (findings.length ? "degraded" : "measured") : "no-ranges",
      repo: parsed.repo,
      path: parsed.path,
      raw_target: a.target,
      reason: ranges.length
        ? (findings.length ? `この経路について上流の所見 ${findings.length} 件: ${[...new Set(findings.map((f) => f.check ?? f.code))].sort().join(", ")}` : null)
        : "走査は成功したが、この経路に注釈対が無い",
      recorded_rev: a.source_revision ?? null,
      current_rev: observedRev,
      // **規則は書かない。宣言から導いた一箇所を呼ぶ**(`lib/rev-state.mjs`。上流 ICD-002)。
      rev_state: revState({
        recordedRev: a.source_revision ?? null,
        currentRev: observedRev,
        currentDirty: dirtyOf(parsed.repo),
      }),
      ranges_now: ranges.map((r) => ({ id: r.id, begin_line: r.begin_line, end_line: r.end_line, fingerprint: r.fingerprint })),
    });
  }

  // **落ちたアンカーが無いことを、書き出す前に照合する。**
  if (entries.length !== candidates.length) {
    die(`実測の記録が候補と合わない: 候補 ${candidates.length} 件に対し記録 ${entries.length} 件`, 2);
  }

  const selfPrefix = "doctrine-lens";
  const g = gitOf(selfPrefix);
  const selfDirty = dirtyOf(selfPrefix);
  // **測る対象が一つも無かったことを、測って何も無かったことと同じ形にしない。**
  // 以前は候補 0 件の対象が `measured` + 記録 0 件で出ていた —— どの `.some()` も
  // 空配列では偽なので、何も測っていない走行が最良の状態を名乗っていた。
  const worst = candidates.length === 0
    ? OVERLAY_EMPTY_STATUS
    : entries.some((e) => ["unverifiable", "unbound-repo", "unparsed"].includes(e.status))
      ? "unverifiable"
      : entries.some((e) => e.status === "degraded") || selfDirty === true || g.shallow
        ? "degraded"
        : "measured";
  overlays.push({
    schema: OVERLAY_SCHEMA_ID,
    target: model.target,
    status: worst,
    // 空でないときは鍵ごと置かない。**既に在る記録の byte を動かさない**ため
    // (stringifyStable は与えた鍵だけを並べる)。
    ...(candidates.length === 0
      ? { reason: "この模型に、宣言済み CLI で測れるアンカーが一つも無い(実測の候補が 0 件)。測って何も無かったのではなく、測る対象が無い。" }
      : {}),
    source: "上流 ICD 002 trace-index-api(trace-index/1)を build 時に実行した返す値",
    source_limits:
      "上流の走査は、印が意味の上で正しい場所に打たれているかを判定しない。改名・移動も追わない。" +
      "ここで言えるのは「この rev で、この経路に、この指紋の範囲が在った」までである。",
    // **道具が自分の名と版を名乗る**(doctrine 0.12.0)。以前は導入先の置き場の名から
    // 版を推していた —— 置き場の名は改名できるので、版の証拠にならなかった。
    generator: generatorOf(selfPrefix),
    generated_from_rev: revisionOf(selfPrefix),
    generated_at: g.committed_on,
    generated_at_source: g.committed_on ? "測った rev の commit 日" : null,
    // dirty は道具が名乗った値。shallow は道具が言わないので、こちらで見た値である。
    worktree: { dirty: selfDirty, shallow: g.shallow },
    entries,
  });
}

// 汚れた作業木からの測定は、記録する rev に帰属できない。撮影(shoot.mjs)と同じ規律で
// 書き出しを拒む。手順: コードを commit → 生成 → overlay を commit。
// 開発中は --allow-dirty と --out-dir で一時の置き場へ出す。
if (!flag("--check") && !flag("--allow-dirty")) {
  // 「分からない」を汚れと数えない(数えると、git でない木で常に止まる)。
  const dirtyPrefix = [...repos.keys()].filter((p) => dirtyOf(p) === true);
  if (dirtyPrefix.length) {
    die(
      `作業木が汚れている(${dirtyPrefix.join(", ")})。記録する rev と、実際に測った物が食い違う。\n` +
        `先に commit してから生成すること。開発中は --allow-dirty --out-dir <一時の置き場> を使う。`,
      2,
    );
  }
}

// 名前は人のためのものであり、索く鍵ではない(読み側は各ファイルの target で索く)。
// それでも潰れ合うと、二つの対象が一つのファイルを奪い合って片方が黙って消える。
assertUniqueSlugs(overlays.map((o) => o.target));

mkdirSync(outDir, { recursive: true });
let changed = 0;
for (const o of overlays) {
  // **書き出す前に、記録の数と名乗る状態が一致していることを確かめる。**
  // 読み側でも同じことを検める(片側だけでは、もう片側の欠陥に気付けない)。
  if ((o.entries.length === 0) !== (o.status === OVERLAY_EMPTY_STATUS)) {
    die(
      `overlay の状態と記録の数が食い違う: ${o.target} は状態 ${o.status} で記録 ${o.entries.length} 件。` +
        `記録 0 件と ${OVERLAY_EMPTY_STATUS} は一対一で対応しなければならない`,
      2,
    );
  }
  const path = join(outDir, `overlay-${slugOf(o.target)}.json`);
  const body = stringifyStable(o) + "\n";
  if (flag("--check")) {
    // **これは鮮度の問いであって、決定論の問いではない。**
    // overlay は生成した時点の HEAD を記録する。overlay そのものを commit すると
    // HEAD が進むので、commit 済みの overlay は構造上いつも一つ前の rev を指す。
    // したがって --check は「この overlay はいまの rev で生成された物か」を答える。
    // 決定論(同じ入力から同じ byte)は、同じ rev で二度生成して比べることで確かめる。
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current !== body) {
      changed++;
      const at = [...body].findIndex((c, i) => c !== current[i]);
      console.error(`いまの rev で生成した物と違う: ${path}(最初の食い違いは ${at} バイト目)`);
    }
    continue;
  }
  sweepStale(path);
  writeAtomic(path, body);
}
if (flag("--check")) {
  console.log(changed === 0 ? "overlay はいまの rev で生成した物と byte 一致" : `${changed} 件の overlay がいまの rev の物でない`);
  process.exit(changed === 0 ? 0 : 1);
}

for (const o of overlays) {
  const counts = o.entries.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {});
  console.log(
    `overlay を生成した: ${o.target} / 状態 ${o.status} / アンカー ${o.entries.length} 件 ` +
      `(${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" ")}) / 範囲計 ${o.entries.reduce((n, e) => n + e.ranges_now.length, 0)} 件`,
  );
}
