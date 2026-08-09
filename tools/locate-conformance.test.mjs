// 上流の実体を解決する規則を、**二つの実装へ同じ事例表で当てる**。
//
//   node --test tools/locate-conformance.test.mjs
//
// 解決の規則は二箇所に実装が在る。
//   tools/lib/locate-plugin.mjs   npm script(docs:check ほか)が使う
//   src/doctrine/locate.ts        拡張機能が使う
//
// **この二つは既に乖離していた。** `.orphaned_at` の検めは片方だけに在り、
// 経路の突き合わせは片方が素の `===` だった。乖離が事実である以上、規則を
// 一箇所(tools/locate-cases.json)に置き、食い違いを機械で捕まえる。
//
// 規則そのものの正本は事例表である。実装ではない。
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "locate-cases.json"), "utf8"));

const { resolvePlugin } = await import("./lib/locate-plugin.mjs");
const { locatePluginRoot } = await import("../out/doctrine/locate.js");

/** 事例のとおりに偽の設定ディレクトリを組む。実物の台帳には触れない。 */
function build(spec) {
  const home = mkdtempSync(join(tmpdir(), "doctrine-lens-locate-"));
  const project = join(home, "project");
  const other = join(home, "other-project");
  const cache = join(home, ".claude", "plugins", "cache", "forest-project-lab", "doctrine");
  mkdirSync(project, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(cache, { recursive: true });

  const subst = (s) =>
    String(s)
      .replace("<cache>", cache)
      .replace("<project-upper>", project.toUpperCase())
      .replace("<project>", project)
      .replace("<other>", other);

  for (const v of spec.cache ?? []) {
    const d = join(cache, v);
    mkdirSync(join(d, "scripts"), { recursive: true });
    writeFileSync(join(d, "scripts", "docs-audit.py"), "# 偽物\n");
    mkdirSync(join(d, ".claude-plugin"), { recursive: true });
    writeFileSync(join(d, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "doctrine", version: v }) + "\n");
  }
  for (const v of spec.orphaned ?? []) writeFileSync(join(cache, v, ".orphaned_at"), "2026-01-01\n");

  const pluginsDir = join(home, ".claude", "plugins");
  if (spec.ledger !== undefined) {
    const body =
      typeof spec.ledger === "string"
        ? spec.ledger
        : JSON.stringify({
            version: 2,
            plugins: {
              "doctrine@forest-project-lab": spec.ledger.map((e) => {
                const out = { installPath: subst(e.installPath) };
                if (e.projectPath) out.projectPath = subst(e.projectPath);
                return out;
              }),
            },
          });
    writeFileSync(join(pluginsDir, "installed_plugins.json"), body);
  }
  return { home, project, cache, configDir: join(home, ".claude"), subst };
}

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

for (const c of CASES.cases) {
  if (c.expect_case_insensitive_only && !caseInsensitive) continue;

  test(`規則 ${c.id} — ${c.why}`, () => {
    const env = build(c);
    try {
      const want = c.expect.root === null ? null : env.subst(c.expect.root);

      // 1) 道具の側
      const got = resolvePlugin({ projectDir: env.project, configDir: env.configDir, pin: null });
      assert.equal(got.root, want, `tools/lib/locate-plugin.mjs — 解決の跡: ${JSON.stringify(got.trace)}`);
      assert.equal(got.resolved_via, c.expect.via, `tools/lib/locate-plugin.mjs — どこから引いたか`);

      // 2) 拡張機能の側。同じ答えでなければならない。
      const fromExtension = locatePluginRoot(env.project, "", env.configDir);
      assert.equal(
        fromExtension === null ? null : resolve(fromExtension),
        want === null ? null : resolve(want),
        "src/doctrine/locate.ts が道具の側と違う答えを出した(規則が乖離している)",
      );
    } finally {
      rmSync(env.home, { recursive: true, force: true });
    }
  });
}

test("事例表が両方の実装を実際に走らせている(空振りでない)", () => {
  assert.ok(CASES.cases.length >= 10, "事例が少なすぎる");
  assert.equal(typeof resolvePlugin, "function", "道具の側の実装を取り込めていない");
  assert.equal(typeof locatePluginRoot, "function", "拡張機能の側の実装を取り込めていない");
});
