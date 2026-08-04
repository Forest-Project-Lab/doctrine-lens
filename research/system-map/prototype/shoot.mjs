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
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(url);

const shots = [];
const shot = async (name, note) => {
  const file = `${name}.png`;
  await p.screenshot({ path: join(shotsDir, file), fullPage: true });
  shots.push({ file, note });
  console.log("撮影:", file);
};

// 対象1: システム
await shot("01-system-t1", "対象1(Doctrine+Lens)システム画面 — 境界の箱とやり取りの表");
// 箱を選んで詳細パネル、契約を開いて証拠まで
await p.locator('[data-el="lens"]').click();
await p.locator(".panel details summary").first().click();
await shot("02-system-t1-detail", "lens を選択 → 詳細パネル(契約充足の評価)。verified の条件併記");
// ドリルダウン
await p.locator('[data-drill="doctrine"]').click();
await shot("03-system-t1-drill", "doctrine の内部(black box → white box。パンくず付き)");
await p.locator("#up").click();
// シナリオ(例外系も開く)
await p.locator('nav button[data-v="scenario"]').click();
for (const d of await p.locator("main details:not([open]) summary").all()) await d.click();
await shot("04-scenario-t1", "対象1 シナリオ画面(正常系+例外系)");
// 保証
await p.locator('nav button[data-v="assurance"]').click();
await shot("05-assurance-t1", "対象1 保証画面 — 状態を重い順、unknown は負の出所つき");
// 対象2: 保証(実事故を含む)
await p.selectOption("#target", "1");
await shot("06-assurance-t2", "対象2(出荷プロセス)保証画面 — claimed(stale .vsix 事故)と unknown");
// 対象2: システム
await p.locator('nav button[data-v="system"]').click();
await shot("07-system-t2", "対象2 システム画面 — 人・運用・外部系を含む境界");
// 対象3: システムと保証
await p.selectOption("#target", "2");
await shot("08-system-t3", "対象3(Celery)システム画面");
await p.locator('nav button[data-v="assurance"]').click();
await shot("09-assurance-t3", "対象3 保証画面 — 順序保証の unknown(負の出所2件)");
// 変更影響・検査
await p.locator('nav button[data-v="impact"]').click();
await shot("10-impact", "変更影響画面 — 答えの正本は既存 Lens と明記(混ぜない)");
await p.locator('nav button[data-v="inspect"]').click();
await shot("11-inspect", "検査画面 — M-13/M-14 の判定と全要素の操作数表");
// 案B(構成図)
await p.locator('nav button[data-v="system"]').click();
await p.selectOption("#target", "0");
await p.locator('[data-mode="B"]').click();
await shot("12-system-b-t1", "案B: 対象1 構成図 — 層は Flow 方向から導出、全辺ラベル、状態章つきの箱");
await p.selectOption("#target", "1");
await shot("13-system-b-t2", "案B: 対象2 構成図(人・運用・外部系)");
await p.selectOption("#target", "2");
await shot("14-system-b-t3", "案B: 対象3 構成図(Celery)");

await b.close();

writeFileSync(join(shotsDir, "README.md"), `# 静止画(所有者の UIUX 確認用)

撮影時点: commit \`${rev}\`(experiment/system-map)・2026-08-04。
**静止画は撮った時点の木でしか正しくない。** 模型や画面を変えたら撮り直す(build.mjs → shoot.mjs)。

${shots.map((s) => `- \`${s.file}\` — ${s.note}`).join("\n")}
`);
console.log("完了。撮影時点:", rev);
