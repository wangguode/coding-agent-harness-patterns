@echo off
REM ============================================================================
REM WG CodeX Studio — Windows 10/11 一键启动脚本 (支持 CMD / PowerShell)
REM ============================================================================
chcp 65001 >nul
setlocal

set PORT=8090
echo ============================================================
echo   WG CodeX Studio (v0.5) — Windows 10/11 Launcher
echo   Author: 王果 (wangguode)
echo ============================================================

cd /d "%~dp0java-harness-studio"

if not exist "target\wg-harness-studio-0.3.0.jar" (
    echo [1/2] Building WG CodeX Java 17 Kernel...
    call mvn -B -q clean package -DskipTests
)

echo [2/2] Starting WG CodeX Studio at http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
java -jar target\wg-harness-studio-0.3.0.jar --server.port=%PORT%
endlocal
