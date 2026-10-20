@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/3] installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [2/3] building...
call npm run build
if errorlevel 1 (
  echo build failed.
  pause
  exit /b 1
)

echo [3/3] server on http://127.0.0.1:8080
echo.
echo   sim   : http://127.0.0.1:8080/sim/
echo   phone : plug in USB, run connect-phone.bat, open http://127.0.0.1:8080/tx/
echo.
echo   keyboard fallback: W/S throttle, arrows pitch/roll, A/D yaw, Space arm
echo.

start "" "http://127.0.0.1:8080/sim/"
node dist\server.js

echo.
echo server stopped.
pause
