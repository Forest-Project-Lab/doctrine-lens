// 対象を一つ増やしたとき、**対象を列挙する全ての場所がそれを拾う**ことを検める。
// あわせて、実測 overlay が自分の宣言した対象で索かれ、壊れた入力を黙って通さないことを検める。
//
//   node test-targets-wired.mjs [--report <path>] [--today YYYY-MM-DD]
//
// なぜ要るか: 「対象を足せば自動で参加する」は、いまのところ**約束であって門ではない**。
// 実際、対象は配列の添字で指されており(spec.mjs の targetIndex)、overlay は生成側の
// ファイル名で読まれている(build.mjs)。どちらも**落ちない**ので、並べ替えれば静止画が
// 別の対象を撮り、対象を足せば overlay が読まれないまま build が成功する。
//
// 手: `research/system-map` を一時の置き場へ写し、写しの registry へ合成の対象を差す。
// **実物の作業木に触れない**(test-mutation.mjs と同じ規律)。差す位置は**先頭と末尾の両方**
// である —— 「増えたか」ではなく「位置に依っていないか」を問うているので、一箇所だけでは
// 答えにならない。
//
// この段はブラウザを起こさない。列挙は生成物の字面と、道具の --print-plan から読む。
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verdict, reportPathFrom, writeReport, gateExitCode, todayFrom } from "../gold-model/report.mjs";
import { REGISTRY, TARGETS, targetIds, targetsWithRole } from "../gold-model/spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");
const today = todayFrom(process.argv.slice(2));
const TODAY = ["--today", today.date];

/** 合成の対象。**架空であることを名前で言う。**実在の成果物を一つも指さない。 */
const PROBE_ID = "probe-wired(合成)";
const PROBE_FILE = "probe-wired.json";

/** 複製の元にする対象。doctrine 権威の code_range を持つ物を選ぶ(被覆規則の両側を試せる)。 */
const CLONE_FROM = TARGETS.find((t) => t.roles.includes("overlay")) ?? TARGETS[0];

const wired = [];
const indexing = [];
const ok = (bag, what) => { bag.push({ what, violation: null }); console.log(`ok   ${what}`); };
const ng = (bag, what, why) => {
  bag.push({ what, violation: { code: bag === wired ? "wired.not_enumerated" : "overlay.accepted_bad_input", message: `${what}: ${why}` } });
  console.log(`NG   ${what} — ${why}`);
};
/** 検めそのものが転んだら、合格にも不合格にもせず**転んだと言う**。 */
const check = (bag, what, fn) => {
  try {
    const why = fn();
    if (why) ng(bag, what, why); else ok(bag, what);
  } catch (e) {
    ng(bag, what, `検めが例外で止まった — ${e.message}`);
  }
};

const run = (bin, args, cwd) => {
  try {
    const stdout = execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? "").toString(), stderr: (e.stderr ?? "").toString() };
  }
};

