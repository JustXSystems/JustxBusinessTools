import { api } from "@/lib/api";
import { apiUrl, getApiBase } from "@/lib/api-base";
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

export function buildAgentLauncherScript(input: {
  token: string;
  apiBase: string;
  downloadFolder?: string | null;
}): string {
  const folderLine = input.downloadFolder
    ? `$env:JBT_DOWNLOAD_FOLDER = @'\n${input.downloadFolder}\n'@`
    : "# $env:JBT_DOWNLOAD_FOLDER = '\\\\fileserver\\shared\\business-artifacts'";
  return `# JustXSystems Desktop Sync Agent launcher
# Generated from Sync Center — keep this file private (contains your agent token).

$ErrorActionPreference = "Stop"
$env:JBT_API_BASE = "${input.apiBase.replace(/"/g, '`"')}"
$env:JBT_AGENT_TOKEN = "${input.token.replace(/"/g, '`"')}"
${folderLine}
$env:JBT_POLL_MS = "15000"
$env:JBT_BRIDGE_PORT = "17865"

$root = Join-Path $PSScriptRoot ".."
if (-not (Test-Path (Join-Path $root "desktop-sync-agent\\src\\index.js"))) {
  $root = Join-Path $PSScriptRoot "."
}
$agentDir = Join-Path $root "desktop-sync-agent"
if (-not (Test-Path (Join-Path $agentDir "src\\index.js"))) {
  Write-Host "Place this script next to the JustxBusinessTools repo (or inside desktop-sync-agent)." -ForegroundColor Yellow
  Write-Host "Expected: desktop-sync-agent\\src\\index.js" -ForegroundColor Yellow
  exit 1
}

Set-Location $agentDir
Write-Host "Starting sync agent (bridge http://127.0.0.1:17865)…" -ForegroundColor Cyan
Write-Host "Keep this window open. Use Sync Center → Sync now (desktop agent) in the browser." -ForegroundColor Cyan
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
