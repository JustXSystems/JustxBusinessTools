import { api } from "@/lib/api";
import { apiUrl, getApiBase } from "@/lib/api-base";
import { withBasePath } from "@/lib/base-path";
import {
  getFsaSupport,
  pickDownloadFolder,
  probeFsaFolder,
  writeFileViaFsa,
} from "@/lib/artifact-delivery/fsa";

export type ArtifactListItem = {
  id: string;
  toolId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  syncStatus: string;
  deliveryChannel: string | null;
  destinationPath: string | null;
  lastError: string | null;
  attemptCount: number;
  createdAt: string;
  browserFallbackAt: string | null;
};

export type SyncAgentRow = {
  id: string;
  label: string | null;
  userId: number;
  lastSeenAt: string | null;
  lastProbeOk: boolean;
  lastProbePath: string | null;
  lastProbeError: string | null;
  revokedAt: string | null;
  createdAt: string;
  online: boolean;
};

export type LocalAgentStatus = {
  ok: boolean;
  running?: boolean;
  folder?: string | null;
  folderOk?: boolean | null;
  lastResult?: {
    synced?: number;
    failed?: number;
    inaccessible?: boolean;
    message?: string;
  } | null;
  lastError?: string | null;
  lastFinishedAt?: string | null;
  startedAt?: string;
  pollMs?: number;
};

export const LOCAL_AGENT_BRIDGE = "http://127.0.0.1:17865";

export async function fetchPendingArtifacts() {
  return api<{
    downloadFolder: string | null;
    conflictPolicy: "rename" | "skip" | "overwrite";
    items: ArtifactListItem[];
  }>("/artifacts?pending=1&limit=100");
}

export async function fetchSyncAgents() {
  return api<{ items: SyncAgentRow[] }>("/artifacts/agents");
}

export async function revokeSyncAgent(id: string) {
  return api<{ ok: boolean }>(`/artifacts/agents/${id}/revoke`, {
    method: "POST",
    body: "{}",
  });
}

export async function fetchArtifactContentBytes(id: string): Promise<Uint8Array> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}/content`), {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Could not download artifact");
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Sync all pending artifacts into the folder linked via File System Access in this browser. */
export async function syncPendingViaFsa(conflictPolicy: "rename" | "skip" | "overwrite" = "overwrite") {
  const support = getFsaSupport();
  if (!support.supported) throw new Error(support.reason || "File System Access not supported");
  let probe = await probeFsaFolder();
  if (!probe.ok) {
    await pickDownloadFolder();
    probe = await probeFsaFolder();
    if (!probe.ok) throw new Error(probe.error || "Could not access linked folder");
  }

  const list = await fetchPendingArtifacts();
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of list.items) {
    try {
      const bytes = await fetchArtifactContentBytes(item.id);
      const written = await writeFileViaFsa({
        filename: item.originalFilename,
        bytes,
        mimeType: item.mimeType,
        conflictPolicy: list.conflictPolicy || conflictPolicy,
      });
      await api(`/artifacts/${item.id}/ack`, {
        method: "POST",
        body: JSON.stringify({
          status: written.skipped ? "skipped_duplicate" : "synced",
          channel: "fsa",
          destinationPath: written.pathLabel,
        }),
      });
      synced += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "Write failed";
      errors.push(`${item.originalFilename}: ${msg}`);
      await api(`/artifacts/${item.id}/ack`, {
        method: "POST",
        body: JSON.stringify({
          status: "failed",
          channel: "fsa",
          error: msg,
        }),
      }).catch(() => undefined);
    }
  }

  return { synced, failed, folderName: probe.name, errors };
}

export async function probeLocalAgent(): Promise<LocalAgentStatus | null> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${LOCAL_AGENT_BRIDGE}/status`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    window.clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as LocalAgentStatus;
  } catch {
    return null;
  }
}

export async function triggerLocalAgentSync(): Promise<{
  ok: boolean;
  synced?: number;
  failed?: number;
  inaccessible?: boolean;
  message?: string;
  error?: string;
}> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${LOCAL_AGENT_BRIDGE}/sync-once`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error || `Agent returned ${res.status}`));
    }
    return data as {
      ok: boolean;
      synced?: number;
      failed?: number;
      inaccessible?: boolean;
      message?: string;
    };
  } finally {
    window.clearTimeout(t);
  }
}

/** API base the desktop agent should call (absolute). */
export function resolveAgentApiBase(): string {
  const configured = getApiBase();
  if (configured) return `${configured}/api`;
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api`;
  }
  return "http://localhost:4000/api";
}

/** Absolute URL for the published agent zip (under Next public + basePath). */
export function resolveAgentPackUrl(): string {
  if (typeof window === "undefined") return "/desktop-sync-agent.zip";
  const path = withBasePath("/desktop-sync-agent.zip");
  return `${window.location.origin}${path}`;
}