/** 所見の一行に多行の出力を混ぜない(読めない記録は記録として弱い)。 */
const brief = (s, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

// ---------------------------------------------------------------- 写しを作る

const work = mkdtempSync(join(tmpdir(), "system-map-wired-"));
const copy = join(work, "system-map");
cpSync(src, copy, {
  recursive: true,
  // 静止画と記録は列挙に関係が無く、写すと重い。node_modules は下で繋ぐ。
  filter: (p) => !/[\\/](shots|decisions|node_modules)([\\/]|$)/.test(p),
});
// 写しは木の外に在るので node_modules の解決が上へ辿っても届かない。繋ぎを一つ張る。
// **基準線が別の理由で赤くなると、結果を読み違える**(test-mutation.mjs の教訓)。
try { symlinkSync(join(src, "..", "..", "node_modules"), join(work, "node_modules"), "dir"); } catch { /* 既に在る */ }

const cloneModel = JSON.parse(readFileSync(join(copy, "gold-model", CLONE_FROM.file), "utf8"));
writeFileSync(
  join(copy, "gold-model", PROBE_FILE),
  JSON.stringify({ ...cloneModel, target: PROBE_ID }, null, 2) + "\n",
  "utf8",
);

const registryPath = join(copy, "gold-model", "registry.json");
const registrySrc = readFileSync(registryPath, "utf8");

/** 写しの registry へ合成の対象を差す。`at` は "first" か "last"。 */
function placeProbe(at, roles) {
  const r = JSON.parse(registrySrc);
  const entry = { file: PROBE_FILE, roles: [...roles] };
  r.targets = at === "first" ? [entry, ...r.targets] : [...r.targets, entry];
  writeFileSync(registryPath, JSON.stringify(r, null, 2) + "\n", "utf8");
}

/** 写しの spec.mjs が何を見ているかを、別プロセスで読む(取り込みの記憶に引きずられない)。 */
function specSees() {
  const specUrl = pathToFileURL(join(copy, "gold-model", "spec.mjs")).href;
  const code = `
    const s = await import(${JSON.stringify(specUrl)});
    const roles = Object.keys(s.REGISTRY.roles ?? {});
    const byRole = {};
    for (const r of roles) byRole[r] = s.targetIds(r);
    const gateArgs = {};
    for (const g of s.GATES) gateArgs[g.id] = g.args;
    console.log(JSON.stringify({ roles, byRole, gateArgs, all: s.TARGETS.map((t) => t.id) }));
  `;
  const res = run(process.execPath, ["--input-type=module", "-e", code], copy);
  if (res.code !== 0) throw new Error(`写しの spec.mjs を読めない — ${brief(res.stderr, 300)}`);
  return JSON.parse(res.stdout);
}

// ------------------------------------------------- 列挙の場所(先頭と末尾の両方で)

const ALL_ROLES = Object.keys(REGISTRY.roles ?? {});

for (const at of ["first", "last"]) {
  placeProbe(at, ALL_ROLES);
  const pos = at === "first" ? "先頭" : "末尾";
  const outDir = join(work, `out-${at}`);
  mkdirSync(outDir, { recursive: true });
  const indexPath = join(outDir, "index.html");
  const reportPath = join(outDir, "build.json");

  let sees = null;
  check(wired, `${pos}: 写しの正本が合成の対象を読み込む`, () => {
    sees = specSees();
    return sees.all.includes(PROBE_ID) ? null : `TARGETS に ${PROBE_ID} が無い`;
  });

  check(wired, `${pos}: 役割で絞った一覧が全ての役割で拾う`, () => {
    if (!sees) return "正本を読めていないので検められない";
    const missing = ALL_ROLES.filter((r) => !sees.byRole[r].includes(PROBE_ID));
    return missing.length ? `役割 ${missing.join(", ")} が拾っていない` : null;
  });

  check(wired, `${pos}: 段の引数(args_from)が合成の模型を渡す`, () => {
    if (!sees) return "正本を読めていないので検められない";
    const carrying = Object.entries(sees.gateArgs).filter(([, args]) => args.includes(PROBE_FILE));
    return carrying.length ? null : `どの段の引数にも ${PROBE_FILE} が現れない`;
  });

  const built = run(process.execPath, [join(copy, "prototype", "build.mjs"), "--out", indexPath, "--report", reportPath, ...TODAY], join(copy, "prototype"));
  check(wired, `${pos}: 合成の対象を含んだまま build が通る`, () =>
    built.code === 0 ? null : `終了コード ${built.code} — ${brief(built.stderr || built.stdout, 300)}`);

  const html = built.code === 0 ? readFileSync(indexPath, "utf8") : "";

  check(wired, `${pos}: 生成物が対象を id で名指す`, () => {
    if (!html) return "生成物が無いので検められない";
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    if (!values.length) return "生成物に <option> が一つも無い(対象の一覧が実行時にしか存在しない)";
    const numeric = values.filter((v) => /^\d+$/.test(v));
    if (numeric.length) return `<option> の値が添字である: ${numeric.join(", ")}`;
    return values.includes(PROBE_ID) ? null : `<option> の値に ${PROBE_ID} が無い(在るのは ${values.join(", ")})`;
  });

  check(wired, `${pos}: 生成物の模型に合成の対象が載る`, () =>
    html.includes(JSON.stringify(PROBE_ID).slice(1, -1)) ? null : "生成物のどこにも合成の対象が現れない");

  check(wired, `${pos}: 到達の表が合成の対象の行を持つ`, () => {
    if (!html) return "生成物が無いので検められない";
    const m = /const M14 = (\{.*?\});\n/s.exec(html);
    if (!m) return "生成物から M14 を読めない";
    const rows = JSON.parse(m[1]).rows ?? [];
    return rows.some((r) => r.target === PROBE_ID) ? null : "到達の表に合成の対象の行が無い";
  });

  check(wired, `${pos}: build の判定の記録が合成の対象を名指す`, () => {
    if (built.code !== 0) return "build が通っていないので検められない";
    const rec = JSON.parse(readFileSync(reportPath, "utf8")).records ?? [];
    return rec.some((r) => r.checker === "build:reachability" && r.target === PROBE_ID)
      ? null : "判定の記録に合成の対象が無い";
  });

  check(wired, `${pos}: overlay の生成計画が合成の対象を挙げる`, () => {
    // --doctrine を明示すると固定の解決を飛ばせる(通信も python も要らない)。
    const plan = run(process.execPath, [join(copy, "overlay", "build-overlay.mjs"), "--print-plan", "--doctrine", copy], join(copy, "overlay"));
    if (plan.code !== 0) return `--print-plan が通らない(終了コード ${plan.code}) — ${brief(plan.stderr)}`;
    let p;
    try { p = JSON.parse(plan.stdout); } catch { return `計画が JSON でない: ${brief(plan.stdout)}`; }
    if (!Array.isArray(p.targets)) return "計画が targets を挙げていない(何を測るつもりかを言っていない)";
    return p.targets.includes(PROBE_ID) ? null : `計画の targets に ${PROBE_ID} が無い`;
  });

  check(wired, `${pos}: 撮影の計画が合成の対象を含む`, () => {
    const plan = run(process.execPath, [join(copy, "prototype", "shoot.mjs"), "--print-plan"], join(copy, "prototype"));
    if (plan.code !== 0) return `--print-plan が通らない(終了コード ${plan.code}) — ${brief(plan.stderr || plan.stdout)}`;
    let p;
    try { p = JSON.parse(plan.stdout); } catch { return `計画が JSON でない: ${brief(plan.stdout)}`; }
    const mine = (p.shots ?? []).filter((s) => s.target === PROBE_ID);
    if (!mine.length) return `撮影の計画に ${PROBE_ID} の枚が無い`;
    return mine.every((s) => typeof s.file === "string" && s.file.endsWith(".png")) ? null : "撮影の計画の file が png でない";
  });
}

// ------------------------------------------------------ 実物の registry の被覆規則

check(wired, "実測の候補を持つ対象は overlay の役割を持つ", () => {
  const missing = [];
  for (const t of TARGETS) {
    const model = JSON.parse(readFileSync(t.path, "utf8"));
    const n = (model.anchors ?? []).filter((a) => a.authority === "doctrine" && a.target_kind === "code_range").length;
    if (n > 0 && !t.roles.includes("overlay")) missing.push(`${t.id}(候補 ${n} 件)`);
  }
  return missing.length ? `候補が在るのに overlay の役割が無い: ${missing.join(", ")}` : null;
});

check(wired, "掃引する役割は画面に載る役割の部分集合である", () => {
  const build = new Set(targetIds("build"));
  const out = [];
  for (const r of ["gates", "labels", "overlay"]) {
    for (const t of targetsWithRole(r)) if (!build.has(t.id)) out.push(`${t.id} が役割 ${r} を持つが build に無い`);
  }
  return out.length ? out.join(" / ") : null;
});

// ------------------------------------------------------------ overlay の索き方

const ovWork = join(work, "ov-cases");
mkdirSync(ovWork, { recursive: true });
const REAL_TARGET = targetIds("build")[0];
const sound = (over = {}) => ({
  schema: "system-map/overlay/0.1",
  target: REAL_TARGET,
  status: "measured",
  source: "合成の入力(この段が作った物であり、測定ではない)",
  source_limits: "合成の入力なので、何も測っていない。",
  doctrine: { root_basename: null },
  generated_from_rev: "0".repeat(40),
  generated_at: "2026-01-01",
  generated_at_source: null,
  worktree: { dirty: false, shallow: false },
  entries: [{
    anchor_id: "a-synthetic", status: "measured", repo: "doctrine-lens", path: "src/x.ts",
    raw_target: "doctrine-lens: src/x.ts", reason: null,
    recorded_rev: "0".repeat(40), current_rev: "0".repeat(40), rev_state: "same",
    ranges_now: [{ id: "SPEC-000", begin_line: 1, end_line: 2, fingerprint: "sha256:" + "0".repeat(64) }],
  }],
  ...over,
});

/** 一件の入力例を build へ食わせる。`files` は <名前, 中身> の並び。 */
function feed(caseId, files, extraArgs = []) {
  const dir = join(ovWork, caseId);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of files) writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
  const out = join(ovWork, `${caseId}.html`);
  const args = [join(here, "build.mjs"), "--overlay-dir", dir, ...extraArgs, ...TODAY];
  if (!extraArgs.includes("--no-out")) args.splice(1, 0, "--out", out);
  const res = run(process.execPath, args.filter((a) => a !== "--no-out"), here);
  return { ...res, html: res.code === 0 ? readFileSync(out, "utf8") : "" };
}

