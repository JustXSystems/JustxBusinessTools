@echo off
rem Best-effort: stop process listening on 17865 (JustX sync bridge)
setlocal
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":17865 .*LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)
endlocal
exit /b 0
