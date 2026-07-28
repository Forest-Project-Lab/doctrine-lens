# Node 22 LTS (Jod) on Debian 12 (bookworm) — pinned major variant
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Playwright browser system deps (chromium/firefox/webkit minimum set) plus:
#  - python3 : the doctrine plugin gate (stdlib-only Python)
#  - unzip   : tools/doc-manager docx/xlsx extractors shell out to `unzip`
#
# The libgtk-3-0 / xvfb / xauth group is for `npm run test:integration`, which
# downloads a real VS Code and drives it headless (@vscode/test-electron).
# VS Code is an Electron app: it needs GTK3 and an X server even headless.
# Without them the download succeeds and the launch dies with a bare
# "libgtk-3.so.0: cannot open shared object file".
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 unzip \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
      libwoff1 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
      libharfbuzz-icu0 libenchant-2-2 libsecret-1-0 libhyphen0 libegl1 \
      libgles2 libgudev-1.0-0 libevent-2.1-7 libopus0 libwebpdemux2 \
      libavif15 ca-certificates fonts-noto-cjk \
      libgtk-3-0 libxss1 xvfb xauth \
    && rm -rf /var/lib/apt/lists/*

# Global tooling
# - @anthropic-ai/claude-code: CLI (used by the VS Code extension's terminal)
# - @playwright/mcp:           MCP server consumed by Claude Code
# Versions are intentionally floated to "latest" at image build time so that
# devcontainer rebuilds pick up new releases. Lockfile pinning is applied to
# the app's package.json.
RUN npm install -g @anthropic-ai/claude-code@latest @playwright/mcp@latest

USER node
