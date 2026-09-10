# Download Redis 7.x portable binaries into tools/redis (gitignored).
# BullMQ requires Redis >= 6.2; the old tporadowski 5.0.x build triggers warnings.
#
# Usage (repo root):
#   .\scripts\install-portable-redis.ps1
#   .\scripts\install-portable-redis.ps1 -Force
#
param([switch]$Force)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dest = Join-Path $Root "tools\redis"
$zipName = "Redis-7.0.15-Windows-x64-msys2.zip"
$url = "https://github.com/redis-windows/redis-windows/releases/download/7.0.15/$zipName"
$tmp = Join-Path $env:TEMP "mastermind-$zipName"
$extract = Join-Path $env:TEMP "mastermind-redis-extract"

function Write-Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m) { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

$existing = Join-Path $dest "redis-server.exe"
if ((Test-Path $existing) -and -not $Force) {
    $ver = & $existing --version 2>&1 | Out-String
    if ($ver -match 'v=(\d+)\.(\d+)' -and ([int]$Matches[1] -gt 6 -or ([int]$Matches[1] -eq 6 -and [int]$Matches[2] -ge 2))) {
        Write-Ok ("Already have Redis {0} at {1} (use -Force to reinstall)" -f $Matches[0].Substring(2), $dest)
        exit 0
    }
    Write-Step "Existing Redis is below 6.2 - upgrading"
}

Write-Step "Stopping redis-server if running"
Get-Process redis-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Step "Downloading $zipName"
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing

if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
New-Item -ItemType Directory -Force -Path $extract | Out-Null
Expand-Archive -Path $tmp -DestinationPath $extract -Force

$server = Get-ChildItem -Path $extract -Recurse -Filter "redis-server.exe" | Select-Object -First 1
if (-not $server) { Write-Fail "Zip did not contain redis-server.exe" }

if (Test-Path $dest) {
    $bak = "$dest.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Rename-Item $dest $bak
    Write-Ok ("Backed up previous tools/redis -> {0}" -f (Split-Path $bak -Leaf))
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $server.DirectoryName '*') -Destination $dest -Recurse -Force

$installed = Join-Path $dest "redis-server.exe"
$verOut = & $installed --version 2>&1 | Out-String
Write-Ok $verOut.Trim()
Write-Ok "Installed to $dest"
Write-Host 'Restart infra with: .\scripts\start-local-infra.ps1' -ForegroundColor Cyan
