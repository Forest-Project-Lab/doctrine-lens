#!/usr/bin/env node
// 束ねた `.vsix` が、実際の編集器へ導入できることを確かめる。
//
//   node tools/vsix-install-check.mjs [--json]
//
// なぜ要るか: `npm run package` が通ることと、**編集器がそれを導入できること**は別である。
// manifest の欠け・`main` の指す先の不在・engines の不一致は、束ねの時点では出ない。
// 統合試験は `extensionDevelopmentPath`(ソースの木)を読むので、この経路を通らない。
//
// 利用者の環境を汚さない。導入先は一時の置き場だけである。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";

const projectRoot = resolve(import.meta.dirname, "..");
const vsix = join(projectRoot, "doctrine-lens.vsix");
const asJson = process.argv.includes("--json");

if (!existsSync(vsix)) {
  console.error(`doctrine-lens.vsix が無い。先に npm run package を回すこと: ${vsix}`);
  process.exit(2);
}

// 親の VS Code から受け継いだ環境変数を落とす(run-vscode-test.mjs と同じ理由)。
for (const name of Object.keys(process.env)) {
  if (name === "ELECTRON_RUN_AS_NODE" || name.startsWith("VSCODE_")) delete process.env[name];
}
// WSL では CLI が「Windows 側へ入れ直せ」と促し、**答えを待って止まる**。
// 促しを止める(この検めは Linux 側の実体を意図して使っている)。
process.env["DONT_PROMPT_WSL_INSTALL"] = "1";

const exe = await downloadAndUnzipVSCode();
const [cli, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(exe);
const work = mkdtempSync(join(tmpdir(), "doctrine-lens-vsix-"));
const extDir = join(work, "extensions");
const userDir = join(work, "user-data");

const run = (args) =>
  execFileSync(cli, [...baseArgs, "--extensions-dir", extDir, "--user-data-dir", userDir, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });

let result;
try {
  const installed = run(["--install-extension", vsix, "--force"]);
  const listed = run(["--list-extensions", "--show-versions"]).trim().split("\n").filter(Boolean);
  const mine = listed.filter((l) => l.toLowerCase().startsWith("forest-project-lab.doctrine-lens"));
  result = {
    schema: "doctrine-lens/vsix-install-check/1",
    vsix,
    installed_ok: /successfully installed|already installed/i.test(installed),
    listed: mine,
    // **導入できたことしか言えない。** 画面の中で人が押したことは、ここでは確かめられない。
    limit: "導入と登録までを見る。画面の描画と人の操作は含まない。",
  };
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (!result.installed_ok || result.listed.length !== 1) {
  console.error(`VSIX を導入できない、または一覧に現れない: ${JSON.stringify(result, null, 2)}`);
  process.exit(1);
}
console.log(asJson ? JSON.stringify(result, null, 2) : `VSIX を導入できた: ${result.listed[0]}`);
