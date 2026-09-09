@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  JustX Sync Agent - Install
echo  ==========================
echo.

if not exist "%~dp0config.json" (
  echo  ERROR: config.json is missing.
  echo  Please use the setup zip downloaded from Sync Center
  echo  ^(Download setup for this PC^), then try again.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0runtime\node.exe" (
  echo  ERROR: runtime\node.exe is missing. Re-download the setup zip.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0app\src\index.js" (
  echo  ERROR: app\src\index.js is missing. Re-download the setup zip.
  echo.
  pause
  exit /b 1
)

set "INSTALL=%LOCALAPPDATA%\JustX\sync-agent"
set "TASKNAME=JustX Sync Agent"

echo  Installing to:
echo    %INSTALL%
echo.

if exist "%INSTALL%\run-agent.cmd" (
  echo  Stopping any previous agent...
  call "%~dp0windows-stop-bridge.cmd" >nul 2>&1
)

mkdir "%INSTALL%" >nul 2>&1
mkdir "%INSTALL%\runtime" >nul 2>&1
mkdir "%INSTALL%\app" >nul 2>&1
mkdir "%INSTALL%\app\src" >nul 2>&1

copy /Y "%~dp0config.json" "%INSTALL%\config.json" >nul
copy /Y "%~dp0runtime\node.exe" "%INSTALL%\runtime\node.exe" >nul
copy /Y "%~dp0app\package.json" "%INSTALL%\app\package.json" >nul
copy /Y "%~dp0app\src\index.js" "%INSTALL%\app\src\index.js" >nul
copy /Y "%~dp0run-agent.cmd" "%INSTALL%\run-agent.cmd" >nul
copy /Y "%~dp0Uninstall JustX Sync Agent.cmd" "%INSTALL%\Uninstall JustX Sync Agent.cmd" >nul
copy /Y "%~dp0Check Status.cmd" "%INSTALL%\Check Status.cmd" >nul
if exist "%~dp0windows-stop-bridge.cmd" copy /Y "%~dp0windows-stop-bridge.cmd" "%INSTALL%\windows-stop-bridge.cmd" >nul

echo  Creating auto-start ^(at Windows sign-in^)...
schtasks /Delete /TN "%TASKNAME%" /F >nul 2>&1
schtasks /Create /TN "%TASKNAME%" /SC ONLOGON /RL LIMITED /F /TR "\"%INSTALL%\run-agent.cmd\"" >nul 2>&1
if errorlevel 1 (
  schtasks /Create /TN "%TASKNAME%" /SC ONLOGON /RL LIMITED /F /TR "%ComSpec% /c \"%INSTALL%\run-agent.cmd\"" >nul 2>&1
)
if errorlevel 1 (
  echo  Scheduled Task could not be created ^(policy^). Adding Startup shortcut instead...
  powershell -NoProfile -Command "$install='%~dp0'; $install=$env:LOCALAPPDATA+'\JustX\sync-agent'; $s=[Environment]::GetFolderPath('Startup'); $p=Join-Path $s 'JustX Sync Agent.lnk'; $w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut($p); $l.TargetPath=$env:ComSpec; $l.Arguments='/c \"\"'+$install+'\run-agent.cmd\"\"'; $l.WindowStyle=7; $l.WorkingDirectory=$install; $l.Save()"
) else (
  rem Remove legacy Startup shortcut if task succeeded
  del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\JustX Sync Agent.lnk" >nul 2>&1
)

echo  Starting agent...
start "" /MIN "%INSTALL%\run-agent.cmd"

rem Give the bridge a moment
timeout /t 3 /nobreak >nul

"%INSTALL%\runtime\node.exe" -e "fetch('http://127.0.0.1:17865/health').then(r=>r.json()).then(j=>{console.log('AGENT_VERSION='+j.version);console.log('PACK_VERSION='+(j.packVersion||''));if(!j.ok)process.exit(2);if(!j.version)process.exit(3)}).catch(()=>process.exit(2))"
if errorlevel 1 (
  echo.
  echo  Agent was started, but Sync Center may still show Not connected.
  echo  Wait a few seconds, then refresh Sync Center.
  echo  Log file: %INSTALL%\agent.log
) else (
  echo.
  echo  SUCCESS. The agent is running on this PC.
  echo  Confirm AGENT_VERSION above is 1.1.3 or newer for Outlook HTML.
  echo  Go back to Sync Center in your browser - it should show Connected.
  echo  You can close this window.
)

echo.
pause
endlocal
exit /b 0
