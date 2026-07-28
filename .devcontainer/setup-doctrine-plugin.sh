#!/usr/bin/env bash
# doctrine プラグイン（https://github.com/Forest-Project-Lab/doctrine）を marketplace 経由で導入する。
#
# このキットは doctrine の同梱コピーを持たない。正本は上流リポジトリ 1 箇所であり、
# ここが唯一の入口である。宣言（どの marketplace の何を有効にするか）は
# リポジトリの .claude/settings.json にあり、本スクリプトは「実体の取得」だけを行う。
#
# 版の追従は .claude/settings.json の extraKnownMarketplaces[].autoUpdate=true が担う。
# Claude Code はセッション開始後（最大 10 分の遅延）に marketplace と導入済みプラグインを
# 更新し、更新があれば /reload-plugins を促す。本スクリプトは初回導入とリビルド時の取り直し用。
#
# 冪等: marketplace が未登録なら追加・登録済みなら更新、プラグインが未導入なら install・
#       導入済みなら update。ネットワーク不通でも postCreate 全体は止めない（警告して exit 0）。
#
# 無効化: devcontainer.json の containerEnv で CLAUDE_DOCTRINE=0、
#         または postCreateCommand の該当セグメントを削除する。
set -uo pipefail

MARKETPLACE_NAME="forest-project-lab"
MARKETPLACE_URL="https://github.com/Forest-Project-Lab/doctrine.git"
PLUGIN_ID="doctrine@${MARKETPLACE_NAME}"

if [ "${CLAUDE_DOCTRINE:-1}" = "0" ]; then
  echo "[setup-doctrine] CLAUDE_DOCTRINE=0 → skipping doctrine plugin setup."
  exit 0
fi

if ! command -v claude > /dev/null 2>&1; then
  echo "[setup-doctrine] WARN: 'claude' が PATH に無いため飛ばしました。"
  echo "[setup-doctrine]       Claude Code を入れてから 'bash .devcontainer/setup-doctrine-plugin.sh' を再実行してください。"
  exit 0
fi

# 1) marketplace — 未登録なら追加（clone）、登録済みなら最新のカタログへ更新。
if claude plugin marketplace list 2>/dev/null | grep -qF "$MARKETPLACE_NAME"; then
  claude plugin marketplace update "$MARKETPLACE_NAME" \
    || echo "[setup-doctrine] WARN: marketplace の更新に失敗（オフライン？）。既存のカタログで続行します。"
else
  if ! claude plugin marketplace add "$MARKETPLACE_URL"; then
    echo "[setup-doctrine] WARN: marketplace の追加に失敗しました。手動で以下を実行してください:"
    echo "[setup-doctrine]       claude plugin marketplace add $MARKETPLACE_URL"
    exit 0
  fi
fi

# 2) plugin — 未導入なら install、導入済みなら最新版へ update。
if claude plugin list 2>/dev/null | grep -qF "$PLUGIN_ID"; then
  claude plugin update "$PLUGIN_ID" --scope project \
    || echo "[setup-doctrine] WARN: プラグインの更新に失敗（オフライン？）。現在の版のまま続行します。"
else
  if ! claude plugin install "$PLUGIN_ID" --scope project; then
    echo "[setup-doctrine] WARN: プラグインの導入に失敗しました。手動で以下を実行してください:"
    echo "[setup-doctrine]       claude plugin install $PLUGIN_ID --scope project"
    exit 0
  fi
fi

claude plugin list 2>/dev/null | grep -A3 -F "$PLUGIN_ID"
echo "[setup-doctrine] done. フックとスキルは次のセッションから有効になります（/reload-plugins でも可）。"
exit 0
