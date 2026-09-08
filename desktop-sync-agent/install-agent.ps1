#Requires -Version 5.1
<#
.SYNOPSIS
  Install JustX desktop sync agent with logon auto-start.

.DESCRIPTION
  Copies the agent into %LOCALAPPDATA%\JustX\sync-agent, saves credentials,
  registers a Scheduled Task + Startup shortcut, and can start the agent now.

.EXAMPLE
  .\install-agent.ps1 -LauncherScript "$env:USERPROFILE\Downloads\start-justx-sync-agent.ps1"

.EXAMPLE
  .\install-agent.ps1 -ApiBase "https://justxsystems.com/jbt/api" -AgentToken "jxsa_..."
#>
[CmdletBinding()]
param(
  [string]$LauncherScript = "",
  [string]$ApiBase = "",
  [string]$AgentToken = "",
  [string]$DownloadFolder = "",
  [string]$AgentSourceDir = "",
  [string]$AgentPackUrl = "",
  [switch]$NoStart,
  [switch]$NoAutoStart,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$TaskName = "JustX Sync Agent"
$InstallRoot = Join-Path $env:LOCALAPPDATA "JustX\sync-agent"
$ConfigPath = Join-Path $InstallRoot "config.ps1"
$RunPath = Join-Path $InstallRoot "run.ps1"
$LogPath = Join-Path $InstallRoot "agent.log"

function Write-Info([string]$Message, [string]$Color = "Cyan") {
  if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

function Get-NodePath {
  # Prefer a real Node install over IDE-bundled node on PATH (e.g. JetBrains ACP)
  foreach ($candidate in @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe",
      "$env:LOCALAPPDATA\Programs\node\node.exe"
    )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch 'acp-agents|JetBrains|cursor\\.*\\dist-package') {
    return $cmd.Source
  }
  if ($cmd) { return $cmd.Source }
  return $null
}

function Read-LauncherEnv([string]$Path) {
  $result = @{ ApiBase = ""; AgentToken = ""; DownloadFolder = ""; AgentPackUrl = "" }
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $result }
  $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  if ($text -match '(?m)\$env:JBT_API_BASE\s*=\s*"([^"]*)"') {
    $result.ApiBase = $Matches[1]
  }
  if ($text -match '(?m)\$env:JBT_AGENT_TOKEN\s*=\s*"([^"]*)"') {
    $result.AgentToken = $Matches[1]
  }
  if ($text -match '(?m)\$AgentPackUrl\s*=\s*"([^"]*)"') {
    $result.AgentPackUrl = $Matches[1]
  }
  if ($text -match "(?ms)\$env:JBT_DOWNLOAD_FOLDER\s*=\s*@'\r?\n(.*?)\r?\n'@") {
    $result.DownloadFolder = $Matches[1].Trim()
  }
  elseif ($text -match "(?m)\$env:JBT_DOWNLOAD_FOLDER\s*=\s*'([^']*)'") {
    $result.DownloadFolder = $Matches[1]
  }
  elseif ($text -match '(?m)\$env:JBT_DOWNLOAD_FOLDER\s*=\s*"([^"]*)"') {
    $result.DownloadFolder = $Matches[1]
  }
  return $result
}

function Get-AgentFromPack([string]$Url) {
  if (-not $Url) { return $null }
  Write-Info "Downloading agent pack..."
  Write-Info $Url "DarkGray"
  $packRoot = Join-Path $InstallRoot "src-pack"
  $zipPath = Join-Path $env:TEMP ("jbt-agent-" + [guid]::NewGuid().ToString("n") + ".zip")
  try {
    Invoke-WebRequest -Uri $Url -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
  } catch {
    throw "Could not download agent pack from $Url - $($_.Exception.Message). Rebuild/deploy web or pass -AgentSourceDir."
  }
  if (Test-Path -LiteralPath $packRoot) {
    Remove-Item -LiteralPath $packRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $packRoot | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $packRoot -Force
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  $nested = Join-Path $packRoot "desktop-sync-agent"
  if (Test-Path -LiteralPath (Join-Path $nested "src\index.js")) {
    return (Resolve-Path -LiteralPath $nested).Path
  }
  if (Test-Path -LiteralPath (Join-Path $packRoot "src\index.js")) {
    return (Resolve-Path -LiteralPath $packRoot).Path
  }
  throw "Agent pack downloaded but desktop-sync-agent\src\index.js was not found inside the zip."
}

function Resolve-AgentSource {
  param([string]$Hint, [string]$PackUrl)
  if ($Hint) {
    $index = Join-Path $Hint "src\index.js"
    if (Test-Path -LiteralPath $index) { return (Resolve-Path -LiteralPath $Hint).Path }
  }
  $here = $PSScriptRoot
  if (Test-Path -LiteralPath (Join-Path $here "src\index.js")) { return $here }

  $probe = $here
  for ($i = 0; $i -lt 5; $i++) {
    $candidate = Join-Path $probe "desktop-sync-agent\src\index.js"
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath (Join-Path $probe "desktop-sync-agent")).Path
    }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }

  $fromPack = Get-AgentFromPack -Url $PackUrl
  if ($fromPack) { return $fromPack }

  throw "Could not find desktop-sync-agent\src\index.js. Pass -AgentSourceDir, -AgentPackUrl, or run from the repo."
}

