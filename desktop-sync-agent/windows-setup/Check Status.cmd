@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  JustX Sync Agent - Status
echo  =========================
echo.

set "INSTALL=%LOCALAPPDATA%\JustX\sync-agent"
set "NODE=%~dp0runtime\node.exe"
if exist "%INSTALL%\runtime\node.exe" set "NODE=%INSTALL%\runtime\node.exe"

if not exist "%NODE%" (
  echo  Portable Node not found. Re-download setup from Sync Center.
  echo.
  pause
  exit /b 1
)

"%NODE%" -e "fetch('http://127.0.0.1:17865/health').then(async r=>{const j=await r.json();console.log('Bridge: Connected');console.log(JSON.stringify(j,null,2));}).catch(e=>{console.log('Bridge: Not connected');console.log(String(e&&e.message||e));process.exitCode=1;})"

echo.
schtasks /Query /TN "JustX Sync Agent" >nul 2>&1
if errorlevel 1 (
  echo  Auto-start task: not registered
) else (
  echo  Auto-start task: registered
  schtasks /Query /TN "JustX Sync Agent" /FO LIST | findstr /I "Status TaskName Next"
)

echo.
if exist "%INSTALL%\config.json" (
  echo  Install folder: %INSTALL%
) else (
  echo  Install folder: not found under LocalAppData
)

echo.
pause
endlocal
exit /b 0
