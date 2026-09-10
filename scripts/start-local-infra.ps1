# Start portable Postgres + Redis from tools/ (no Docker, no admin install).
# Binaries live under tools/ (gitignored). Minecraft paths are unrelated.
#
# Usage (repo root):
#   .\scripts\start-local-infra.ps1
#   .\scripts\start-local-infra.ps1 -Stop
#
param([switch]$Stop)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tools = Join-Path $Root "tools"
$pgBin = Join-Path $tools "pgsql\bin"
$pgData = Join-Path $tools "pgsql-data"
$redisExe = Join-Path $tools "redis\redis-server.exe"

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if ($Stop) {
    Write-Step "Stopping local infra"
    if (Test-Path "$pgBin\pg_ctl.exe") {
        & "$pgBin\pg_ctl.exe" -D $pgData stop -m fast 2>$null
    }
    Get-Process redis-server -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Ok "Stopped"
    exit 0
}

if (-not (Test-Path $redisExe)) {
    Write-Fail "Missing $redisExe — download Redis portable into tools\redis first"
}
if (-not (Test-Path "$pgBin\postgres.exe")) {
    Write-Fail "Missing Postgres binaries under tools\pgsql — download EDB windows-x64-binaries.zip into tools\pgsql first"
}

$env:Path = "$pgBin;$env:Path"
$env:PGGSSENCMODE = "disable"

Write-Step "Redis"
if (-not (Test-NetConnection 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    Start-Process -FilePath $redisExe -ArgumentList "--port","6379","--bind","127.0.0.1" -WorkingDirectory (Split-Path $redisExe) -WindowStyle Hidden
    Start-Sleep -Seconds 1
}
if (-not (Test-NetConnection 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    Write-Fail "Redis failed to bind 127.0.0.1:6379"
}
$redisVer = & $redisExe --version 2>&1 | Out-String
if ($redisVer -match 'v=(\d+)\.(\d+)') {
    $maj = [int]$Matches[1]; $min = [int]$Matches[2]
    if ($maj -lt 6 -or ($maj -eq 6 -and $min -lt 2)) {
        Write-Fail "Redis $maj.$min is below 6.2 (BullMQ). Run: .\scripts\install-portable-redis.ps1 -Force"
    }
    Write-Ok "127.0.0.1:6379 ($maj.$min)"
} else {
    Write-Ok "127.0.0.1:6379"
}

Write-Step "Postgres"
if (-not (Test-Path "$pgData\PG_VERSION")) {
    New-Item -ItemType Directory -Force -Path $pgData | Out-Null
    & "$pgBin\initdb.exe" -D $pgData -U postgres --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C
}
if (-not (Test-NetConnection 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    $log = Join-Path $tools "pgsql.log"
    & "$pgBin\pg_ctl.exe" -D $pgData -l $log start
    for ($i = 0; $i -lt 30; $i++) {
        if ((Test-NetConnection 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) { break }
        Start-Sleep -Seconds 1
    }
}
if (-not (Test-NetConnection 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    Write-Fail "Postgres failed to bind 127.0.0.1:5432 (see tools\pgsql.log)"
}
Write-Ok "127.0.0.1:5432"

# Ensure app role + database (idempotent)
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -c @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mastermind') THEN
    CREATE ROLE mastermind LOGIN PASSWORD 'changeme';
  END IF;
END
`$`$;
"@
$exists = (& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mastermind'").Trim()
if ($exists -ne "1") {
    & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE mastermind OWNER mastermind"
}
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE mastermind TO mastermind" | Out-Null
Write-Ok "database mastermind / role mastermind"

Write-Host ""
Write-Host "DATABASE_URL=postgresql://mastermind:changeme@localhost:5432/mastermind"
Write-Host "REDIS_HOST=localhost  REDIS_PORT=6379"
