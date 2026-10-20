@echo off
rem Double-click to start everything and show the Expo Go QR code. Pass -Fresh to wipe the local dev database first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
pause
