@echo off
chcp 65001 > nul
cd /d "%~dp0"

where flutter >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Flutter is not installed or not in PATH.
    echo   Install: https://docs.flutter.dev/get-started/install
    pause
    exit /b 1
)

echo [1/2] Fetching dependencies...
call flutter pub get
if %errorlevel% neq 0 (
    echo [ERROR] flutter pub get failed.
    pause
    exit /b 1
)

echo.
echo [2/2] Building release APK...
call flutter build apk --release
if %errorlevel% neq 0 (
    echo [ERROR] flutter build apk failed.
    pause
    exit /b 1
)

echo.
echo [OK] APK: %~dp0build\app\outputs\flutter-apk\app-release.apk
echo   EP4 dashboard(QR modal) serves this file at /api/apk for download.
pause