/** 硬い失敗を期待する。**「飛ばして続行」を合格にしない。** */
const mustReject = (caseId, label, files, code) => check(indexing, label, () => {
  const r = feed(caseId, files);
  if (r.code === 0) return "終了コード 0 で通した(壊れた入力を黙って受け入れている)";
  const said = (r.stderr + r.stdout).includes(code);
  return said ? null : `終了コード ${r.code} だが理由が ${code} と名指されていない — ${brief(r.stderr || r.stdout)}`;
});

check(indexing, "生成側の命名に依らず、宣言した対象で索く", () => {
  const second = targetIds("build")[1];
  const r = feed("neutral", [["a.json", sound()], ["zz.json", sound({ target: second })]]);
  if (r.code !== 0) return `中立な名前の overlay を読めない(終了コード ${r.code}) — ${brief(r.stderr || r.stdout)}`;
  const m = /const OVERLAYS? = (.*?);\n/s.exec(r.html);
  if (!m) return "生成物から overlay を読めない";
  const body = m[1];
  return body.includes(REAL_TARGET) && body.includes(second) ? null : "二つの対象のうち片方しか索かれていない";
});

mustReject("corrupt", "壊れた JSON を硬く落とす", [["a.json", "{ これは JSON ではない"]], "overlay-corrupt");
mustReject("schema", "未知の形を硬く落とす", [["a.json", sound({ schema: "system-map/overlay/99" })]], "overlay-schema-unknown");
mustReject("unknown-target", "未知の対象を硬く落とす", [["a.json", sound({ target: "存在しない対象(合成)" })]], "overlay-unknown-target");
mustReject("duplicate", "同じ対象を名乗る二つを硬く落とす", [["a.json", sound()], ["zz.json", sound()]], "overlay-duplicate-target");
mustReject("vacuous", "空の実測を硬く落とす", [["a.json", sound({ entries: [] })]], "overlay-vacuous");
mustReject("mislabeled", "測る対象が無いのに実測を名乗る記録を落とす", [["a.json", sound({ status: "no-candidates" })]], "overlay-vacuous");

