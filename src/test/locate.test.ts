// プラグイン実体と監査の出所の解決（SPEC-001・SPEC-004）。
//
// ここは「取り違えたときに黙って誤る」場所である。誤った実体を走らせても、
// 誤った木の判定を出しても、画面には何も出ない。字面ではなく実際の
// ディレクトリと、実際に走る偽の CLI で確かめる。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canAudit, fetchTraceFindings } from "../doctrine/audit.js";
import { clampTimeout, resolvePython, runJson, type RunOptions } from "../doctrine/cli.js";
import { locatePluginRoot } from "../doctrine/locate.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "doctrine-lens-locate-"));
}

/** 台帳と実体を持つ偽の設定ディレクトリを作る。 */
function withLedger(configDir: string, installPath: string): void {
  const pluginsDir = join(configDir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(join(installPath, "scripts"), { recursive: true });
  writeFileSync(join(installPath, "scripts", "docs-audit.py"), "", "utf8");
  writeFileSync(
    join(pluginsDir, "installed_plugins.json"),
    JSON.stringify({ plugins: { "doctrine@forest-project-lab": [{ installPath }] } }),
    "utf8",
  );
}

test("台帳が指す実体に廃版の印が付いていたら選ばない", () => {
  const dir = scratch();
  try {
    const install = join(dir, "plugin");
    withLedger(dir, install);
    assert.equal(locatePluginRoot("/w", "", dir), install, "印が無ければ選ぶ");

    // 版を上げても台帳の古い項が残ることがある。印が付いた実体を走らせない。
    writeFileSync(join(install, ".orphaned_at"), "2026-01-01", "utf8");
    assert.equal(
      locatePluginRoot("/w", "", dir),
      null,
      "廃版の印が付いた実体を選んでいる",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("キャッシュの版も、廃版の印が付いていれば飛ばす", () => {
  const dir = scratch();
  try {
    const base = join(dir, "plugins", "cache", "forest-project-lab", "doctrine");
    for (const version of ["0.9.0", "0.10.0"]) {
      mkdirSync(join(base, version, "scripts"), { recursive: true });
    }
    assert.equal(
      locatePluginRoot("/w", "", dir),
      join(base, "0.10.0"),
      "版番号は数値で比べる",
    );
    writeFileSync(join(base, "0.10.0", ".orphaned_at"), "x", "utf8");
    assert.equal(locatePluginRoot("/w", "", dir), join(base, "0.9.0"), "一つ前へ落ちる");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("設定で指したプラグインは、実体であることまで検める", () => {
  const dir = scratch();
  try {
    const wrong = join(dir, "ただのフォルダ");
    mkdirSync(wrong, { recursive: true });
    assert.equal(
      locatePluginRoot(dir, wrong, dir),
      null,
      "在るだけのディレクトリを実体として返している" +
        "（返すと、失敗が『プラグインが無い』ではなく『CLI が失敗した』として出る）",
    );

    const right = join(dir, "本物");
    mkdirSync(join(right, "scripts"), { recursive: true });
    writeFileSync(join(right, "scripts", "docs-audit.py"), "", "utf8");
    assert.equal(locatePluginRoot(dir, right, dir), right, "実体なら受け入れる");

    // 最も多い取り違え: 上流の複製の根を指す。根にも scripts/ は在るが、
    // 実体は plugin/ の側である。一段だけ見て黙って直す。
    const clone = join(dir, "複製");
    mkdirSync(join(clone, "scripts"), { recursive: true });
    mkdirSync(join(clone, "plugin", "scripts"), { recursive: true });
    writeFileSync(join(clone, "plugin", "scripts", "docs-audit.py"), "", "utf8");
    assert.equal(
      locatePluginRoot(dir, clone, dir),
      join(clone, "plugin"),
      "複製の根を指されたら plugin/ へ落とす",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 監査の出所 ----------------------------------------------------------

/** 決められた木を監査したと名乗る偽の CLI を置く。 */
function fakeAudit(pluginRoot: string, reportedRoot: string): void {
  mkdirSync(join(pluginRoot, "scripts"), { recursive: true });
  const script = [
    "import json, sys",
    `print(json.dumps({"schema": "docs-audit/1", "root": ${JSON.stringify(reportedRoot)},`,
    '  "findings": [{"check": "trace_stale", "severity": "warn", "doc_id": "SPEC-001",',
    '               "path": "x.md", "message": "", "refs": []}]}))',
  ].join("\n");
  const file = join(pluginRoot, "scripts", "docs-audit.py");
  writeFileSync(file, script, "utf8");
  chmodSync(file, 0o755);
}

const options = (cwd: string): RunOptions => ({ pythonPath: "python3", timeoutMs: 15000, cwd });

test("上流が別の木を監査したら、その判定を使わない", async () => {
  const dir = scratch();
  try {
    const docsRoot = join(dir, "doctrine_docs");
    const other = join(dir, "docs");
    mkdirSync(docsRoot, { recursive: true });
    mkdirSync(other, { recursive: true });
    const pluginRoot = join(dir, "plugin");

    fakeAudit(pluginRoot, docsRoot);
    const same = await fetchTraceFindings(dir, docsRoot, pluginRoot, options(dir));
    assert.ok(same.ok, "同じ木なら判定を使う");
    assert.equal(same.value.length, 1);

    fakeAudit(pluginRoot, other);
    const different = await fetchTraceFindings(dir, docsRoot, pluginRoot, options(dir));
    assert.equal(
      different.ok,
      false,
      "表示している木と違う木の判定を、そのまま使ってはならない",
    );
    if (!different.ok) {
      assert.equal(different.reason, "absent");
      assert.ok(different.detail.includes(other), "どの木を監査したかを伝える");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("統治木が根直下でなければ判定を取りに行かない", () => {
  assert.equal(canAudit("/w", "/w/doctrine_docs"), true);
  assert.equal(canAudit("/w", "/w/sub/doctrine_docs"), false);
});

// --- python の在処 -------------------------------------------------------

test("作業フォルダ基準の相対値は受け付けない（ADR-010）", () => {
  // 受けると、開いたリポジトリが同梱した実行体が走る。pythonPath を machine scope
  // にしてある意味が消える。ADR-010 は作業フォルダごとの切り替えを諦めている。
  assert.equal(resolvePython(".venv/bin/python"), null);
  assert.equal(resolvePython("./python"), null);
  assert.equal(resolvePython("../python"), null);
  assert.equal(resolvePython("sub/dir/python"), null);
  // 絶対値と ~/ は受ける。
  assert.equal(resolvePython("/usr/bin/python3"), "/usr/bin/python3");
  assert.ok(resolvePython("~/venv/bin/python")?.endsWith("/venv/bin/python"));
  assert.ok(!resolvePython("~/venv/bin/python")?.startsWith("~"), "~ を展開する");
});

test("受け付けない pythonPath は例外ではなく、直せる失敗として返る", async () => {
  const outcome = await runJson<unknown>(["-c", "print(1)"], {
    pythonPath: ".venv/bin/python",
    timeoutMs: 5000,
    cwd: "/w",
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "bad-setting", "取り直しても直らないことを伝える");
    assert.ok(outcome.detail.includes("pythonPath"), "どの設定かを言う");
  }
});

test("待ち時間は子プロセスへ渡してよい形に丸める", () => {
  assert.equal(clampTimeout(20000), 20000);
  // 負を渡すと execFile が同期的に投げ、「失敗は Outcome で返す」約束が破れる。
  assert.equal(clampTimeout(-1), 1000);
  assert.equal(clampTimeout(0), 1000);
  // 32bit を超えると Node が 1ms へ潰す。あらゆる取得が数ミリ秒で時間切れになる。
  assert.equal(clampTimeout(2147483648), 2147483647);
  assert.equal(clampTimeout(3600000000), 2147483647);
  assert.equal(clampTimeout(Number.NaN), 20000);
  assert.equal(clampTimeout(Number.POSITIVE_INFINITY), 20000);
});

test("負の待ち時間でも例外を投げず、Outcome で返る", async () => {
  const outcome = await runJson<unknown>(["-c", 'print(\'{"ok":1}\')'], {
    pythonPath: "python3",
    timeoutMs: -1,
    cwd: "/w",
  });
  assert.equal(outcome.ok, true, "丸めたうえで普通に走る");
});

test("絶対値の pythonPath で実際に子プロセスが起きる", async () => {
  const dir = scratch();
  try {
    const real = execFileSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim();
    mkdirSync(join(dir, "bin"), { recursive: true });
    symlinkSync(real, join(dir, "bin", "python"));
    const script = join(dir, "say.py");
    writeFileSync(script, 'print(\'{"ok": true}\')', "utf8");

    const outcome = await runJson<{ ok: boolean }>([script], {
      pythonPath: join(dir, "bin", "python"),
      timeoutMs: 15000,
      cwd: dir,
    });
    assert.ok(
      outcome.ok,
      `絶対値の pythonPath で起こせない: ${outcome.ok ? "" : `${outcome.reason} ${outcome.detail}`}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("子プロセスの作業フォルダは、誰でも書ける場所ではない", async () => {
  // `-c` の問い合わせは sys.path[0] に作業フォルダを入れる。/tmp をそのまま
  // 渡すと、同じ機械の別の利用者が置いた json.py が先に読まれる（再現済み）。
  const outcome = await runJson<{ cwd: string; head: string[] }>(
    ["-c", "import json,os,sys;json.dump({'cwd':os.getcwd(),'head':sys.path[:1]},sys.stdout)"],
    { pythonPath: "python3", timeoutMs: 15000, cwd: "/w" },
  );
  assert.ok(outcome.ok);
  if (outcome.ok) {
    assert.notEqual(outcome.value.cwd, tmpdir(), "tmpdir をそのまま渡している");
    assert.ok(outcome.value.cwd.includes("doctrine-lens-run-"), "私有の場所であること");
  }
});

test("区切りを含まない名前は PATH から探させる（解いてはならない）", () => {
  assert.equal(resolvePython("python3"), "python3");
  assert.equal(resolvePython("py"), "py");
  assert.equal(resolvePython("  python3  "), "python3");
  assert.equal(resolvePython(""), "python3", "空なら既定へ落とす");
  assert.equal(resolvePython("   "), "python3");
});

test("台帳は、このプロジェクト向けの登録を先に見る", () => {
  // 複数のプロジェクトで別々の版を入れていると、先頭を無条件に採ると
  // 別のプロジェクト向けの版が走る。
  const dir = scratch();
  try {
    const other = join(dir, "他所");
    const mine = join(dir, "自分");
    for (const p of [other, mine]) {
      mkdirSync(join(p, "scripts"), { recursive: true });
      writeFileSync(join(p, "scripts", "docs-audit.py"), "", "utf8");
    }
    mkdirSync(join(dir, "plugins"), { recursive: true });
    writeFileSync(
      join(dir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "doctrine@forest-project-lab": [
            { projectPath: "/どこか別の場所", installPath: other },
            { projectPath: dir, installPath: mine },
          ],
        },
      }),
      "utf8",
    );
    assert.equal(locatePluginRoot(dir, "", dir), mine, "このプロジェクト向けの登録を選ぶ");
    assert.equal(locatePluginRoot("/無関係", "", dir), other, "無ければ先頭へ落ちる");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
