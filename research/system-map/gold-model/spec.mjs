// M 層の正本から導く唯一の口。**ここは事実を一つも持たない。**
//
// 形と語彙は schema.json、政策と対象の一覧と段の一覧は registry.json が正本である。
// このファイルがするのは、その二つから読み出し、突き合わせ、凍らせて配ることだけである。
//
// なぜ要るか: 同じ事実が六箇所以上に手書きされていた(test-single-source.mjs が数える)。
// 増やすときに一箇所を忘れても落ちないものが在り、静止画は別の対象を撮り、掃引は別の
// 対象を掃いていた。落ちないので気付けない。
//
// 突き合わせは読み込みの時点で行い、食い違えば **例外で止まる**。黙って既定へ寄せない。
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const die = (msg) => {
  throw new Error(`M 層の正本が食い違っている: ${msg}`);
};

const readJson = (p) => {
  if (!existsSync(p)) die(`${p} が無い`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    die(`${p} を読めない — ${e.message}`);
  }
};

export const SCHEMA = Object.freeze(readJson(join(here, "schema.json")));
export const REGISTRY = Object.freeze(readJson(join(here, "registry.json")));

if (REGISTRY.schema !== "system-map/registry/1") die(`registry.json の schema が想定外: ${REGISTRY.schema}`);

// ---- 語彙(schema.json から導く。ここに綴りを置かない) ----
const def = (name) => SCHEMA.$defs?.[name] ?? die(`schema.json に $defs.${name} が無い`);
const enumOf = (name, path) => {
  let node = def(name);
  for (const k of path) node = node?.[k];
  const v = node?.enum ?? node;
  if (!Array.isArray(v) || v.length === 0) die(`schema.json の ${name}.${path.join(".")} が列挙でない`);
  return Object.freeze([...v]);
};

/** 保証の七状態。契約の verification_status。 */
export const STATES = enumOf("VerificationStatus", []);
/** proposed / confirmed。AI の推定値は proposed に留まる。 */
export const REVIEW_STATUSES = enumOf("ReviewStatus", []);
/** 証跡の最小形。空でないことは schema 側が言う。 */
export const EVIDENCE_KEYS = Object.freeze([...(def("Evidence").required ?? die("Evidence.required が無い"))]);
/** 鮮度判定の権威。ちょうど一つであること(M-10)。 */
export const AUTHORITIES = enumOf("TraceAnchor", ["properties", "authority"]);
/** アンカーの種別の全体集合。 */
export const TARGET_KINDS = enumOf("TraceAnchor", ["properties", "target_kind"]);
/** 要素の種別の全体集合。境界の内外はこれから導く(直書きしない)。 */
export const ELEMENT_KINDS = enumOf("SystemElement", ["properties", "kind"]);
/** 出所の判定。present / silent。 */
export const SOURCE_VERDICTS = enumOf("Source", ["properties", "verdict"]);
/** 模型の schema 値。 */
export const MODEL_SCHEMA_ID = SCHEMA.properties?.schema?.const ?? die("schema.json に properties.schema.const が無い");

// ---- 政策(registry.json から導く) ----
const pol = (k) => REGISTRY.policy?.[k] ?? die(`registry.json に policy.${k} が無い`);

/** 要素からコードまたは証拠への到達に許す操作数(台帳 v3.2-16)。 */
export const MAX_OPS = pol("max_ops").value;
/** 実現先として数えるアンカーの種別(ADR-031 決定4)。 */
export const REALIZATION_KINDS = Object.freeze([...pol("realization_accepted_kinds").value]);
/** 実 UI の操作構造。index.html の画面遷移と一致させる。 */
export const UI_STRUCTURE = Object.freeze({
  drillOps: pol("ui_structure").drillOps,
  selectOps: pol("ui_structure").selectOps,
  extraExpands: pol("ui_structure").extraExpands,
  linkClickOps: pol("ui_structure").linkClickOps,
});
/** 保証画面の並び順(重い順)。語彙そのものは STATES が正本。 */
export const STATUS_DISPLAY_ORDER = Object.freeze([...pol("status_display_order").value]);
/** 実測 overlay の形の名。読み側はこれ以外を硬く落とす。 */
export const OVERLAY_SCHEMA_ID = pol("overlay_schema").value;
/** overlay 一件(対象ごと)の総括の状態。 */
export const OVERLAY_STATUSES = Object.freeze([...pol("overlay_statuses").value]);
/** 「測る対象が一つも無かった」を表す状態。記録 0 件と一対一で対応する。 */
export const OVERLAY_EMPTY_STATUS = pol("overlay_statuses").empty_status;
/** 実測の候補にするアンカーの条件。使うのは lib/overlay-candidates.mjs だけ。 */
export const OVERLAY_CANDIDATE = Object.freeze({
  authority: pol("overlay_candidate").authority,
  target_kind: pol("overlay_candidate").target_kind,
});
/**
 * 画面が使う語。**語彙そのものはここに無い** —— schema.json と生成器が正本であり、
 * これは対応表である。覆えない語が出たときに黙って既知の語へ寄せないための表でもある。
 */
