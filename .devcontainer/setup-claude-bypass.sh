#!/usr/bin/env bash
# Configure Claude Code "bypassPermissions" mode in a Dev Container.
#
# Based on an investigation report (see this kit's README, "bypassPermissions"):
# the VS Code extension needs TWO settings locations — Claude Code's own
# user settings AND the VS Code *Machine* settings (the UI gate) — before the
# "Bypass permissions" mode appears and is selectable.
#
# This script is idempotent and merges (does not clobber) existing JSON.
# Invoked from devcontainer.json postCreateCommand so it re-applies on rebuild
# (report note: ~/.claude/settings.json can be lost on rebuild).
#
# ⚠️ bypassPermissions auto-approves ALL tool calls (file delete, arbitrary
#    shell, etc.) with no prompt. Only enable in disposable/trusted containers.
#    OFF by default. This repository is public, so whoever clones it must not
#    get an auto-approving agent without asking for it. To opt IN, set
#    CLAUDE_BYPASS=1 in devcontainer.json's containerEnv.
set -euo pipefail

# 既定は「入れない」。値が明示的に 1 のときだけ設定する。
if [ "${CLAUDE_BYPASS:-0}" != "1" ]; then
  echo "[setup-claude-bypass] CLAUDE_BYPASS is not 1 → skipping bypassPermissions setup."
  exit 0
fi

merge_json() {
  # merge_json <file> <json-patch>  — recursively merges patch into file (creates if absent).
  #
  # The merge MUST be recursive. A shallow `{...cur, ...patch}` replaces whole
  # objects: patching {"permissions":{"defaultMode":...}} onto an existing
  # {"permissions":{"deny":[...],"allow":[...]}} silently destroys the user's
  # deny/allow rules. That is a security regression, and a silent one.
  # Arrays are replaced, not concatenated — merging lists has no single right
  # answer, and this script never needs to add to one.
  local file="$1" patch="$2"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || echo '{}' > "$file"
  node -e '
    const fs = require("fs");
    const [file, patch] = [process.argv[1], JSON.parse(process.argv[2])];
    const isPlainObject = (v) =>
      v !== null && typeof v === "object" && !Array.isArray(v);
    const deepMerge = (base, over) => {
      const out = { ...base };
      for (const [k, v] of Object.entries(over)) {
        out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
      }
      return out;
    };
    // 読めなかったものを {} と見なして書き潰さない。VS Code の settings.json は
    // JSONC（注釈と末尾のコンマを許す）であり、JSON.parse は必ず落ちる。
    // 落ちた回に空として書き戻すと、利用者の設定が丸ごと消える（実測 2236→116 バイト）。
    const raw = fs.readFileSync(file, "utf8");
    let cur;
    try {
      cur = JSON.parse(raw || "{}");
    } catch {
      // 注釈と末尾のコンマだけを落として読み直す。それでも駄目なら触らない。
      const stripped = raw
        .replace(/\\"|"(?:\\"|[^"])*"|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, (m, c) => (c ? " " : m))
        .replace(/,\s*([}\]])/g, "$1");
      try {
        cur = JSON.parse(stripped || "{}");
      } catch {
        console.error("[setup-claude-bypass] " + file + " を読めないので触らない（手で直す）。");
        process.exit(2);
      }
    }
    fs.writeFileSync(file, JSON.stringify(deepMerge(cur, patch), null, 2) + "\n");
  ' "$file" "$patch"
}

# 1) Claude Code user settings — the engine's default mode.
CLAUDE_USER_SETTINGS="${HOME}/.claude/settings.json"
merge_json "$CLAUDE_USER_SETTINGS" '{"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true}'
echo "[setup-claude-bypass] wrote $CLAUDE_USER_SETTINGS"

# 2) VS Code Machine settings — the UI gate that exposes the mode.
MACHINE_DIR="${HOME}/.vscode-server/data/Machine"
if [ -d "${HOME}/.vscode-server" ]; then
  merge_json "${MACHINE_DIR}/settings.json" '{"claudeCode.allowDangerouslySkipPermissions":true,"claudeCode.initialPermissionMode":"bypassPermissions"}'
  echo "[setup-claude-bypass] wrote ${MACHINE_DIR}/settings.json"
else
  echo "[setup-claude-bypass] ~/.vscode-server not found (non-VSCode env?) — skipped Machine settings."
fi

echo "[setup-claude-bypass] done. Reload the VS Code window to pick up the mode selector."