export function buildAgentLauncherScript(input: {
  token: string;
  apiBase: string;
  downloadFolder?: string | null;
  agentPackUrl?: string | null;
}): string {
  const folderLine = input.downloadFolder
    ? `$env:JBT_DOWNLOAD_FOLDER = @'\n${input.downloadFolder}\n'@`
    : "# $env:JBT_DOWNLOAD_FOLDER = '\\\\fileserver\\shared\\business-artifacts'";
  const packUrl = (input.agentPackUrl || "").replace(/"/g, '`"');
  return `# JustXSystems Desktop Sync Agent launcher
# Generated from Sync Center - keep this file private (contains your agent token).
#
# Usage (customer PC needs only Windows + Node.js 18+):
#   .\\start-justx-sync-agent.ps1 -Install     # download agent pack if needed, auto-start at logon
#   .\\start-justx-sync-agent.ps1 -Health
#   .\\start-justx-sync-agent.ps1 -Uninstall
#   .\\start-justx-sync-agent.ps1              # foreground run (after install or with local sources)

param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Health
)

$ErrorActionPreference = "Stop"
$env:JBT_API_BASE = "${input.apiBase.replace(/"/g, '`"')}"
$env:JBT_AGENT_TOKEN = "${input.token.replace(/"/g, '`"')}"
${folderLine}
$env:JBT_POLL_MS = "15000"
$env:JBT_BRIDGE_PORT = "17865"
$AgentPackUrl = "${packUrl}"

function Find-AgentDir {
  $candidates = @(
    (Join-Path $PSScriptRoot "desktop-sync-agent"),
    (Join-Path (Join-Path $PSScriptRoot "..") "desktop-sync-agent"),
    $PSScriptRoot,
    (Join-Path $env:LOCALAPPDATA "JustX\\sync-agent\\src-pack\\desktop-sync-agent")
  )
  foreach ($dir in $candidates) {
    if (Test-Path (Join-Path $dir "src\\index.js")) { return $dir }
  }
  $probe = $PSScriptRoot
  for ($i = 0; $i -lt 6; $i++) {
    $dir = Join-Path $probe "desktop-sync-agent"
    if (Test-Path (Join-Path $dir "src\\index.js")) { return $dir }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }
  return $null
}

function Get-InstallScriptPath([string]$AgentDir) {
  if ($AgentDir -and (Test-Path (Join-Path $AgentDir "install-agent.ps1"))) {
    return Join-Path $AgentDir "install-agent.ps1"
  }
  $local = Join-Path $env:LOCALAPPDATA "JustX\\sync-agent\\install-agent.ps1"
  if (Test-Path $local) { return $local }
  return $null
}

function Ensure-AgentSources {
  $dir = Find-AgentDir
  if ($dir) { return $dir }
  if (-not $AgentPackUrl) {
    Write-Host "No local desktop-sync-agent and no AgentPackUrl in this launcher." -ForegroundColor Yellow
    Write-Host "Re-download the launcher from Sync Center after deploy, or place desktop-sync-agent next to this script." -ForegroundColor Yellow
    exit 1
  }
  $installRoot = Join-Path $env:LOCALAPPDATA "JustX\\sync-agent"
  $packRoot = Join-Path $installRoot "src-pack"
  $zipPath = Join-Path $env:TEMP ("jbt-agent-" + [guid]::NewGuid().ToString("n") + ".zip")
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  Write-Host "Downloading agent pack..." -ForegroundColor Cyan
  Write-Host $AgentPackUrl -ForegroundColor DarkGray
  try {
    Invoke-WebRequest -Uri $AgentPackUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
  } catch {
    Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check that $AgentPackUrl is reachable (web deploy must publish desktop-sync-agent.zip)." -ForegroundColor Yellow
    exit 1
  }
  if (Test-Path $packRoot) { Remove-Item $packRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $packRoot | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $packRoot -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  $nested = Join-Path $packRoot "desktop-sync-agent"
  if (Test-Path (Join-Path $nested "src\\index.js")) { return $nested }
  if (Test-Path (Join-Path $packRoot "src\\index.js")) { return $packRoot }
  Write-Host "Agent pack zip did not contain src\\index.js" -ForegroundColor Red
  exit 1
}

$agentDir = Ensure-AgentSources
$installScript = Get-InstallScriptPath $agentDir
if (-not $installScript) {
  Write-Host "install-agent.ps1 not found next to agent sources." -ForegroundColor Red
  exit 1
}

if ($Uninstall) {
  $u = Join-Path (Split-Path $installScript -Parent) "uninstall-agent.ps1"
  if (-not (Test-Path $u)) { $u = Join-Path $agentDir "uninstall-agent.ps1" }
  & $u
  exit $LASTEXITCODE
}
if ($Health) {
  $h = Join-Path (Split-Path $installScript -Parent) "health-check.ps1"
  if (-not (Test-Path $h)) { $h = Join-Path $agentDir "health-check.ps1" }
  & $h -LauncherScript $PSCommandPath
  exit $LASTEXITCODE
}
if ($Install) {
  & $installScript -LauncherScript $PSCommandPath -AgentSourceDir $agentDir -AgentPackUrl $AgentPackUrl
  exit $LASTEXITCODE
}

# Foreground: prefer installed app copy if present
$runtime = Join-Path $env:LOCALAPPDATA "JustX\\sync-agent\\app"
if (Test-Path (Join-Path $runtime "src\\index.js")) {
  $cfg = Join-Path $env:LOCALAPPDATA "JustX\\sync-agent\\config.ps1"
  if (Test-Path $cfg) { . $cfg }
  Set-Location $runtime
} else {
  Set-Location $agentDir
}
Write-Host "Starting sync agent (bridge http://127.0.0.1:17865)..." -ForegroundColor Cyan
Write-Host "Tip: run with -Install once to auto-start at Windows logon." -ForegroundColor DarkGray
node .\\src\\index.js
`;
}

export function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/x-powershell" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
