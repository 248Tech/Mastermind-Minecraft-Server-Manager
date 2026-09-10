# Restart Mastermind local stack (portable Postgres/Redis + CP + web + optional agent).
#
# Usage (repo root):
#   .\scripts\restart-stack.ps1
#   .\scripts\restart-stack.ps1 -WithAgent
#   .\scripts\restart-stack.ps1 -SkipInfra
#
param(
    [switch]$WithAgent,
    [switch]$SkipInfra
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$env:Path = "$(Join-Path $env:APPDATA 'npm');$env:Path"

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    !   $m" -ForegroundColor Yellow }

function Stop-ListenPort([int]$Port) {
    $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    foreach ($line in $lines) {
        $procId = ($line.ToString() -split '\s+')[-1]
        if ($procId -match '^\d+$' -and [int]$procId -gt 0) {
            Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
            Write-Ok "stopped PID $procId on :$Port"
        }
    }
}

Write-Step "Stopping control-plane / web / agent"
Stop-ListenPort 3000
Stop-ListenPort 3001
Get-Process mastermind-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if (-not $SkipInfra) {
    Write-Step "Ensuring local Postgres + Redis"
    $starter = Join-Path $Root "scripts\start-local-infra.ps1"
    if (Test-Path $starter) {
        & $starter
    } else {
        Write-Warn "start-local-infra.ps1 missing"
    }
}

Write-Step "Starting control-plane and web"
$cpLog = Join-Path $Root "cp.log"
$webLog = Join-Path $Root "web.log"
# Rotate previous logs so a locked handle from a killed process cannot block startup.
foreach ($log in @($cpLog, $webLog)) {
    if (Test-Path $log) {
        Move-Item $log "$log.prev" -Force -ErrorAction SilentlyContinue
    }
}
$cpCmd = "pnpm dev > `"$cpLog`" 2>&1"
$webCmd = "set NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:3001&& pnpm dev > `"$webLog`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cpCmd -WorkingDirectory (Join-Path $Root "control-plane") -WindowStyle Hidden
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $webCmd -WorkingDirectory (Join-Path $Root "web") -WindowStyle Hidden

Write-Step "Waiting for API health"
$apiUp = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            $apiUp = $true
            break
        }
    } catch {
        # keep waiting
    }
    Start-Sleep -Seconds 2
}
if ($apiUp) {
    Write-Ok "API http://127.0.0.1:3001/health"
} else {
    Write-Warn "API not healthy yet - check cp.log"
}

if ($WithAgent) {
    Write-Step "Starting agent"
    $agentEnv = Join-Path $Root "agent\.env.agent"
    if (-not (Test-Path $agentEnv)) {
        Write-Warn "agent\.env.agent missing - copy from agent\.env.agent.example first"
    } else {
        $runAgent = Join-Path $Root "scripts\run-agent.ps1"
        Start-Process -FilePath "powershell.exe" -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $runAgent
        ) -WorkingDirectory $Root -RedirectStandardOutput (Join-Path $Root "agent.log") -RedirectStandardError (Join-Path $Root "agent.err.log") -WindowStyle Hidden
        Write-Ok "agent started (agent.log / agent.err.log)"
    }
}

Write-Host ""
Write-Host "Web http://localhost:3000  API http://localhost:3001" -ForegroundColor Green
