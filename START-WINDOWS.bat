@echo off
title Cloudlead Infra Store (local)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Please install the "LTS" version from https://nodejs.org and run this file again.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing for the first time. This takes a minute or two...
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

if not exist .env copy .env.example .env >nul
if not exist data\cloudlead-infra.sqlite call npm run db:reset

echo.
echo Starting... your browser will open at http://localhost:4000
echo Keep this window open while you use the app. Close it to stop.
echo.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:4000"
call npm start
pause
