@echo off
rem Double-click to run the server for friends who installed the APK. Works from any network while this laptop is on.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" -Server %*
pause
