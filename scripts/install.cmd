@echo off
rem ---------------------------------------------------------------------------------------------
rem  LionOrganizer - Copyright (C) 2026 LionOrganizer Team.
rem  Created and conceived by Daniel Michelon De Carli.
rem  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
rem ---------------------------------------------------------------------------------------------
rem  Double-click installer for Windows: runs install.ps1 (next to this file, or the one published
rem  in the latest GitHub release). install.ps1 verifies everything it downloads.
setlocal
title LionOrganizer installer
set "PS=powershell.exe -NoProfile -ExecutionPolicy Bypass"

if exist "%~dp0install.ps1" (
  %PS% -File "%~dp0install.ps1" %*
) else (
  %PS% -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f=Join-Path $env:TEMP 'lionorganizer-install.ps1'; Invoke-WebRequest -UseBasicParsing 'https://github.com/danielcarli/lionorganizer/releases/latest/download/install.ps1' -OutFile $f; & $f"
)
echo.
pause
