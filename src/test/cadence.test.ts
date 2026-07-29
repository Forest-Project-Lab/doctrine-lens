// SPEC-001 受入基準 10 と、その周辺の不変条件。
//
// 「受入基準の表に行を足したが、対応する試験が一つも無い」を埋める。
// 数だけ合わせて中身が無い試験を書かないため、ここで確かめるのは
// 「速い拍と遅い拍が実際に別のものを取りに行くか」「束ねが要求の同一性で
// 判じられているか」という、実装の振る舞いそのものである。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { canAudit } from "../doctrine/audit.js";
import type { RunOptions } from "../doctrine/cli.js";
import { GraphStore } from "../doctrine/graph.js";
import { locateDocsRoot, locatePluginRoot } from "../doctrine/locate.js";
import { carryAudit } from "../model/cadence.js";

const PROJECT = resolve(__dirname, "..", "..");
const options: RunOptions = { pythonPath: "python3", timeoutMs: 60000, cwd: PROJECT };
const plugin = (): string | null => locatePluginRoot(PROJECT);

test("001-10a. 速い拍は監査を走らせず、遅い拍は走らせる", async (t) => {
  const pluginRoot = plugin();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const store = new GraphStore();
  const fast = await store.refresh(PROJECT, docsRoot, pluginRoot, options, false);
  assert.ok(fast.snapshot, "速い拍でも地図は取れる");
  assert.ok(fast.snapshot.ranges, "速い拍でも範囲は取る");
  assert.equal(fast.snapshot.findings, null, "速い拍では判定を取りに行かない");

  const slow = await store.refresh(PROJECT, docsRoot, pluginRoot, options, true);
  assert.ok(slow.snapshot?.findings, "遅い拍では判定を取る");
});

test("001-10b. 監査つきの要求が監査抜きの取得に相乗りしない", async (t) => {
  const pluginRoot = plugin();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  // 二つを同時に投げる。束ねが「何かが走っている」だけで判じていると、
  // 監査つきの側が監査抜きの結果を受け取り、判定が黙って飛ぶ。
  const store = new GraphStore();
  const [withoutAudit, withAudit] = await Promise.all([
    store.refresh(PROJECT, docsRoot, pluginRoot, options, false),
    store.refresh(PROJECT, docsRoot, pluginRoot, options, true),
  ]);
  assert.equal(withoutAudit.snapshot?.findings, null, "監査抜きは判定を持たない");
  assert.ok(withAudit.snapshot?.findings, "監査つきは判定を持つ（相乗りしていない）");
});

test("001-10c. 統治木が違う要求どうしも相乗りしない", async (t) => {
  const pluginRoot = plugin();
  if (!pluginRoot) return t.skip("doctrine プラグインが無い");
  const docsRoot = locateDocsRoot(PROJECT);
  assert.ok(docsRoot);

  const store = new GraphStore();
  const [good, bad] = await Promise.all([
    store.refresh(PROJECT, docsRoot, pluginRoot, options, false),
    store.refresh(PROJECT, join(PROJECT, "存在しない木"), pluginRoot, options, false),
  ]);
  assert.ok(good.snapshot, "在る木の取得は成功する");
  assert.ok(bad.failure, "無い木の取得は失敗する（別の木の結果を返さない）");
});

test("001-10d. 統治木が根直下でなければ判定を取りに行かない", () => {
  // 上流の監査は作業フォルダの直下から木を探す。下位の木を指すと、
  // 別の木を監査するか、JSON でない出力を吐いて終わる。どちらも黙って誤る。
  assert.equal(canAudit("/w", "/w/doctrine_docs"), true);
  assert.equal(canAudit("/w", "/w/sub/doctrine_docs"), false, "下位の木では取りに行かない");
  assert.equal(canAudit("/w", "/other/doctrine_docs"), false);
  assert.equal(canAudit("/w/", "/w/doctrine_docs"), true, "末尾の区切りに依らない");
});