export const DISPLAY = Object.freeze(pol("display"));

// ---- 突き合わせ(読み込みの時点で止める) ----
if (typeof MAX_OPS !== "number" || !Number.isInteger(MAX_OPS) || MAX_OPS < 1) {
  die(`policy.max_ops.value が正の整数でない: ${MAX_OPS}`);
}
for (const k of REALIZATION_KINDS) {
  if (!TARGET_KINDS.includes(k)) die(`実現先の種別 ${k} が schema.json の target_kind に無い`);
}
if (REALIZATION_KINDS.length >= TARGET_KINDS.length) {
  die("実現先の種別が target_kind の全体と同じ。真部分集合であること(全部を実現先と呼ぶなら M-14 は何も言っていない)");
}
{
  const a = [...STATUS_DISPLAY_ORDER].sort();
  const b = [...STATES].sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    die(`policy.status_display_order が七状態の並べ替えでない:\n  表示順 ${JSON.stringify(STATUS_DISPLAY_ORDER)}\n  七状態 ${JSON.stringify(STATES)}`);
  }
}
for (const k of ["drillOps", "selectOps", "extraExpands", "linkClickOps"]) {
  if (typeof UI_STRUCTURE[k] !== "number") die(`policy.ui_structure.${k} が数でない`);
}
// 「測る対象が無い」を表す状態が語彙の外に在ると、生成側が書いた物を読み側が
// 知らない語として落とす。**同じ表から採ることを、読み込みの時点で確かめる。**
if (!OVERLAY_STATUSES.includes(OVERLAY_EMPTY_STATUS)) {
  die(`policy.overlay_statuses.empty_status が語彙に無い: ${OVERLAY_EMPTY_STATUS}`);
}
// 候補の条件は schema.json の語彙から採る。綴りが外れると、条件が誰にも当たらず
// 「候補 0 件」が静かに全対象へ広がる —— 被覆の穴は落ちない形で開く。
if (!AUTHORITIES.includes(OVERLAY_CANDIDATE.authority)) {
  die(`policy.overlay_candidate.authority が schema.json の authority に無い: ${OVERLAY_CANDIDATE.authority}`);
}
if (!TARGET_KINDS.includes(OVERLAY_CANDIDATE.target_kind)) {
  die(`policy.overlay_candidate.target_kind が schema.json の target_kind に無い: ${OVERLAY_CANDIDATE.target_kind}`);
}
// ---- 表示の語が、語彙を過不足なく覆っているか(読み込みの時点で止める) ----
// 覆えていない語は、画面で黙って別の語になる。実際 rev_state は三値なのに画面の分岐が
// 二値で、`unknown`(記録した rev が履歴に無い)が「記録時 rev と同一」として出ていた。
// **足りないのも余っているのも同じ罪である** —— 余りは死んだ語が溜まった印であり、
// どちらも「表と語彙が別々に動いている」ことを言っている。
{
  const bijective = (what, keys, vocab) => {
    const a = [...keys].filter((k) => !k.startsWith("$")).sort();
    const b = [...vocab].sort();
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      die(`表示の語 ${what} が語彙の全単射でない:\n  表示 ${JSON.stringify(a)}\n  語彙 ${JSON.stringify(b)}`);
    }
  };
  bijective("display.verification_status", Object.keys(DISPLAY.verification_status ?? {}), STATES);
  bijective("display.review_status", Object.keys(DISPLAY.review_status ?? {}), REVIEW_STATUSES);
  bijective("display.element_kind", Object.keys(DISPLAY.element_kind ?? {}), ELEMENT_KINDS);
  bijective("display.anchor_kind", Object.keys(DISPLAY.anchor_kind ?? {}), TARGET_KINDS);
  // 「実測」と言ってよいのはどれか。表が二つ以上を実測と呼び始めたら、画面の言葉が
  // 生成器より緩くなる。数だけは正本の側で固定しておく。
  const spendMeasured = Object.entries(DISPLAY.overlay_status_entry ?? {})
    .filter(([k, v]) => !k.startsWith("$") && v.counts_as_measured === true).map(([k]) => k);
  if (spendMeasured.length !== 2) {
    die(`「実測」と名乗れる状態がちょうど二つでない: ${JSON.stringify(spendMeasured)}`);
  }
  if (!DISPLAY.unknown_token?.mark) die("policy.display.unknown_token が無い(未知の語の落とし所が無い)");
}