check(indexing, "指した置き場が無いことを黙って無視しない", () => {
  const missing = join(ovWork, "この置き場は無い");
  const r = run(process.execPath, [join(here, "build.mjs"), "--out", join(ovWork, "missing.html"), "--overlay-dir", missing, ...TODAY], here);
  if (r.code === 0) return "終了コード 0 で通した(overlay を指したのに読まずに成功している)";
  return (r.stderr + r.stdout).includes("overlay-dir-missing") ? null : `終了コード ${r.code} だが理由が overlay-dir-missing と名指されていない`;
});

check(indexing, "overlay 付きの build が出荷物を書き換えない", () => {
  const r = run(process.execPath, [join(here, "build.mjs"), "--overlay-dir", join(ovWork, "neutral"), ...TODAY], here);
  if (r.code === 0) return "出荷物の置き場へ overlay 付きで書けてしまう(Phase 1 の成果物が Phase 2 のデータで上書きされる)";
  // **落ちたことを合格にしない。** 別の理由(読めない・壊れている)で落ちているなら、
  // 守りが在る証拠にならない。理由を名指していることまで見る。
  return (r.stderr + r.stdout).includes("overlay-would-overwrite-shipped")
    ? null
    : `終了コード ${r.code} だが、出荷物を守って落ちたのか別の理由で落ちたのか判らない`;
});

