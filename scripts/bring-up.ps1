# Mastermind — Windows bring-up for control plane + optional agent.
#
# Does not hardcode Minecraft paths. Agent paths come from agent/.env.agent.
#
# Usage (repo root):
#   .\scripts\bring-up.ps1                 # infra + CP + web
#   .\scripts\bring-up.ps1 -WithAgent      # also start agent (requires .env.agent)
#   .\scripts\bring-up.ps1 -SkipInstall    # skip pnpm/go install attempts
#
param(
    [switch]$WithAgent,
    [switch]$SkipInstall,
    [switch]$NoMigrate,
    # Use existing local Postgres/Redis (no Docker). Set DATABASE_URL / REDIS_* in control-plane\.env.
    [switch]$SkipDocker
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    !   $m" -ForegroundColor Yellow }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

function Ensure-Tool([string]$Name, [scriptblock]$Install) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) { Write-Ok "$Name found"; return }
    if ($SkipInstall) { Write-Fail "$Name not found (SkipInstall set)" }
    Write-Step "Installing $Name..."
    & $Install
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Write-Fail "$Name still not found after install attempt" }
    Write-Ok "$Name ready"
}

Write-Step "Checking tools"
# Prefer repo-local portable Go (tools/go) when system Go is missing
$portableGo = Join-Path $Root "tools\go\bin"
if ((Test-Path "$portableGo\go.exe") -and -not (Get-Command go -ErrorAction SilentlyContinue)) {
    $env:Path = "$portableGo;$env:Path"
    $env:GOROOT = Join-Path $Root "tools\go"
    Write-Ok "Using portable Go at tools\go"
}

Ensure-Tool "node" { Write-Fail "Install Node.js 20+ from https://nodejs.org/" }
Ensure-Tool "npm" { Write-Fail "npm missing (comes with Node.js)" }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    if (-not $SkipInstall) {
        Write-Step "Installing pnpm via npm..."
        npm install -g pnpm@9
    }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Write-Fail "pnpm not found. npm install -g pnpm@9" }
Write-Ok "pnpm $(pnpm --version)"

if (-not (Get-Command go -ErrorAction SilentlyContinue) -and -not $SkipInstall) {
    $portableGo = Join-Path $Root "tools\go\bin\go.exe"
    if (Test-Path $portableGo) {
        $env:Path = "$(Join-Path $Root 'tools\go\bin');$env:Path"
        $env:GOROOT = Join-Path $Root "tools\go"
        Write-Ok "Using portable Go"
    } else {
        Write-Step "Installing Go via winget (or download portable to tools\go)..."
        winget install -e --id GoLang.Go --accept-package-agreements --accept-source-agreements
        $goBin = "C:\Program Files\Go\bin"
        if (Test-Path "$goBin\go.exe") { $env:Path = "$goBin;$env:Path" }
    }
}
if (Get-Command go -ErrorAction SilentlyContinue) { Write-Ok "go $(go version)" } else { Write-Warn "go not found — agent build will be skipped until Go is installed" }

$useDocker = -not $SkipDocker
if ($useDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and -not $SkipInstall) {
        Write-Warn "Docker not found. Install Docker Desktop, then re-run. Attempting winget..."
        winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Warn "Docker unavailable — will try local Postgres/Redis on localhost (SkipDocker mode)."
        $useDocker = $false
    } else {
        Write-Ok "docker available"
    }
} else {
    Write-Ok "SkipDocker set — using local Postgres/Redis from control-plane\.env"
}

# Env files
Write-Step "Ensuring env files"
function Copy-IfMissing($src, $dst) {
    if (-not (Test-Path $dst)) {
        if (-not (Test-Path $src)) { Write-Warn "Missing $src"; return }
        Copy-Item $src $dst
        Write-Ok "Created $dst"
    } else { Write-Ok "$dst exists" }
}
Copy-IfMissing "$Root\infra\.env.example" "$Root\infra\.env"
Copy-IfMissing "$Root\control-plane\.env.example" "$Root\control-plane\.env"
Copy-IfMissing "$Root\web\.env.example" "$Root\web\.env.local"
Copy-IfMissing "$Root\agent\.env.agent.example" "$Root\agent\.env.agent"

# Bootstrap admin defaults for local bring-up if blank
$cpEnv = Join-Path $Root "control-plane\.env"
$cpText = Get-Content $cpEnv -Raw
if ($cpText -notmatch '(?m)^BOOTSTRAP_ADMIN_EMAIL=.+') {
    $cpText = $cpText -replace '(?m)^BOOTSTRAP_ADMIN_EMAIL=.*', 'BOOTSTRAP_ADMIN_EMAIL=admin@mastermind.local'
    $cpText = $cpText -replace '(?m)^BOOTSTRAP_ADMIN_PASSWORD=.*', 'BOOTSTRAP_ADMIN_PASSWORD=changeme-changeme'
    Set-Content $cpEnv $cpText -NoNewline
    Write-Ok "Set local bootstrap admin in control-plane\.env"
}
$infraEnv = Join-Path $Root "infra\.env"
$infraText = Get-Content $infraEnv -Raw
if ($infraText -notmatch '(?m)^BOOTSTRAP_ADMIN_EMAIL=.+') {
    Add-Content $infraEnv "`nBOOTSTRAP_ADMIN_EMAIL=admin@mastermind.local`nBOOTSTRAP_ADMIN_PASSWORD=changeme-changeme`nBOOTSTRAP_ADMIN_NAME=Administrator`n"
    Write-Ok "Set bootstrap admin in infra\.env"
}

