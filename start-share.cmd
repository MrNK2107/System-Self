@echo off
rem Double-click to start everything with public tunnels, so friends on other networks can use the app in Expo Go.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" -Share %*
pause
