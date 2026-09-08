@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "JBT_CONFIG=%~dp0config.json"
set "LOG=%~dp0agent.log"

if not exist "%~dp0runtime\node.exe" (
  echo [%date% %time%] runtime\node.exe missing>> "%LOG%"
  exit /b 1
)
if not exist "%~dp0app\src\index.js" (
  echo [%date% %time%] app\src\index.js missing>> "%LOG%"
  exit /b 1
)
if not exist "%JBT_CONFIG%" (
  echo [%date% %time%] config.json missing>> "%LOG%"
  exit /b 1
)

echo [%date% %time%] Starting JustX sync agent>> "%LOG%"
"%~dp0runtime\node.exe" "%~dp0app\src\index.js" >> "%LOG%" 2>&1
endlocal
