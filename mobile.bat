@echo off
chcp 65001 > nul
cd /d "%~dp0mobile"

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
echo [2/2] Launching EP4 mobile app...
echo   default device: windows (desktop)
echo   override: mobile.bat ^<deviceId^>   e.g. mobile.bat chrome / emulator-5554
echo.

set EP4_URL=http://localhost:7788

REM Firebase DB 주소는 conf/ep4.local.conf 에서 읽는다 (저장소에 커밋되지 않음).
REM 값이 없으면 빈 문자열로 전달되어 "EP4 ID" 탭 연결만 비활성화된다.
set EP4_FB=
for /f "usebackq delims=" %%i in (`python "%~dp0read_conf.py" firebase_db_url 2^>nul`) do set EP4_FB=%%i

if "%~1"=="" (
    call flutter run -d windows --dart-define=EP4_DEFAULT_URL=%EP4_URL% --dart-define=EP4_FIREBASE_DB=%EP4_FB%
) else (
    call flutter run -d %1 --dart-define=EP4_DEFAULT_URL=%EP4_URL% --dart-define=EP4_FIREBASE_DB=%EP4_FB%
)

cd /d "%~dp0"
pause
