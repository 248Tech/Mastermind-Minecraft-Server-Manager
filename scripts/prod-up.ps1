# Bring up production Docker stack (Postgres, Redis, control-plane, web).
# Agent always runs on the game host — never inside this compose file.
#
# Usage (repo root):
#   .\scripts\prod-up.ps1
#   .\scripts\prod-up.ps1 -Build
#   .\scripts\prod-up.ps1 -WithCloudflared   # requires infra/secrets/cloudflare_tunnel_token
#   .\scripts\prod-up.ps1 -WithDiscordBot
#
param(
    [switch]$Build,
    [switch]$WithCloudflared,
    [switch]$WithDiscordBot,
    [switch]$Migrate
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Infra = Join-Path $Root "infra"
Set-Location $Infra

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker not found. Install Docker Desktop / Engine, or use .\scripts\bring-up.ps1 -SkipDocker for local portable infra."
}

$envFile = Join-Path $Infra ".env"
$example = Join-Path $Infra ".env.example"
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $example)) { Write-Fail "Missing infra/.env.example" }
    Copy-Item $example $envFile
    Write-Ok "Created infra/.env from example — edit secrets before exposing publicly"
}

$profiles = @()
if ($WithDiscordBot) { $profiles += "discord-bot" }
if ($WithCloudflared) {
    $tokenPath = Join-Path $Infra "secrets\cloudflare_tunnel_token"
    if (-not (Test-Path $tokenPath)) {
        Write-Fail "Missing $tokenPath (write the tunnel token as file contents, no newline required)"
    }
    $profiles += "cloudflared"
}

$composeArgs = @("compose", "--env-file", ".env", "-f", "docker-compose.yml")
foreach ($p in $profiles) { $composeArgs += @("--profile", $p) }

Write-Step "docker compose up"
$upArgs = $composeArgs + @("up", "-d")
if ($Build) { $upArgs += "--build" }
& docker @upArgs
if ($LASTEXITCODE -ne 0) { Write-Fail "docker compose up failed" }
Write-Ok "stack starting"

if ($Migrate) {
    Write-Step "Prisma migrate deploy (control-plane container)"
    & docker @composeArgs exec -T control-plane sh -c "npx prisma migrate deploy"
    if ($LASTEXITCODE -ne 0) { Write-Fail "migrate deploy failed" }
    Write-Ok "migrations applied"
}

Write-Step "Health"
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
}
if ($healthy) { Write-Ok "control-plane healthy" } else { Write-Fail "control-plane health timed out — docker compose logs control-plane" }

Write-Host ""
Write-Host "Production stack is up (bind address from infra/.env)." -ForegroundColor Green
Write-Host "Pair a host agent next: copy agent/.env.agent.example, set MASTERMIND_MC_INSTALL_PATH + pairing token, run scripts/run-agent.ps1"
Write-Host "Docs: docs/production-deploy.md"