// ---- 対象(registry.json が並びを持ち、id は模型自身が持つ) ----
const rawTargets = REGISTRY.targets;
if (!Array.isArray(rawTargets) || rawTargets.length === 0) die("registry.json に targets が無い");

const KNOWN_ROLES = Object.keys(REGISTRY.roles ?? {});
if (KNOWN_ROLES.length === 0) die("registry.json に roles の説明が無い");

const loaded = rawTargets.map((t, i) => {
  if (!t.file) die(`targets[${i}] に file が無い`);
  const path = join(here, t.file);
  const model = readJson(path);
  if (model.schema !== MODEL_SCHEMA_ID) {
    die(`${t.file} の schema が ${MODEL_SCHEMA_ID} でない: ${model.schema}`);
  }
  if (!model.target) die(`${t.file} に target が無い`);
  const roles = t.roles ?? [];
  for (const r of roles) if (!KNOWN_ROLES.includes(r)) die(`${t.file} の役割 ${r} が registry.roles に無い`);
  return { id: model.target, file: t.file, path, roles: Object.freeze([...roles]), fictional: t.fictional === true, model };
});

{
  const ids = loaded.map((t) => t.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) die(`対象の id が重複している: ${[...new Set(dup)].join(", ")}`);
  for (const r of KNOWN_ROLES) {
    if (!loaded.some((t) => t.roles.includes(r))) die(`役割 ${r} を持つ対象が一つも無い(死んだ役割)`);
  }
}

/** 並びは registry.json の targets の順。build の並びと画面の並びが一致する。 */
export const TARGETS = Object.freeze(loaded.map((t) => Object.freeze({ id: t.id, file: t.file, path: t.path, roles: t.roles, fictional: t.fictional })));

/** 役割で絞った対象。役割を渡さなければ全部。 */
export function targetsWithRole(role) {
  if (role === undefined) return TARGETS;
  if (!KNOWN_ROLES.includes(role)) die(`未知の役割: ${role}`);
  return TARGETS.filter((t) => t.roles.includes(role));
}

/** 役割で絞ったファイル名。validate.mjs へ渡す引数など。 */
export const targetFiles = (role) => targetsWithRole(role).map((t) => t.file);

/** 役割で絞った id。 */
export const targetIds = (role) => targetsWithRole(role).map((t) => t.id);

/** 役割で絞った模型(読み直す。呼び手が壊しても他へ波及させない)。 */
export const loadModels = (role) => targetsWithRole(role).map((t) => readJson(t.path));

// 画面が対象を指す値は **id そのもの**である。翻訳する口は置かない。
//
// 以前はここに、id を受けて build の並びの添字を返す口が在った。呼ぶ側は
// 既に全て id を渡していたのに、返す値だけが位置だった —— 並べ替えれば静止画が
// 別の対象を撮り、掃引は別の対象を掃く。どちらも落ちないので気付けない。
//
// 翻訳をやめたので、呼ぶ側は模型から採った id をそのまま渡す。字面を書く場所が
// 無くなったので、「知らない id を弾く」守りも要らなくなった(渡す物が正本から
// 来る以上、古くなりようがない)。

/** verify.mjs が回す段。args_from は対象の一覧から解く。 */
export const GATES = Object.freeze(
  (REGISTRY.gates ?? die("registry.json に gates が無い")).map((g) => {
    const args = [...(g.cmd ?? []).slice(1)];
    if (g.args_from) {
      const m = /^targets:(\w+)$/.exec(g.args_from);
      if (!m) die(`gates[${g.id}].args_from の形が想定外: ${g.args_from}`);
      args.push(...targetFiles(m[1]));
    }
    if (!g.cwd || !["gold-model", "prototype", "overlay"].includes(g.cwd)) die(`gates[${g.id}].cwd が想定外: ${g.cwd}`);
    // 段ごとの時間切れ。無いと、ぶら下がった段で走行は落ちずに**止まる**
    // (止まった走行は、遅い走行と見分けがつかない)。
    const timeoutMs = g.timeout_ms ?? 600000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) die(`gates[${g.id}].timeout_ms が 1000 以上の整数でない: ${g.timeout_ms}`);
    return Object.freeze({ id: g.id, label: g.label, bin: g.cmd[0], args: Object.freeze(args), cwd: join(here, "..", g.cwd), timeoutMs });
  }),
);
