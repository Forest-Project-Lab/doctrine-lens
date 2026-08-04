// プロトタイプの静止画を撮る(所有者の UIUX 確認用)。
//
//   node shoot.mjs   →  shots/*.png
//
// 静止画は撮った時点の木でしか正しくない(CHANGE-018 の教訓)。
// ファイル名と README に撮影時点の commit を刻む。
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const shotsDir = join(here, "shots");
mkdirSync(shotsDir, { recursive: true });
const rev = execSync("git rev-parse --short HEAD", { cwd: here, encoding: "utf8" }).trim();
const url = "file://" + join(here, "index.html");

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url);

const shots = [];
const shot = async (name, note, locator = null) => {
  const file = `${name}.png`;
  if (locator) await locator.screenshot({ path: join(shotsDir, file) });
  else await p.screenshot({ path: join(shotsDir, file), fullPage: true });
  shots.push({ file, note });
  console.log("撮影:", file);
};

// 対象1: 全体(未選択・1440×900 相当の等倍)
await shot("01-system-t1", "対象1 全体 — 縦積みの構成図(1440×900・100% 相当)");
// 選択 → 図と詳細の同時表示
await p.locator('svg g[data-el="lens"]').click();
await shot("02-system-t1-detail", "lens を選択 — 図と 12 節の詳細パネルを同時表示");
// 詳細パネルの実装・証拠到達(12 節までスクロール)
await p.locator("#detail").evaluate((el) => { el.scrollTop = el.scrollHeight; });
await shot("02b-panel-evidence", "詳細パネル下部 — 9〜12 節(Guarantee/Failure/Rationale/Code・Evidence の実リンク)", p.locator("#detail"));
// ドリルダウン(lens 内部)
await p.locator('[data-drill="lens"]').click();
await shot("03-system-t1-drill", "lens の内部 — パンくず+親の目的常示+越境流れの集約表");
await p.locator("#up").click();
// シナリオ(例外系も開く)
await p.locator('nav button[data-v="scenario"]').click();
for (const d of await p.locator("main details:not([open]) summary, #left details:not([open]) summary").all()) await d.click();
await shot("04-scenario-t1", "対象1 シナリオ画面(正常系+例外系)");
// 保証
await p.locator('nav button[data-v="assurance"]').click();
await shot("05-assurance-t1", "対象1 保証画面 — 状態を重い順、unknown は負の出所つき");
// 対象2
await p.selectOption("#target", "1");
await shot("06-assurance-t2", "対象2 保証画面 — claimed(stale .vsix 事故)と unknown");
await p.locator('nav button[data-v="system"]').click();
await shot("07-system-t2", "対象2 全体 — 人・運用・外部系(行内複数箱・上から入る戻り辺)");
// 対象3
await p.selectOption("#target", "2");
await shot("08-system-t3", "対象3(Celery)全体");
await p.locator('nav button[data-v="assurance"]').click();
await shot("09-assurance-t3", "対象3 保証画面 — 順序保証の unknown(負の出所2件)");
// 変更影響・検査
await p.locator('nav button[data-v="impact"]').click();
await shot("10-impact", "変更影響画面 — 答えの正本は既存 Lens と明記(混ぜない)");
await p.locator('nav button[data-v="inspect"]').click();
await shot("11-inspect", "検査画面 — M-13(実ブラウザ)・M-14(実経路)の判定と全要素の到達表");
// 希少状態 fixture(架空)
await p.selectOption("#target", "3");
await p.locator('nav button[data-v="assurance"]').click();
await shot("15-assurance-fixture", "fixture(架空): planned/failed/stale を含む保証画面 — H 層 T6 用");

await b.close();

writeFileSync(join(shotsDir, "README.md"), `# 静止画(所有者の UIUX 確認用)

撮影時点: commit \`${rev}\`(experiment/system-map)・2026-08-04。
**静止画は撮った時点の木でしか正しくない。** 模型や画面を変えたら撮り直す(build.mjs → shoot.mjs)。

${shots.map((s) => `- \`${s.file}\` — ${s.note}`).join("\n")}
`);
console.log("完了。撮影時点:", rev);
