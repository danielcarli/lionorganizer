@echo off
chcp 65001 >nul
title LionOrganizer - build installer
cd /d "%~dp0"

if not exist "node_modules\electron" call npm install
echo Building the installer and the portable version into .\dist ...
call npm run dist
echo.
echo Done. See the "dist" folder.
pause