test("子プロセスの作業フォルダに、利用者の作業フォルダを渡さない", () => {
  // Windows は実行体名に区切りが無いとき PATH より先に cwd を見る。
  // cwd に作業フォルダを渡すと、そこに置かれた python3.exe が先に走る。
  const source = readFileSync(join(PROJECT, "src", "doctrine", "cli.ts"), "utf8");
  assert.ok(
    /cwd:\s*safeCwd\(\)/.test(source),
    "execFile の cwd が safeCwd() でない（作業フォルダを渡している疑い）",
  );
  assert.ok(
    !/cwd:\s*options\.cwd/.test(source),
    "options.cwd を子プロセスへ渡している",
  );
});

// --- 受入基準 10 — 速い拍で判定と時刻が保たれる -------------------------
//
// 引き継ぎの規則は src/model/cadence.ts に一つだけ置いてある。session は
// それを呼ぶだけである（session そのものは編集器を要するので、ここでは
// 規則を直に確かめる）。

const AT = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-01-02T00:00:00.000Z");
const HELD = { auditAt: AT, staleIds: new Set(["SPEC-001"]) };

test("001-10. 速い拍では前回の判定と時刻がそのまま保たれる", () => {
  const next = carryAudit(
    HELD,
    { withAudit: false, failed: false, staleIds: null },
    () => LATER,
  );
  assert.equal(next.auditAt, AT, "時刻が進まない");
  assert.deepEqual([...next.staleIds], ["SPEC-001"], "食い違いの数が 0 へ落ちない");
});

test("001-10b. 監査を求めた回に判定が返れば、判定も時刻も入れ替わる", () => {
  const next = carryAudit(
    HELD,
    { withAudit: true, failed: false, staleIds: new Set(["SPEC-002"]) },
    () => LATER,
  );
  assert.equal(next.auditAt, LATER);
  assert.deepEqual([...next.staleIds], ["SPEC-002"]);
});

test("001-10c. 判定が空で返るのと、取れないのは別である", () => {
  const cleared = carryAudit(
    HELD,
    { withAudit: true, failed: false, staleIds: new Set() },
    () => LATER,
  );
  assert.deepEqual([...cleared.staleIds], [], "食い違いが消えたなら消える");
  assert.equal(cleared.auditAt, LATER);
});

test("001-10e. 取得が失敗した回は時刻を進めない", () => {
  // 失敗した回は直前に成功した結果がそのまま返る。findings が在ることだけを
  // 見ていると、古い判定に「いま」の時刻が付き、帯が嘘をつく。
  const next = carryAudit(
    HELD,
    { withAudit: true, failed: true, staleIds: new Set(["SPEC-009"]) },
    () => LATER,
  );
  assert.equal(next.auditAt, AT, "失敗した回に時刻を進めない");
  assert.deepEqual([...next.staleIds], ["SPEC-001"], "前回の判定を保つ");
});

test("001-10g. 監査を求めていない回は、判定が返っていても引き継がない", () => {
  // withAudit を見ずに「判定が返ったか」だけで決めると、速い拍の結果を
  // 遅い拍の判定として採ってしまう。速い拍は監査を走らせていないので、
  // そこに載っている判定は前回の使い回しである。
  const next = carryAudit(
    HELD,
    { withAudit: false, failed: false, staleIds: new Set(["SPEC-777"]) },
    () => LATER,
  );
  assert.equal(next.auditAt, AT, "時刻を進めてはならない");
  assert.deepEqual([...next.staleIds], ["SPEC-001"], "前回の判定を保つ");
});

test("001-10f. session が引き継ぎを自前で書き直していない", () => {
  // 規則を二箇所に持つと必ず食い違う。session は carryAudit を呼ぶだけにする。
  const source = readFileSync(join(PROJECT, "src", "session.ts"), "utf8");
  assert.ok(/carryAudit\(/.test(source), "session が carryAudit を呼んでいない");
  assert.ok(
    !/auditAt\s*=\s*.*new Date\(\)/.test(source),
    "session が時刻を自前で進めている",
  );
});