check(indexing, "測る対象が 0 件の対象を、実測と区別して出す", () => {
  const r = feed("no-candidates", [["a.json", sound({ status: "no-candidates", entries: [] })]]);
  if (r.code !== 0) return `正しい形の no-candidates を読めない(終了コード ${r.code}) — ${brief(r.stderr || r.stdout)}`;
  return /測る対象/.test(r.html) ? null : "生成物が「測る対象が無い」ことを言っていない(空文字列と同じ扱い)";
});

check(indexing, "生成側が空の実測を書かない", () => {
  // 写しの registry で、候補 0 件の対象にだけ overlay の役割を持たせる。
  // --doctrine を存在しない先にすると、候補 0 件の対象は CLI を一度も呼ばずに済む。
  const r = JSON.parse(registrySrc);
  const zero = [];
  for (const t of r.targets) {
    const model = JSON.parse(readFileSync(join(copy, "gold-model", t.file), "utf8"));
    const n = (model.anchors ?? []).filter((a) => a.authority === "doctrine" && a.target_kind === "code_range").length;
    t.roles = t.roles.filter((x) => x !== "overlay");
    if (n === 0) zero.push(t);
  }
  if (!zero.length) return "候補 0 件の対象が無いので検められない";
  zero[0].roles = [...zero[0].roles, "overlay"];
  writeFileSync(registryPath, JSON.stringify(r, null, 2) + "\n", "utf8");

  const outDir = join(work, "ov-produced");
  const res = run(process.execPath, [join(copy, "overlay", "build-overlay.mjs"), "--doctrine", join(work, "この先は無い"), "--out-dir", outDir, "--allow-dirty"], join(copy, "overlay"));
  if (res.code !== 0) return `生成が通らない(終了コード ${res.code}) — ${brief(res.stderr || res.stdout)}`;
  const bad = [];
  for (const name of readdirSync(outDir)) {
    const o = JSON.parse(readFileSync(join(outDir, name), "utf8"));
    if ((o.entries ?? []).length === 0 && o.status !== "no-candidates") bad.push(`${name} が状態 ${o.status} で記録 0 件`);
  }
  return bad.length ? `空の実測を書いている: ${bad.join(", ")}` : null;
});

// ------------------------------------------------------------------------ 判定

rmSync(work, { recursive: true, force: true });

const records = [
  verdict({
    invariant: "M-W1", checker: "meta:targets-wired", target: "research/system-map",
    examined: wired.length, examined_unit: "列挙の場所",
    violations: wired.map((x) => x.violation).filter(Boolean),
  }),
  verdict({
    invariant: "M-W2", checker: "meta:overlay-indexing", target: "research/system-map",
    examined: indexing.length, examined_unit: "overlay の入力例",
    violations: indexing.map((x) => x.violation).filter(Boolean),
  }),
];

const failed = [...wired, ...indexing].filter((x) => x.violation).length;
console.log(failed === 0
  ? `\n全件通過(列挙の場所 ${wired.length} 箇所・overlay の入力例 ${indexing.length} 件)`
  : `\n${failed} 件の所見(列挙の場所 ${wired.length} 箇所・overlay の入力例 ${indexing.length} 件)`);

// **失敗の経路でも記録を書く。** 書かないと verify.mjs は「判定を一つも出さずに
// 終わった段」として読み、理由を失う(meta.checker_silent)。
const reportPath = reportPathFrom(process.argv.slice(2));
if (reportPath) writeReport(reportPath, "targets-wired", records);
process.exit(gateExitCode(records, today.date));
