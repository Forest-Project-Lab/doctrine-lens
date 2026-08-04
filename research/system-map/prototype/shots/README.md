# 静止画(所有者の UIUX 確認用)

撮影時点: commit `01e844d`(experiment/system-map)・2026-08-04。
**静止画は撮った時点の木でしか正しくない。** 模型や画面を変えたら撮り直す(build.mjs → shoot.mjs)。
12〜14 番(旧 案A/案B 比較用)は、所有者判断(2026-08-04、構成図を採用)により役目を終えて削除した。

- `01-system-t1.png` — 対象1(Doctrine+Lens)システム画面 — 構成図(採用: 所有者判断 2026-08-04)
- `02-system-t1-detail.png` — lens を選択 → 詳細パネル(IN/OUT の詳細表+契約充足の評価)
- `03-system-t1-drill.png` — doctrine の内部(black box → white box。パンくず付き)
- `04-scenario-t1.png` — 対象1 シナリオ画面(正常系+例外系)
- `05-assurance-t1.png` — 対象1 保証画面 — 状態を重い順、unknown は負の出所つき
- `06-assurance-t2.png` — 対象2(出荷プロセス)保証画面 — claimed(stale .vsix 事故)と unknown
- `07-system-t2.png` — 対象2 システム画面(構成図) — 人・運用・外部系を含む境界
- `08-system-t3.png` — 対象3(Celery)システム画面(構成図)
- `09-assurance-t3.png` — 対象3 保証画面 — 順序保証の unknown(負の出所2件)
- `10-impact.png` — 変更影響画面 — 答えの正本は既存 Lens と明記(混ぜない)
- `11-inspect.png` — 検査画面 — M-13/M-14(負の試験で発火確認済み)と全要素の操作数表
- `15-assurance-fixture.png` — fixture(架空): planned/failed/stale を含む保証画面 — H 層 T6 用
