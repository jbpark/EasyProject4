@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

echo =====================================================
echo   EP4 gitignore.zip packager
echo   git 에 없는 실행 필수 파일을 gitignore.zip 으로 묶습니다.
echo =====================================================
echo.

set ZIP=gitignore.zip
if exist "%ZIP%" del "%ZIP%"

rem 대상: 비공개 설정(conf) + 로컬 DB(server)
rem 제외: ep4_id.txt(PC별 고유), tunnel.url/log 등 런타임 산출물
set FILES=
for %%F in (
    "conf\ep4.local.conf"
    "conf\marketplace.conf"
    "conf\*adminsdk*.json"
    "server\projects.db"
    "server\projects.db-wal"
    "server\projects.db-shm"
    "server\channels.db"
    "server\channels.db-wal"
    "server\channels.db-shm"
) do (
    if exist "%%~F" (
        set FILES=!FILES! "%%~F"
        echo   [+] %%~F
    )
)

if "!FILES!"=="" (
    echo [ERROR] 묶을 파일이 없습니다.
    pause
    exit /b 1
)

tar -a -c -f "%ZIP%" !FILES!
if errorlevel 1 (
    echo [ERROR] 압축 실패
    pause
    exit /b 1
)

echo.
for %%Z in ("%ZIP%") do echo   완료: %%~fZ (%%~zZ bytes)
echo.
echo   다른 PC 사용법:
echo     1. git clone 후 %ZIP% 을 프로젝트 루트에 복사
echo     2. 루트에서 압축 해제:  tar -xf %ZIP%
echo     3. run.bat 실행
echo.
pause
