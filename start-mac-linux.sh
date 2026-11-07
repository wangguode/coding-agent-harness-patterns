#!/usr/bin/env bash
# ============================================================================
# WG CodeX Studio — macOS / Linux 一键启动脚本 (Java 17 + Web/Electron Desktop)
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8090}"

echo "============================================================"
echo "  WG CodeX Studio (v0.5) — macOS / Linux Launcher"
echo "  Author: 王果 (wangguode)"
echo "============================================================"

cd "$SCRIPT_DIR/java-harness-studio"

if [ ! -f "target/wg-harness-studio-0.3.0.jar" ]; then
  echo "[1/2] 正在编译打包 Java 17 Harness 内核..."
  mvn -B -q clean package -DskipTests
fi

echo "[2/2] 正在启动 WG CodeX Studio 控制面: http://127.0.0.1:${PORT}"
if command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://127.0.0.1:${PORT}") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 2 && xdg-open "http://127.0.0.1:${PORT}") &
fi

exec java -jar target/wg-harness-studio-0.3.0.jar --server.port="${PORT}"
