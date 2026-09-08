#Requires -Version 5.1
<#
.SYNOPSIS
  Health checklist for Sync Center desktop agent + Email Outbox Outlook path.
#>
[CmdletBinding()]
param(
  [string]$LauncherScript = "",
  [int]$BridgePort = 17865
)

$ErrorActionPreference = "Continue"
$InstallRoot = Join-Path $env:LOCALAPPDATA "JustX\sync-agent"
$ConfigPath = Join-Path $InstallRoot "config.ps1"
$pass = 0
$fail = 0
$warn = 0

function Show-Result([string]$Name, [string]$Status, [string]$Detail = "") {
  $color = switch ($Status) {
    "OK" { "Green"; break }
    "WARN" { "Yellow"; break }
    default { "Red" }
  }
  $line = "[{0}] {1}" -f $Status, $Name
  if ($Detail) { $line += " - $Detail" }
  Write-Host $line -ForegroundColor $color
  switch ($Status) {
    "OK" { $script:pass++; break }
    "WARN" { $script:warn++; break }
    default { $script:fail++ }
  }
}

Write-Host "JustX sync agent health check" -ForegroundColor Cyan
Write-Host ("=" * 40)

# Node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  try {
    $ver = & node -v 2>$null
    Show-Result "Node.js" "OK" "$ver ($($nodeCmd.Source))"
  } catch {
    Show-Result "Node.js" "FAIL" "node found but failed to run"
  }
} else {
  Show-Result "Node.js" "FAIL" "Not on PATH - install Node 18+"
}

# Config / token
$apiBase = $env:JBT_API_BASE
$token = $env:JBT_AGENT_TOKEN
$folder = $env:JBT_DOWNLOAD_FOLDER

if (-not $LauncherScript) {
  $guess = Join-Path $env:USERPROFILE "Downloads\start-justx-sync-agent.ps1"
  if (Test-Path -LiteralPath $guess) { $LauncherScript = $guess }
}

if (Test-Path -LiteralPath $ConfigPath) {
  . $ConfigPath
  if (-not $apiBase) { $apiBase = $env:JBT_API_BASE }
  if (-not $token) { $token = $env:JBT_AGENT_TOKEN }
  if (-not $folder) { $folder = $env:JBT_DOWNLOAD_FOLDER }
  Show-Result "Install config" "OK" $ConfigPath
} else {
  Show-Result "Install config" "WARN" "Not installed yet (run install-agent.ps1)"
}

if ($LauncherScript -and (Test-Path -LiteralPath $LauncherScript)) {
  $text = Get-Content -LiteralPath $LauncherScript -Raw
  if (-not $apiBase -and $text -match '(?m)\$env:JBT_API_BASE\s*=\s*"([^"]*)"') { $apiBase = $Matches[1] }
  if (-not $token -and $text -match '(?m)\$env:JBT_AGENT_TOKEN\s*=\s*"([^"]*)"') { $token = $Matches[1] }
  Show-Result "Launcher script" "OK" $LauncherScript
}

if ($token -and $token.StartsWith("jxsa_")) {
  Show-Result "Agent token" "OK" ("jxsa_..." + $token.Substring([Math]::Max(0, $token.Length - 4)))
} else {
  Show-Result "Agent token" "FAIL" "Missing - create in Sync Center -> Set up on this PC"
}

if ($apiBase) {
  Show-Result "API base" "OK" $apiBase
  try {
    $uri = ($apiBase.TrimEnd("/") + "/")
    $resp = Invoke-WebRequest -Uri $uri -Method GET -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
    Show-Result "API reachable" "OK" ("HTTP {0}" -f [int]$resp.StatusCode)
  } catch {
    # Many APIs return 404 on / - still means host is up
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -and $status -ge 400 -and $status -lt 500) {
      Show-Result "API reachable" "OK" ("HTTP {0} (host up)" -f $status)
    } else {
      Show-Result "API reachable" "WARN" $_.Exception.Message
    }
  }
} else {
  Show-Result "API base" "FAIL" "Not set"
}

# Agent token probe against API (artifacts pending)
if ($apiBase -and $token -and $token.StartsWith("jxsa_")) {
  try {
    $headers = @{ Authorization = "Bearer $token"; Accept = "application/json" }
    $probeUrl = $apiBase.TrimEnd("/") + "/artifacts?pending=1&limit=1"
    $null = Invoke-RestMethod -Uri $probeUrl -Headers $headers -TimeoutSec 12
    Show-Result "Token auth" "OK" "GET /artifacts?pending=1"
  } catch {
    Show-Result "Token auth" "FAIL" $_.Exception.Message
  }
}

# Download folder
if ($folder) {
  if (Test-Path -LiteralPath $folder) {
    try {
      $probeFile = Join-Path $folder (".jbt-write-probe-" + [guid]::NewGuid().ToString("n"))
      Set-Content -LiteralPath $probeFile -Value "ok" -ErrorAction Stop
      Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
      Show-Result "Download folder writable" "OK" $folder
    } catch {
      Show-Result "Download folder writable" "FAIL" "$folder - $($_.Exception.Message)"
    }
  } else {
    Show-Result "Download folder" "WARN" "Path not visible on this PC: $folder"
  }
} else {
  Show-Result "Download folder" "WARN" "Not set locally (Profile path may still apply at sync time)"
}

# Bridge
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
  Show-Result "Local bridge :$BridgePort" "OK" ($health | ConvertTo-Json -Compress)
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$BridgePort/status" -TimeoutSec 3
    $outlook = $status.outlookCompose
    if ($null -eq $outlook) { $outlook = $status.capabilities.outlookCompose }
    if ($outlook -eq $true -or "$outlook" -match "true|ok|ready") {
      Show-Result "Outlook compose capability" "OK" "Agent reports Outlook available"
    } elseif ($null -ne $outlook) {
      Show-Result "Outlook compose capability" "WARN" "$outlook"
    } else {
      Show-Result "Outlook compose capability" "WARN" "See /status - Outlook needed for Email Outbox Path C"
    }
  } catch {
    Show-Result "Bridge /status" "WARN" $_.Exception.Message
  }
} catch {
  Show-Result "Local bridge :$BridgePort" "FAIL" "Not running - install-agent.ps1 or start the launcher"
}

# Scheduled task / startup
$task = Get-ScheduledTask -TaskName "JustX Sync Agent" -ErrorAction SilentlyContinue
if ($task) {
  Show-Result "Scheduled Task" "OK" $task.State
} else {
  Show-Result "Scheduled Task" "WARN" "Not registered - agent will not auto-start at logon"
}

$shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "JustX Sync Agent.lnk"
if (Test-Path -LiteralPath $shortcut) {
  Show-Result "Startup shortcut" "OK" $shortcut
} else {
  Show-Result "Startup shortcut" "WARN" "Missing"
}

# Outlook COM (Windows)
try {
  $outlook = New-Object -ComObject Outlook.Application -ErrorAction Stop
  $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
  Show-Result "Outlook COM" "OK" "Desktop Outlook available"
} catch {
  Show-Result "Outlook COM" "WARN" "Needed only for Email Outbox -> Open in Outlook"
}

Write-Host ("=" * 40)
Write-Host ("Summary: {0} OK, {1} WARN, {2} FAIL" -f $pass, $warn, $fail) -ForegroundColor $(if ($fail) { "Red" } elseif ($warn) { "Yellow" } else { "Green" })
if ($fail -gt 0) { exit 1 }
exit 0