Write-Step "Installing JS dependencies"
pnpm install
Push-Location "$Root\control-plane"; pnpm install; pnpm prisma generate; Pop-Location
Push-Location "$Root\web"; pnpm install; Pop-Location
Write-Ok "Dependencies ready"

if (Get-Command go -ErrorAction SilentlyContinue) {
    Write-Step "Building Windows agent"
    New-Item -ItemType Directory -Force -Path "$Root\control-plane\public\agents" | Out-Null
    Push-Location "$Root\agent"
    go build -o "$Root\agent\mastermind-agent.exe" .
    Copy-Item "$Root\agent\mastermind-agent.exe" "$Root\control-plane\public\agents\mastermind-agent-windows-amd64.exe" -Force
    Pop-Location
    Write-Ok "agent\mastermind-agent.exe"
}

if ($useDocker) {
    Write-Step "Starting Docker infra"
    Push-Location "$Root\infra"
    docker compose up -d postgres redis
    Pop-Location

    Write-Step "Waiting for Postgres"
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        try {
            docker compose -f "$Root\infra\docker-compose.yml" exec -T postgres pg_isready -U mastermind -d mastermind 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { Write-Warn "Postgres readiness check timed out — continuing" } else { Write-Ok "Postgres ready" }
} else {
    Write-Step "Local infra (no Docker)"
    $starter = Join-Path $Root "scripts\start-local-infra.ps1"
    if (Test-Path $starter) {
        & $starter
    }
    $tcpPg = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue
    $tcpRedis = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
    if (-not $tcpPg.TcpTestSucceeded) {
        Write-Fail "Postgres not listening on 127.0.0.1:5432. Run .\scripts\start-local-infra.ps1 or start Docker, then re-run."
    }
    if (-not $tcpRedis.TcpTestSucceeded) {
        Write-Fail "Redis not listening on 127.0.0.1:6379. Run .\scripts\start-local-infra.ps1 or start Docker, then re-run."
    }
    Write-Ok "Postgres :5432 and Redis :6379 reachable"
}

if (-not $NoMigrate) {
    Write-Step "Migrate + seed"
    Push-Location "$Root\control-plane"
    # Prefer migrate deploy; fall back to db push for fresh local DBs
    $mig = pnpm prisma migrate deploy 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "migrate deploy failed; trying db push"
        pnpm prisma db push --accept-data-loss
    }
    $env:BOOTSTRAP_ADMIN_EMAIL = "admin@mastermind.local"
    $env:BOOTSTRAP_ADMIN_PASSWORD = "changeme-changeme"
    pnpm prisma:seed
    Pop-Location
    Write-Ok "Database ready"
}

Write-Step "Starting control-plane and web (background)"
$cpLog = Join-Path $Root "cp.log"
$webLog = Join-Path $Root "web.log"
# pnpm is a .cmd/.ps1 shim — launch via cmd so Windows can start it reliably
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","pnpm dev > `"$cpLog`" 2>&1" -WorkingDirectory "$Root\control-plane" -WindowStyle Hidden
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","set NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:3001&& pnpm dev > `"$webLog`" 2>&1" -WorkingDirectory "$Root\web" -WindowStyle Hidden
Write-Ok "Control plane log — $cpLog"
Write-Ok "Web log — $webLog"

Write-Step "Waiting for API health"
$apiUp = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $apiUp = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}
if ($apiUp) { Write-Ok "API healthy" } else { Write-Warn "API not healthy yet — check cp.log" }

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Web UI : http://localhost:3000"
Write-Host "  API    : http://localhost:3001"
Write-Host "  Login  : admin@mastermind.local / changeme-changeme"
Write-Host ""
Write-Host "  Agent (configurable paths):"
Write-Host "    1. Edit agent\.env.agent  (set MASTERMIND_MC_INSTALL_PATH)"
Write-Host "    2. Create a pairing token in Hosts"
Write-Host "    3. Set MASTERMIND_PAIRING_TOKEN in agent\.env.agent"
Write-Host "    4. .\scripts\run-agent.ps1"
Write-Host "=============================================" -ForegroundColor Green

if ($WithAgent) {
    Write-Step "Starting agent"
    & "$Root\scripts\run-agent.ps1"
}

Write-Host "Dev servers writing to cp.log / web.log (stop via Task Manager or by closing the node processes)."
