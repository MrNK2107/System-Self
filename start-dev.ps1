# Starts everything for testing on a phone with Expo Go, then shows the QR code to scan.
#   .\start-dev.ps1          start (keeps existing data)
#   .\start-dev.ps1 -Fresh   wipe the local dev database first, so you are the first user
# Optional: set $env:GEMINI_API_KEY before running for real AI text (otherwise template text).
param([switch]$Fresh)
# Not "Stop": Windows PowerShell treats any stderr line from docker/pnpm as an error. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
Set-Location $root
$dbUrl = "postgres://system_self:system_self@localhost:5432/system_self"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# 1. Docker
Step "Checking Docker"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting Docker Desktop..."
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep 3
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
  if ($LASTEXITCODE -ne 0) { throw "Docker did not start. Open Docker Desktop and run this again." }
}

# 2. Postgres
Step "Starting Postgres"
if ($Fresh) {
  Write-Host "Wiping the local dev database (-Fresh)" -ForegroundColor Yellow
  docker compose down -v
}
docker compose up -d postgres
for ($i = 0; $i -lt 30; $i++) {
  docker compose exec -T postgres pg_isready *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 2
}
if ($LASTEXITCODE -ne 0) { throw "Postgres did not become ready." }

# 3. Migrations
Step "Applying migrations"
$env:DATABASE_URL = $dbUrl
pnpm --filter @workspace/db migrate
if ($LASTEXITCODE -ne 0) { throw "Migrations failed." }

# 4. API and worker, each in its own window (skipped if the API is already running)
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
  Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { throw "No Wi-Fi/LAN address found. Connect to the same network as your phone." }

$gemini = if ($env:GEMINI_API_KEY) { "`$env:GEMINI_API_KEY='$($env:GEMINI_API_KEY)'; " } else { "" }
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
  Step "API already running on port 3001"
} else {
  Step "Starting the API and the worker in new windows"
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='System-Self API'; `$env:DATABASE_URL='$dbUrl'; $gemini pnpm --filter @workspace/api-server dev"
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='System-Self worker'; `$env:DATABASE_URL='$dbUrl'; $gemini pnpm --filter @workspace/api-server dev:worker"
}
Write-Host "Waiting for the API..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest "http://localhost:3001/api/readyz" -UseBasicParsing -TimeoutSec 2 *> $null; $ready = $true; break } catch { Start-Sleep 2 }
}
if (-not $ready) { throw "The API did not start. Check the 'System-Self API' window." }

# 5. Firewall: the phone must reach port 3001 (needs admin once)
$nodeAllowed = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like "*\node.exe" } |
  Get-NetFirewallRule | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Allow" -and $_.Enabled -eq "True" }
if (-not $nodeAllowed -and -not (Get-NetFirewallRule -DisplayName "System-Self API 3001" -ErrorAction SilentlyContinue)) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("Administrator")
  if ($admin) {
    New-NetFirewallRule -DisplayName "System-Self API 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Any | Out-Null
  } else {
    Write-Host "If the phone can't connect, run this once as administrator to open port 3001 in the firewall." -ForegroundColor Yellow
  }
}

# 6. Expo
Step "Starting Expo. Scan the QR code with Expo Go (phone on the same Wi-Fi)"
Write-Host "API for the phone: http://${ip}:3001"
Write-Host "Email codes appear in the 'System-Self API' window."
$env:EXPO_PUBLIC_API_URL = "http://${ip}:3001"
Set-Location "$root\artifacts\system-self"
pnpm exec expo start --go --lan
