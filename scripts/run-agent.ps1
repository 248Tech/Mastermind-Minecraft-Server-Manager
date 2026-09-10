# Mastermind — configure + run the host agent against a Minecraft install.
#
# Paths are NEVER hardcoded. Set them via environment or agent/.env.agent
# (copy from agent/.env.agent.example).
#
# Usage (from repo root):
#   # 1) Fill agent/.env.agent (or export MASTERMIND_* vars)
#   # 2) Get a pairing token from the dashboard (Hosts → Pair)
#   # 3) Run:
#   .\scripts\run-agent.ps1
#   .\scripts\run-agent.ps1 -ConfigPath .\agent\config.local.yaml
#
param(
    [string]$ConfigPath = "",
    [string]$EnvFile = "",
    [switch]$SkipDiscovery
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
        if ($key) { Set-Item -Path "Env:$key" -Value $val }
    }
}

if (-not $EnvFile) { $EnvFile = Join-Path $Root "agent\.env.agent" }
Import-DotEnv $EnvFile

$portableGoBin = Join-Path $Root "tools\go\bin"
if ((Test-Path "$portableGoBin\go.exe") -and -not (Get-Command go -ErrorAction SilentlyContinue)) {
    $env:Path = "$portableGoBin;$env:Path"
    $env:GOROOT = Join-Path $Root "tools\go"
}

$hasPrebuilt = (Test-Path (Join-Path $Root "control-plane\public\agents\mastermind-agent-windows-amd64.exe")) -or (Test-Path (Join-Path $Root "agent\mastermind-agent.exe"))
if (-not (Get-Command go -ErrorAction SilentlyContinue) -and -not $hasPrebuilt) {
    Write-Fail "Go not found and no prebuilt agent binary. Install Go, place portable Go in tools\go, or run .\scripts\bring-up.ps1 first."
}

$installPath = $env:MASTERMIND_MC_INSTALL_PATH
if (-not $installPath) {
    Write-Fail "Set MASTERMIND_MC_INSTALL_PATH to your Minecraft server root (contains server.properties)."
}
if (-not (Test-Path $installPath)) {
    Write-Fail "MASTERMIND_MC_INSTALL_PATH does not exist: $installPath"
}
$props = if ($env:MASTERMIND_MC_SERVER_PROPERTIES) { $env:MASTERMIND_MC_SERVER_PROPERTIES } else { Join-Path $installPath "server.properties" }
if (-not (Test-Path $props)) {
    Write-Fail "server.properties not found at $props"
}

$cpUrl = if ($env:MASTERMIND_CP_URL) { $env:MASTERMIND_CP_URL } else { "http://127.0.0.1:3001" }
$token = $env:MASTERMIND_PAIRING_TOKEN
$keyPath = if ($env:MASTERMIND_KEY_PATH) { $env:MASTERMIND_KEY_PATH } else { Join-Path $Root "agent\data\agent.key" }
New-Item -ItemType Directory -Force -Path (Split-Path $keyPath) | Out-Null

$hasKey = (Test-Path $keyPath) -and ((Get-Item $keyPath).Length -gt 0)
if (-not $hasKey -and -not $token) {
    Write-Fail "No agent key yet. Set MASTERMIND_PAIRING_TOKEN from the dashboard (Hosts → Pair agent)."
}

if (-not $SkipDiscovery) {
    $env:MASTERMIND_MC_DISCOVERY_ENABLED = "true"
    $env:MASTERMIND_DISCOVERY_ENABLED = "true"
}

$env:MASTERMIND_CP_URL = $cpUrl
$env:MASTERMIND_MC_INSTALL_PATH = $installPath
if ($env:MASTERMIND_MC_SERVER_PROPERTIES) { } else { $env:MASTERMIND_MC_SERVER_PROPERTIES = $props }
if ($token) { $env:MASTERMIND_PAIRING_TOKEN = $token }
$env:MASTERMIND_KEY_PATH = $keyPath

Write-Step "Control plane: $cpUrl"
Write-Step "Minecraft install: $installPath"
Write-Ok "server.properties: $props"

$agentExe = Join-Path $Root "control-plane\public\agents\mastermind-agent-windows-amd64.exe"
$localExe = Join-Path $Root "agent\mastermind-agent.exe"

if (-not (Test-Path $agentExe) -and -not (Test-Path $localExe)) {
    Write-Step "Building Windows agent..."
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) { Write-Fail "go is required to build the agent" }
    Push-Location (Join-Path $Root "agent")
    go build -o $localExe .
    Pop-Location
    Write-Ok "Built $localExe"
}

$bin = if (Test-Path $localExe) { $localExe } elseif (Test-Path $agentExe) { $agentExe } else { Write-Fail "No agent binary" }

if ($ConfigPath -and (Test-Path $ConfigPath)) {
    Write-Step "Starting agent with config $ConfigPath"
    & $bin -config $ConfigPath
} else {
    # Env-driven run: write a minimal ephemeral config that only points at CP + key path.
    $tmp = Join-Path $Root "agent\data\runtime-config.yaml"
    @"
control_plane_url: "$cpUrl"
pairing_token: "$token"
agent_key_path: "$($keyPath -replace '\\','/')"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
  max_concurrent_reads: 8
discovery:
  enabled: true
  minecraft:
    enabled: true
    install_path: "$($installPath -replace '\\','/')"
"@ | Set-Content -Path $tmp -Encoding utf8
    Write-Step "Starting agent (env + generated config)"
    & $bin -config $tmp
}
