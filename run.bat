@echo off
chcp 65001 > nul
cd /d "%~dp0"

where conda >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] conda가 설치되어 있지 않거나 PATH에 없습니다.
    pause
    exit /b 1
)

set EP4_ENV_NEWBORN=0
conda info --envs 2>nul | findstr /C:"easy_project4" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] conda 환경 'easy_project4' 생성 중...
    conda create -n easy_project4 python -y
    conda info --envs 2>nul | findstr /C:"easy_project4" >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] conda 환경 생성 실패.
        pause
        exit /b 1
    )
    set EP4_ENV_NEWBORN=1
)

call conda activate easy_project4
if %errorlevel% neq 0 (
    echo [ERROR] conda 환경 활성화 실패: easy_project4
    pause
    exit /b 1
)

python -c "import pluggy" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] requirements.txt 패키지 설치 중...
    pip install -r requirements.txt
)

python ep4_run_helper.py port > _ep4port.tmp 2>nul
set /p EP4_PORT=<_ep4port.tmp
del _ep4port.tmp >nul 2>&1
if not defined EP4_PORT set EP4_PORT=7788

echo Cleaning up any server on port %EP4_PORT%...
python ep4_run_helper.py killport %EP4_PORT%
del server\ep4.pid >nul 2>&1
timeout /t 1 /nobreak >nul

REM 서버를 포그라운드로 실행한다. 콘솔에서 아무 키나 누르면 server.py가
REM 직접 종료 처리(Stopping/stopped 출력 후 종료)한다. start /b + pause 조합은
REM 백그라운드 python과 콘솔 stdin을 공유해 pause가 즉시 반환되는 문제가 있어 제거.
REM EP4_NO_MANAGER_PRINT=1: Manager 연결 상태 문구 억제 (키 입력 종료는 그대로 동작).
set EP4_NO_MANAGER_PRINT=1
python server.py %EP4_PORT% 0.0.0.0

REM 안전망: 혹시 남아 있는 서버 정리
python ep4_run_helper.py killport %EP4_PORT% >nul 2>&1
del server\ep4.pid >nul 2>&1
