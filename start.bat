@echo off
chcp 65001 >nul
title LionOrganizer
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo  Install the LTS version from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing dependencies (first run only, this may take a few minutes^)...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

call npm start