# Default: pick up Sync Center launcher from Downloads if not specified
if (-not $LauncherScript) {
  $defaultLauncher = Join-Path $env:USERPROFILE "Downloads\start-justx-sync-agent.ps1"
  if (Test-Path -LiteralPath $defaultLauncher) {
    $LauncherScript = $defaultLauncher
    Write-Info "Using launcher: $LauncherScript"
  }
}

$fromLauncher = Read-LauncherEnv $LauncherScript
if (-not $ApiBase) { $ApiBase = $fromLauncher.ApiBase }
if (-not $AgentToken) { $AgentToken = $fromLauncher.AgentToken }
if (-not $DownloadFolder) { $DownloadFolder = $fromLauncher.DownloadFolder }
if (-not $AgentPackUrl) { $AgentPackUrl = $fromLauncher.AgentPackUrl }

if ((-not $ApiBase -or -not $AgentToken) -and (Test-Path -LiteralPath $ConfigPath)) {
  . $ConfigPath
  if (-not $ApiBase -and $env:JBT_API_BASE) { $ApiBase = $env:JBT_API_BASE }
  if (-not $AgentToken -and $env:JBT_AGENT_TOKEN) { $AgentToken = $env:JBT_AGENT_TOKEN }
  if (-not $DownloadFolder -and $env:JBT_DOWNLOAD_FOLDER) { $DownloadFolder = $env:JBT_DOWNLOAD_FOLDER }
}

if (-not $ApiBase) {
  throw "Missing API base. Pass -ApiBase or -LauncherScript (Sync Center .ps1)."
}
if (-not $AgentToken -or -not $AgentToken.StartsWith("jxsa_")) {
  throw "Missing or invalid agent token (expected jxsa_...). Create one in Sync Center."
}

$node = Get-NodePath
if (-not $node) {
  throw "Node.js 18+ not found. Install from https://nodejs.org then re-run install-agent.ps1."
}
Write-Info "Node: $node"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$agentSource = Resolve-AgentSource -Hint $AgentSourceDir -PackUrl $AgentPackUrl
Write-Info "Agent source: $agentSource"
Write-Info "Install root: $InstallRoot"

# Stop a previous agent so we can refresh the LocalAppData copy
try {
  $conn = Get-NetTCPConnection -LocalPort 17865 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($conn -and $conn.OwningProcess) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Write-Info "Stopped existing agent on :17865"
  }
} catch {
  # ignore
}

$AgentRuntime = Join-Path $InstallRoot "app"
if (Test-Path -LiteralPath $AgentRuntime) {
  Remove-Item -LiteralPath $AgentRuntime -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $AgentRuntime | Out-Null
Copy-Item -LiteralPath (Join-Path $agentSource "src") -Destination (Join-Path $AgentRuntime "src") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $agentSource "package.json") -Destination (Join-Path $AgentRuntime "package.json") -Force
if (Test-Path -LiteralPath (Join-Path $agentSource "package-lock.json")) {
  Copy-Item -LiteralPath (Join-Path $agentSource "package-lock.json") -Destination (Join-Path $AgentRuntime "package-lock.json") -Force
}
foreach ($scriptName in @("install-agent.ps1", "uninstall-agent.ps1", "health-check.ps1", "README.md")) {
  $srcScript = Join-Path $agentSource $scriptName
  if (Test-Path -LiteralPath $srcScript) {
    Copy-Item -LiteralPath $srcScript -Destination (Join-Path $InstallRoot $scriptName) -Force
  }
}

