# Install (or remove) a Windows Scheduled Task that starts the Mastermind agent at boot.
# Prefer this over an interactive console window on production game hosts.
#
# Usage (repo root, elevated PowerShell recommended for AtStartup):
#   .\scripts\install-agent-service.ps1
#   .\scripts\install-agent-service.ps1 -Remove
#   .\scripts\install-agent-service.ps1 -TaskName "MastermindAgent-ATM10"
#
param(
    [string]$TaskName = "MastermindMinecraftAgent",
    [switch]$Remove,
    [switch]$AtLogOn
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runAgent = Join-Path $Root "scripts\run-agent.ps1"
$agentEnv = Join-Path $Root "agent\.env.agent"

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if ($Remove) {
    Write-Step "Removing scheduled task $TaskName"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Ok "removed (if it existed)"
    exit 0
}

if (-not (Test-Path $runAgent)) { Write-Fail "Missing $runAgent" }
if (-not (Test-Path $agentEnv)) {
    Write-Fail "Missing agent\.env.agent — copy agent\.env.agent.example and set MASTERMIND_MC_INSTALL_PATH + pairing token first"
}

Write-Step "Registering scheduled task $TaskName"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$runAgent`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $Root
if ($AtLogOn) {
    $trigger = New-ScheduledTaskTrigger -AtLogOn
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Ok "task registered"

Write-Step "Starting task once"
Start-ScheduledTask -TaskName $TaskName
Write-Ok "started"

Write-Host ""
Write-Host "Agent should connect shortly. Check Hosts in the web UI and agent.err.log." -ForegroundColor Green
Write-Host "Remove later with: .\scripts\install-agent-service.ps1 -Remove"
