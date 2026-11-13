#!/bin/sh
# 在隔离的 DSH_HOME 里重新安装插件并启动 Web 版，不碰 ~/.dsh。用法：scripts/dev-sandbox.sh [端口]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${DSH_SANDBOX:-$ROOT/../.dsh-sandbox}"
PORT="${1:-4311}"
DSH="${DSH:-$(command -v dsh)}"
if [ -z "$DSH" ]; then
  DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
fi
mkdir -p "$SANDBOX"
SANDBOX="$(cd "$SANDBOX" && pwd)"
cd "$ROOT"
npm run --silent build
unset DSH_SESSION_ID DSH_SHELL DSH_WEB_URL DSH_PROFILE DSH_PROFILE_DIR
export DSH_HOME="$SANDBOX"
"$DSH" plugin --profile web remove media-workbench >/dev/null 2>&1 || true
"$DSH" plugin --profile web add "file:$ROOT" >/dev/null
exec "$DSH" --profile web --no-open --port "$PORT"