$safeApi = $ApiBase.Replace("'", "''")
$safeToken = $AgentToken.Replace("'", "''")
$configLines = @(
  "# JustX sync agent config - keep private (contains agent token).",
  "# Generated by install-agent.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "`$env:JBT_API_BASE = '$safeApi'",
  "`$env:JBT_AGENT_TOKEN = '$safeToken'",
  "`$env:JBT_POLL_MS = '15000'",
  "`$env:JBT_BRIDGE_PORT = '17865'"
)
if ($DownloadFolder) {
  $configLines += "`$env:JBT_DOWNLOAD_FOLDER = @'"
  $configLines += $DownloadFolder
  $configLines += "'@"
}
Set-Content -LiteralPath $ConfigPath -Value ($configLines -join "`r`n") -Encoding UTF8

# JSON config for portable / CMD layout compatibility
$configJson = @{
  apiBase = $ApiBase
  agentToken = $AgentToken
  downloadFolder = $(if ($DownloadFolder) { $DownloadFolder } else { $null })
  pollMs = 15000
  bridgePort = 17865
  packVersion = "1.1.0"
} | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $InstallRoot "config.json"), $configJson, $utf8NoBom)

$safeRoot = $InstallRoot.Replace("'", "''")
$safeNode = $node.Replace("'", "''")
$runLines = @(
  "#Requires -Version 5.1",
  "`$ErrorActionPreference = 'Stop'",
  "`$InstallRoot = '$safeRoot'",
  "`$PinnedNode = '$safeNode'",
  "`$ConfigPath = Join-Path `$InstallRoot 'config.ps1'",
  "`$AgentDir = Join-Path `$InstallRoot 'app'",
  "`$LogPath = Join-Path `$InstallRoot 'agent.log'",
  ". `$ConfigPath",
  "Set-Location `$AgentDir",
  "`$node = `$null",
  "if (`$PinnedNode -and (Test-Path -LiteralPath `$PinnedNode)) { `$node = `$PinnedNode }",
  "if (-not `$node) {",
  "  foreach (`$c in @(`"`$env:ProgramFiles\nodejs\node.exe`", `"`${env:ProgramFiles(x86)}\nodejs\node.exe`")) {",
  "    if (Test-Path -LiteralPath `$c) { `$node = `$c; break }",
  "  }",
  "}",
  "if (-not `$node) {",
  "  `$nodeCmd = Get-Command node -ErrorAction SilentlyContinue",
  "  if (`$nodeCmd) { `$node = `$nodeCmd.Source }",
  "}",
  "if (-not `$node) {",
  "  Add-Content -LiteralPath `$LogPath -Value ('[{0}] Node.js not found' -f (Get-Date -Format o))",
  "  exit 1",
  "}",
  "Add-Content -LiteralPath `$LogPath -Value ('[{0}] Starting sync agent with {1}' -f (Get-Date -Format o), `$node)",
  "& `$node .\src\index.js *>> `$LogPath"
)
Set-Content -LiteralPath $RunPath -Value ($runLines -join "`r`n") -Encoding UTF8

Write-Info "Verifying npm (agent has no runtime deps)..."
Push-Location $AgentRuntime
try {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npm) {
    & npm.cmd install --omit=dev 2>&1 | Out-Null
  }
} catch {
  Write-Info "npm install note: $_" "Yellow"
} finally {
  Pop-Location
}

if (-not $NoAutoStart) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunPath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "JustX Sync Center desktop agent (UNC sync + Email Outbox Outlook). Bridge http://127.0.0.1:17865" `
    -Force | Out-Null
  Write-Info "Scheduled Task registered: $TaskName (at logon)" "Green"
} else {
  Write-Info "Skipped Scheduled Task (-NoAutoStart)." "Yellow"
}

# Remove legacy Startup shortcut from older installs (task-only auto-start)
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "JustX Sync Agent.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  Write-Info "Removed legacy Startup shortcut (Scheduled Task is enough)." "DarkGray"
}

if (-not $NoStart) {
  # Stop an existing listener on the bridge port if we can identify our process later; start fresh
  Write-Info "Starting agent now..."
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $RunPath
  ) -WindowStyle Minimized
  Start-Sleep -Seconds 2
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:17865/health" -TimeoutSec 3
    Write-Info "Bridge OK at http://127.0.0.1:17865" "Green"
  } catch {
    Write-Info "Agent launched; bridge not ready yet. See $LogPath if Sync Center stays disconnected." "Yellow"
  }
}

Write-Info ""
Write-Info "Done. Sync Center should show Desktop agent: Connected on this PC." "Green"
Write-Info "Email Outbox -> Open in Outlook uses the same agent." "Green"
Write-Info "Config: $ConfigPath"
Write-Info "Log:    $LogPath"
Write-Info "Health: $InstallRoot\health-check.ps1"
Write-Info "Remove: $InstallRoot\uninstall-agent.ps1"
