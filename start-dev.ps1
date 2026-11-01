# Starts everything for testing on a phone with Expo Go, then shows the QR code to scan.
#   .\start-dev.ps1          start (keeps existing data)
#   .\start-dev.ps1 -Fresh   wipe the local dev database first, so you are the first user
#   .\start-dev.ps1 -Share   reachable from anywhere: the API goes out through a Cloudflare quick tunnel and
#                            Expo through its own tunnel, so friends on other networks can scan the QR code too
#   .\start-dev.ps1 -Model qwen2.5:7b   another local Ollama model for AI text (default gemma4:latest; "none" = Gemini/templates)
# Optional: set $env:GEMINI_API_KEY before running for voice logs (and for AI text when -Model none).
param([switch]$Fresh, [switch]$Share, [string]$Model = "gemma4:latest")
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
if (-not $ip -and -not $Share) { throw "No Wi-Fi/LAN address found. Connect to the same network as your phone." }

$gemini = if ($env:GEMINI_API_KEY) { "`$env:GEMINI_API_KEY='$($env:GEMINI_API_KEY)'; " } else { "" }

# Local LLM through Ollama on this laptop's GPU (text only; voice logs still need GEMINI_API_KEY).
$ollama = ""
if ($Model -ne "none") {
  Step "Loading $Model into the GPU (Ollama)"
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw "Ollama is not installed. Install it from https://ollama.com or pass -Model none." }
  try { Invoke-WebRequest "http://127.0.0.1:11434/api/version" -UseBasicParsing -TimeoutSec 2 *> $null }
  catch {
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep 3
  }
  # Same num_ctx as the API (OLLAMA_NUM_CTX), so the first real request does not reload the model.
  $warm = @{ model = $Model; prompt = "ok"; stream = $false; keep_alive = -1; options = @{ num_predict = 1; num_ctx = 8192 } } | ConvertTo-Json
  try { Invoke-RestMethod "http://127.0.0.1:11434/api/generate" -Method Post -Body $warm -ContentType "application/json" -TimeoutSec 180 | Out-Null }
  catch { throw "Ollama could not load $Model. Run 'ollama pull $Model' and try again." }
  ollama ps | Out-Host
  $ollama = "`$env:OLLAMA_MODEL='$Model'; "
}
$shareEnv = ""
if ($Share) {
  # The built-in dev JWT secret is public, so a server on the internet signs with a private one instead.
  # Kept in a gitignored file so friends stay signed in across restarts.
  $secretFile = Join-Path $root ".share-jwt-secret"
  if (-not (Test-Path $secretFile)) {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-Content -Path $secretFile -Value ([Convert]::ToBase64String($bytes)) -NoNewline -Encoding ascii
  }
  $secret = (Get-Content $secretFile -Raw).Trim()
  # One proxy hop (cloudflared) in front: rate limits then key on each friend's IP, not the tunnel's.
  $shareEnv = "`$env:JWT_SECRET='$secret'; `$env:TRUST_PROXY='1'; "
}
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
  Step "API already running on port 3001"
  if ($Share) { Write-Host "Close the 'System-Self API' and 'System-Self worker' windows and run this again if they were not started with -Share." -ForegroundColor Yellow }
} else {
  Step "Starting the API and the worker in new windows"
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='System-Self API'; `$env:DATABASE_URL='$dbUrl'; $gemini$ollama$shareEnv pnpm --filter @workspace/api-server dev"
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle='System-Self worker'; `$env:DATABASE_URL='$dbUrl'; $gemini$ollama$shareEnv pnpm --filter @workspace/api-server dev:worker"
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

if ($Share) {
  # 6. Public tunnel for the API (Cloudflare quick tunnel: no account, new URL each run)
  Step "Opening a public tunnel to the API"
  $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $cf) {
    Write-Host "Installing cloudflared..."
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
    $cf = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
      "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $cf) { throw "cloudflared is not installed. Install it (winget install Cloudflare.cloudflared) and run this again." }
  }
  $cfLog = Join-Path $env:TEMP "system-self-cloudflared.log"
  Remove-Item $cfLog -ErrorAction SilentlyContinue
  # http2 over TCP 443: many Wi-Fi networks block the default QUIC (UDP 7844) and the tunnel never connects.
  $tunnel = Start-Process $cf -ArgumentList "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://localhost:3001" `
    -RedirectStandardError $cfLog -WindowStyle Hidden -PassThru
  $publicApi = $null
  for ($i = 0; $i -lt 30 -and -not $publicApi; $i++) {
    Start-Sleep 1
    $m = Select-String -Path $cfLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $publicApi = $m.Matches[0].Value }
  }
  function Wait-Public($url, $tries) {
    for ($i = 0; $i -lt $tries; $i++) {
      try { Invoke-WebRequest "$url/api/readyz" -UseBasicParsing -TimeoutSec 5 *> $null; return $true } catch { Start-Sleep 2 }
    }
    return $false
  }
  $ready = $false
  if ($publicApi) {
    Write-Host "Waiting for $publicApi to answer..."
    $ready = Wait-Public $publicApi 20
  }
  if (-not $ready) {
    # cloudflared dials Cloudflare's edge on port 7844 by IPv4 address, which fails on IPv6-only (NAT64) Wi-Fi and on
    # networks that block 7844. localhost.run is a plain SSH tunnel by hostname over port 22, which gets through those.
    Stop-Process $tunnel -ErrorAction SilentlyContinue
    Write-Host "Cloudflare tunnel could not connect (see $cfLog); using localhost.run over SSH instead." -ForegroundColor Yellow
    $sshLog = Join-Path $env:TEMP "system-self-localhostrun.log"
    Remove-Item $sshLog -ErrorAction SilentlyContinue
    # Through cmd so ssh gets a console of its own: with a closed stdin localhost.run never sends the URL.
    $tunnel = Start-Process cmd -ArgumentList "/c", "ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R 80:localhost:3001 nokey@localhost.run > `"$sshLog`" 2>&1" `
      -WindowStyle Hidden -PassThru
    $publicApi = $null
    for ($i = 0; $i -lt 30 -and -not $publicApi; $i++) {
      Start-Sleep 1
      $m = Select-String -Path $sshLog -Pattern "https://[a-z0-9]+\.lhr\.life" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $publicApi = $m.Matches[0].Value }
    }
    if (-not $publicApi) { taskkill /T /F /PID $tunnel.Id *> $null; throw "No public tunnel could be opened. See $cfLog and $sshLog" }
    Write-Host "Waiting for $publicApi to answer..."
    if (-not (Wait-Public $publicApi 15)) { Write-Host "The tunnel is up but not answering yet." -ForegroundColor Yellow }
  }

  # 7. Expo through its own tunnel
  Step "Starting Expo. Send the QR code (or the exp:// link) to your friends; they open it in Expo Go"
  Write-Host "Public API: $publicApi"
  Write-Host "Sign-up email codes appear in the 'System-Self API' window: pass them on to your friends."
  Write-Host "Everything stays up only while this window and the API/worker windows stay open."
  $env:EXPO_PUBLIC_API_URL = $publicApi
  Set-Location "$root\artifacts\system-self"
  try { pnpm exec expo start --go --tunnel } finally { taskkill /T /F /PID $tunnel.Id *> $null }
  return
}

# 6. Expo
Step "Starting Expo. Scan the QR code with Expo Go (phone on the same Wi-Fi)"
Write-Host "API for the phone: http://${ip}:3001"
Write-Host "Email codes appear in the 'System-Self API' window."
$env:EXPO_PUBLIC_API_URL = "http://${ip}:3001"
Set-Location "$root\artifacts\system-self"
pnpm exec expo start --go --lan
