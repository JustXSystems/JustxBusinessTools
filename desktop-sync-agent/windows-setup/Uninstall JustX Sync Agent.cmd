@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  JustX Sync Agent - Uninstall
echo  ============================
echo.

set "INSTALL=%LOCALAPPDATA%\JustX\sync-agent"
set "TASKNAME=JustX Sync Agent"

echo  Stopping agent and removing auto-start...
schtasks /Delete /TN "%TASKNAME%" /F >nul 2>&1
call "%~dp0windows-stop-bridge.cmd" >nul 2>&1
if exist "%INSTALL%\windows-stop-bridge.cmd" call "%INSTALL%\windows-stop-bridge.cmd" >nul 2>&1

if exist "%INSTALL%" (
  rmdir /S /Q "%INSTALL%" 2>nul
  if exist "%INSTALL%" (
    echo  Could not fully remove %INSTALL%
    echo  Close Sync Center / agent windows and try again, or delete the folder manually.
  ) else (
    echo  Removed %INSTALL%
  )
) else (
  echo  Install folder was already gone.
)

echo.
echo  Done. In Sync Center you can Revoke the old agent token if it should not be reused.
echo.
pause
endlocal
exit /b 0
