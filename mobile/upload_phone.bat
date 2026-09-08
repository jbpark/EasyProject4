@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ================================================
echo   EP4 Mobile - Build and Install to Phone
echo ================================================
echo.

where flutter >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Flutter is not installed or not in PATH.
    echo   Install: https://docs.flutter.dev/get-started/install
    pause & exit /b 1
)

echo [1/3] Installing dependencies...
call flutter pub get
if %errorlevel% neq 0 (
    echo [ERROR] flutter pub get failed.
    pause & exit /b 1
)

echo.
echo [2/3] Building release APK...
echo.
call flutter build apk --release
if %errorlevel% neq 0 (
    echo [ERROR] APK build failed.
    pause & exit /b 1
)

echo.
echo   Output: build\app\outputs\flutter-apk\app-release.apk
echo.
echo [3/3] Installing to connected phone...
echo   (Connect phone via USB with USB Debugging enabled)
echo.
call flutter install
if %errorlevel% neq 0 (
    echo [ERROR] Install failed. Check USB connection and USB Debugging.
    pause & exit /b 1
)

echo.
echo ================================================
echo   Done! Launch "EasyProject4" on your phone.
echo ================================================
echo.
pause
