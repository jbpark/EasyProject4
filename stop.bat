@echo off
chcp 65001 > nul
cd /d "%~dp0"

where conda >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] conda가 설치되어 있지 않거나 PATH에 없습니다.
    pause
    exit /b 1
)

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
)

call conda activate easy_project4
if %errorlevel% neq 0 (
    echo [ERROR] conda 환경 활성화 실패: easy_project4
    pause
    exit /b 1
)

echo Stopping EasyProject4...
if exist server\ep4.pid (
    python ep4_run_helper.py pid > _ep4oldpid.tmp 2>nul
    set /p EP4_OLD_PID=<_ep4oldpid.tmp
    del _ep4oldpid.tmp >nul 2>&1
    if defined EP4_OLD_PID (
        taskkill /PID %EP4_OLD_PID% /F >nul 2>&1
        echo Stopped - PID %EP4_OLD_PID%
    ) else (
        echo PID file exists but could not read PID.
    )
    del server\ep4.pid >nul 2>&1
) else (
    echo No running server found.
)
