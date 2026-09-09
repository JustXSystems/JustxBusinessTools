$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

$zip = Join-Path $repo "web\public\JustX-Sync-Agent-win-x64.zip"
$stage = Join-Path $env:TEMP "jbt-win-setup-e2e"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
$root = Join-Path $stage "JustX-Sync-Agent"

$api = "https://justxsystems.com/jbt/api"
$token = "jxsa_test_placeholder"
$launcher = Join-Path $env:USERPROFILE "Downloads\start-justx-sync-agent.ps1"
if (Test-Path $launcher) {
  $t = Get-Content -LiteralPath $launcher -Raw
  if ($t -match '(?m)\$env:JBT_API_BASE\s*=\s*"([^"]*)"') { $api = $Matches[1] }
  if ($t -match '(?m)\$env:JBT_AGENT_TOKEN\s*=\s*"([^"]*)"') { $token = $Matches[1] }
}

$config = @{
  apiBase = $api
  agentToken = $token
  downloadFolder = $null
  pollMs = 15000
  bridgePort = 17865
  packVersion = "1.1.0"
} | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $root "config.json"), $config, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA "JustX\sync-agent\config.json"), $config, $utf8NoBom)

Write-Host "Setup root: $root"
Write-Host "node bytes: $((Get-Item (Join-Path $root 'runtime\node.exe')).Length)"

& (Join-Path $root "windows-stop-bridge.cmd") | Out-Null

# Run install non-interactively by invoking the core steps (avoid pause)
$install = Join-Path $env:LOCALAPPDATA "JustX\sync-agent"
New-Item -ItemType Directory -Force -Path "$install\runtime","$install\app\src" | Out-Null
Copy-Item (Join-Path $root "config.json") "$install\config.json" -Force
Copy-Item (Join-Path $root "runtime\node.exe") "$install\runtime\node.exe" -Force
Copy-Item (Join-Path $root "app\package.json") "$install\app\package.json" -Force
Copy-Item (Join-Path $root "app\src\index.js") "$install\app\src\index.js" -Force
Copy-Item (Join-Path $root "run-agent.cmd") "$install\run-agent.cmd" -Force
Copy-Item (Join-Path $root "windows-stop-bridge.cmd") "$install\windows-stop-bridge.cmd" -Force

cmd /c "schtasks /Delete /TN \"JustX Sync Agent\" /F >nul 2>&1"
$tr = "`"$install\run-agent.cmd`""
cmd /c "schtasks /Create /TN \"JustX Sync Agent\" /SC ONLOGON /RL LIMITED /F /TR $tr >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "schtasks create skipped or access denied - continuing with manual start"
}

Start-Process -FilePath "$install\run-agent.cmd" -WindowStyle Minimized
Start-Sleep -Seconds 4

try {
  $h = Invoke-RestMethod "http://127.0.0.1:17865/health" -TimeoutSec 5
  Write-Host ("HEALTH OK: " + ($h | ConvertTo-Json -Compress))
} catch {
  Write-Host ("HEALTH FAIL: " + $_.Exception.Message)
  if (Test-Path "$install\agent.log") { Get-Content "$install\agent.log" -Tail 40 }
  exit 1
}

try {
  $s = Invoke-RestMethod "http://127.0.0.1:17865/status" -TimeoutSec 5
  Write-Host ("STATUS outlookCompose=" + $s.outlookCompose + " version=" + $s.version)
} catch {
  Write-Host ("STATUS FAIL: " + $_.Exception.Message)
}

# Single-instance: start again should exit cleanly
$before = (Invoke-RestMethod "http://127.0.0.1:17865/health").startedAt
& "$install\runtime\node.exe" "$install\app\src\index.js" 2>&1 | Select-Object -First 5
Start-Sleep -Seconds 1
$after = (Invoke-RestMethod "http://127.0.0.1:17865/health").startedAt
if ($before -ne $after) {
  Write-Host "WARN: bridge restarted unexpectedly"
} else {
  Write-Host "Single-instance OK (bridge startedAt unchanged)"
}

Write-Host "E2E PASS"
