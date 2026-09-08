#Requires -Version 5.1
<#
.SYNOPSIS
  Remove JustX sync agent auto-start and local install files.
#>
[CmdletBinding()]
param(
  [switch]$KeepConfig,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$TaskName = "JustX Sync Agent"
$InstallRoot = Join-Path $env:LOCALAPPDATA "JustX\sync-agent"

function Write-Info([string]$Message, [string]$Color = "Cyan") {
  if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Info "Removed Scheduled Task: $TaskName" "Green"
} else {
  Write-Info "No Scheduled Task named $TaskName"
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "JustX Sync Agent.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Info "Removed Startup shortcut" "Green"
}

# Best-effort stop of node processes that look like the agent (bridge port)
try {
  $conn = Get-NetTCPConnection -LocalPort 17865 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($conn -and $conn.OwningProcess) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Info "Stopped process listening on :17865" "Green"
  }
} catch {
  Write-Info "Could not stop bridge process (may already be stopped)." "Yellow"
}

if (Test-Path -LiteralPath $InstallRoot) {
  if ($KeepConfig) {
    $app = Join-Path $InstallRoot "app"
    $run = Join-Path $InstallRoot "run.ps1"
    if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force }
    if (Test-Path -LiteralPath $run) { Remove-Item -LiteralPath $run -Force }
    Write-Info "Kept config under $InstallRoot (-KeepConfig)" "Yellow"
  } else {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    Write-Info "Removed $InstallRoot" "Green"
  }
} else {
  Write-Info "Install folder not present."
}

Write-Info "Uninstall complete. Revoke the agent token in Sync Center if it should no longer be used."
