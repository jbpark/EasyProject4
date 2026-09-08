@echo off
cd /d "%~dp0"

set PORT=%1
if "%PORT%"=="" set PORT=7788

where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] cloudflared is not installed or not in PATH.
    echo   Install: winget install --id Cloudflare.cloudflared
    echo   After install, open a NEW terminal so PATH is refreshed.
    pause
    exit /b 1
)

netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [WARN] No EP4 server is listening on port %PORT%.
    echo        It is recommended to start the server first with run.bat.
    echo.
)

if exist tunnel.url del tunnel.url

echo Starting Cloudflare temporary tunnel ^(http://localhost:%PORT%^)
echo   - Enter the https://xxxx.trycloudflare.com URL below into the mobile app.
echo   - The URL will be saved to tunnel.url automatically.
echo   - Closing this window will stop the tunnel. ^(Ctrl+C to quit^)
echo.

cloudflared tunnel --url http://localhost:%PORT% 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { Write-Host $_; if ($_ -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0]; \"[InternetShortcut]`r`nURL=$url\" | Set-Content -Encoding ascii 'tunnel.url'; Write-Host \"[OK] URL saved to tunnel.url: $url\" -ForegroundColor Green; & python ep4_firebase_push.py $url } }"

pause
