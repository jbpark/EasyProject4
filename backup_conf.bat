@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

echo =====================================================
echo   EP4 backup_conf.zip packager
echo   run.bat 실행에 필요한 "설정 파일"만 묶습니다.
echo   (DB·로그 등 데이터는 제외 — 그건 gitignore.bat)
echo =====================================================
echo.

set ZIP=backup_conf.zip
if exist "%ZIP%" del "%ZIP%"

rem ── 묶을 대상 ────────────────────────────────────────────
rem  git 에 없으면서 run.bat 실행에 필요한 설정 파일.
rem  경로를 프로젝트 루트 기준 상대경로로 담아, 다른 호스트에서
rem  루트에 풀면 그대로 제자리에 놓이게 한다.
rem
rem  제외 항목과 이유:
rem    ep4_id.txt     - EP4 인스턴스 고유 ID. 호스트마다 새로 생성되어야
rem                     Firebase 터널 공유에서 서로 덮어쓰지 않는다.
rem    server\*.db    - 프로젝트·태스크 데이터(설정 아님). gitignore.bat 사용.
rem    tunnel.url     - 터널 실행 시마다 바뀌는 런타임 산출물.
rem    server\ep4.pid - 실행 중 프로세스 정보.
set FILES=
set COUNT=0
for %%F in (
    "conf\ep4.local.conf"
    "conf\marketplace.conf"
    "conf\*adminsdk*.json"
    "conf\manager_id.txt"
    "conf\manager_token.txt"
    "conf\ep4_name.txt"
    "ep4_name.txt"
) do (
    if exist "%%~F" (
        set FILES=!FILES! "%%~F"
        set /a COUNT+=1
        echo   [+] %%~F
    ) else (
        echo   [-] %%~F  ^(없음 - 건너뜀^)
    )
)

echo.
if !COUNT!==0 (
    echo [ERROR] 묶을 설정 파일이 하나도 없습니다.
    echo         conf\ep4.local.conf 은 서버 최초 실행 시 자동 생성됩니다.
    pause
    exit /b 1
)

tar -a -c -f "%ZIP%" !FILES!
if errorlevel 1 (
    echo [ERROR] 압축 실패 ^(Windows 10 1803 이상의 tar 필요^)
    pause
    exit /b 1
)

if not exist "%ZIP%" (
    echo [ERROR] %ZIP% 이 생성되지 않았습니다.
    pause
    exit /b 1
)

echo.
for %%Z in ("%ZIP%") do echo   완료: %%~fZ  ^(%%~zZ bytes, !COUNT!개 파일^)
echo.
echo   [내용 확인]
tar -tf "%ZIP%"
echo.
echo =====================================================
echo   다른 호스트에서 쓰는 법
echo =====================================================
echo     1. git clone https://github.com/jbpark/EasyProject4.git
echo     2. %ZIP% 을 프로젝트 루트에 복사
echo     3. 루트에서 압축 해제:   tar -xf %ZIP%
echo     4. run.bat 실행
echo.
echo   ※ 이 zip 에는 인증 토큰, GitHub 토큰, Firebase 개인키가 들어 있습니다.
echo      메일·클라우드·저장소에 그대로 올리지 마세요. git 에는 제외되어 있습니다.
echo.
pause
