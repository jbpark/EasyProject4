@echo off
chcp 65001 > nul
cd /d "%~dp0desktop"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js가 설치되어 있지 않거나 PATH에 없습니다.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INFO] npm install 실행 중...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install 실패.
        pause
        exit /b 1
    )
)

call npm start
