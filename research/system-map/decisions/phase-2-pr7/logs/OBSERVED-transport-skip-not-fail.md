# 偶発の通信失敗を、リンクの破損として報告しなかった実測(2026-08-10)

一括判定の走行中に、外部への伝送が一度だけ成立しなかった。同時刻の `curl` は HTTP 200 を
返し、再走行では全件通過した —— **偶発である**。

重要なのは、そのとき段が何と言ったかである:

- 判定は **SKIP(判定不能)** であって FAIL(破損)ではない
- 走行は緑にならなかった(SKIP は合格の桶に入らない。了解の記録も無い)

つまり「環境が答えられなかった」と「リンクが壊れている」を混ぜずに、しかも
**黙って通しもしなかった**。この分岐が荷重を負っていることは変異表が確かめている
(「伝送不成立の扱いを潰す」)。

## そのときの判定の記録

```json
[
  {
    "invariant": "M-14",
    "checker": "browser:ops-count",
    "target": "doctrine-and-lens",
    "verdict": "SKIP",
    "examined": 8,
    "examined_unit": "実クリックで測った要素",
    "code": "meta.skip",
    "message": "外部への伝送が成立せず、到達を判定できなかった: doctrine-and-lens/doctrine — 実操作 2 / 計算 2 / 到達先 3 件 / 開けなかった(伝送の失敗): chrome-error://chromewebdata/ / 到達を判定できない: https://github.com/Forest-Project-Lab/doctrine/blob/8cd29bd/plugin/scripts/docs-audit.py → 伝送が成立しない(HTTP の位置づけを得られない)"
  },
  {
    "invariant": "M-14",
    "checker": "browser:ops-count",
    "target": "lens-shipping",
    "verdict": "PASS",
    "examined": 1,
    "examined_unit": "実クリックで測った要素",
    "code": null,
    "message": ""
  },
  {
    "invariant": "M-14",
    "checker": "browser:ops-count",
    "target": "celery",
    "verdict": "VACUOUS",
    "examined": 0,
    "examined_unit": "実クリックで測った要素",
    "code": "meta.vacuous",
    "message": "実クリックで測った要素 が 0 件。何も検めていない"
  },
  {
    "invariant": "M-14",
    "checker": "browser:ops-count",
    "target": "fixture-rare-states(架空)",
    "verdict": "VACUOUS",
    "examined": 0,
    "examined_unit": "実クリックで測った要素",
    "code": "meta.vacuous",
    "message": "実クリックで測った要素 が 0 件。何も検めていない"
  }
]
```
