# 静止画(所有者の UIUX 確認用)

撮影時点: commit `043da87` / 2026-08-10T01:07:08.875Z / viewport 1440×900・100%。
刻印は撮影処理が自動生成する(作業木が汚れていると撮影は拒否される)。
**静止画は撮った時点の木でしか正しくない。** 模型や画面を変えたら撮り直す(build.mjs → shoot.mjs)。

撮る枚は模型の一覧から導く(`registry.json` の役割 build)。名前は対象の id から作る ——
位置の番号を使わない(並べ替えたときに別の対象を指さないため)。

issue へ貼るときは **commit を固定した URL** を使う(枝の名前は動く):

    https://raw.githubusercontent.com/Forest-Project-Lab/doctrine-lens/043da870144ab82a4301bcc27115f1007094ce53/research/system-map/prototype/shots/<ファイル名>

- `system-doctrine-and-lens.png` — doctrine-and-lens 全体 — 構成図(1440×900・100% 相当)
- `assurance-doctrine-and-lens.png` — doctrine-and-lens 保証画面 — 状態を重い順、unknown は負の出所つき
- `system-lens-shipping.png` — lens-shipping 全体 — 構成図(1440×900・100% 相当)
- `assurance-lens-shipping.png` — lens-shipping 保証画面 — 状態を重い順、unknown は負の出所つき
- `system-celery.png` — celery 全体 — 構成図(1440×900・100% 相当)
- `assurance-celery.png` — celery 保証画面 — 状態を重い順、unknown は負の出所つき
- `system-fixture-rare-states.png` — fixture-rare-states(架空) 全体 — 構成図(1440×900・100% 相当)
- `assurance-fixture-rare-states.png` — fixture-rare-states(架空) 保証画面 — 状態を重い順、unknown は負の出所つき
- `detail-doctrine-and-lens.png` — doctrine を選択 — 図と 12 節の詳細パネルを同時表示
- `panel-doctrine-and-lens.png` — 詳細パネル下部 — 9〜12 節(Guarantee/Failure/Rationale/Code・Evidence の実リンク)
- `drill-doctrine-and-lens.png` — doctrine の内部 — パンくず+親の目的常示+越境流れの集約表
- `scenario-doctrine-and-lens.png` — doctrine-and-lens シナリオ画面(正常系+例外系)
- `impact.png` — 変更影響画面 — 答えの正本は既存 Lens と明記(混ぜない)
- `inspect.png` — 検査画面 — M-13(実ブラウザ)・M-14(実経路)の判定と全要素の到達表
