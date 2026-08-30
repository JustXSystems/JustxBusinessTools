import { api } from "@/lib/api";
import { writeFileViaFsa, probeFsaFolder, getFsaSupport } from "@/lib/artifact-delivery/fsa";

export type ArtifactDeliveryResult = {
  artifactId: string;
  channel: "fsa" | "desktop_agent" | "browser_download" | "share_sheet";
  syncStatus: string;
  message: string;
  duplicateOf?: string;
};

export type StagedArtifact = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  syncStatus: string;
  toolId: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function forceBrowserDownload(filename: string, bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([bytes as BlobPart], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function tryShareSheet(filename: string, bytes: Uint8Array, mimeType: string): Promise<boolean> {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    const file = new File([bytes as BlobPart], filename, { type: mimeType || "application/octet-stream" });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}

async function ack(
  id: string,
  body: {
    status: string;
    channel: string;
    destinationPath?: string;
    error?: string;
  },
) {
  return api<StagedArtifact>(`/artifacts/${id}/ack`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Stage artifact on server, then deliver via:
 * 1) File System Access (Chromium, if folder linked)
 * 2) Share sheet (mobile) when useful
 * 3) Browser download fallback (always available)
 *
 * Pending items remain queued for the optional desktop sync agent (UNC/network shares).
 */
export async function deliverToolArtifact(input: {
  toolId: string;
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
  meta?: Record<string, unknown>;
  /** Prefer share sheet on mobile before browser download. */
  preferShare?: boolean;
  conflictPolicy?: "rename" | "skip" | "overwrite";
}): Promise<ArtifactDeliveryResult> {
  const mimeType = input.mimeType || "application/octet-stream";
  const staged = await api<{ artifact: StagedArtifact; duplicateOf?: string }>("/artifacts", {
    method: "POST",
    body: JSON.stringify({
      toolId: input.toolId,
      filename: input.filename,
      mimeType,
      contentBase64: bytesToBase64(input.bytes),
      conflictPolicy: input.conflictPolicy,
      meta: input.meta,
    }),
  });

  const artifactId = staged.artifact.id;

  // 1) FSA write when this browser has a linked folder with permission
  const fsa = getFsaSupport();
  if (fsa.supported) {
    const probe = await probeFsaFolder();
    if (probe.ok) {
      try {
        const written = await writeFileViaFsa({
          filename: input.filename,
          bytes: input.bytes,
          mimeType,
          conflictPolicy: input.conflictPolicy ?? "rename",
        });
        if (written.skipped) {
          await ack(artifactId, {
            status: "skipped_duplicate",
            channel: "fsa",
            destinationPath: written.pathLabel,
          });
          return {
            artifactId,
            channel: "fsa",
            syncStatus: "skipped_duplicate",
            message: `Skipped — already in linked folder (${written.pathLabel}).`,
            duplicateOf: staged.duplicateOf,
          };
        }
        await ack(artifactId, {
          status: "synced",
          channel: "fsa",
          destinationPath: written.pathLabel,
        });
        return {
          artifactId,
          channel: "fsa",
          syncStatus: "synced",
          message: `Saved to linked Download Folder (${written.pathLabel}).`,
          duplicateOf: staged.duplicateOf,
        };
      } catch (err) {
        await ack(artifactId, {
          status: "pending",
          channel: "fsa",
          error: err instanceof Error ? err.message : "FSA write failed",
        }).catch(() => undefined);
      }
    }
  }

  // 2) Mobile share sheet (optional)
  if (input.preferShare) {
    const shared = await tryShareSheet(input.filename, input.bytes, mimeType);
    if (shared) {
      await ack(artifactId, { status: "pending", channel: "share_sheet" });
      return {
        artifactId,
        channel: "share_sheet",
        syncStatus: "pending",
        message:
          "Shared from this device. File remains queued until a desktop agent syncs it to the Download Folder.",
        duplicateOf: staged.duplicateOf,
      };
    }
  }

  // 3) Browser download fallback — file still pending for agent/FSA folder sync
  //    (cloud destinations are already handled server-side on stage).
  forceBrowserDownload(input.filename, input.bytes, mimeType);
  await ack(artifactId, { status: "pending", channel: "browser_download" });
  return {
    artifactId,
    channel: "browser_download",
    syncStatus: "pending",
    message:
      "Downloaded locally. If Google Drive or a corporate webhook is configured, the server also delivers automatically.",
    duplicateOf: staged.duplicateOf,
  };
}

export async function fetchArtifactSyncSummary() {
  return api<{
    downloadFolder: string | null;
    counts: Record<string, number>;
    pending: number;
    delivery: {
      artifactDestination: string;
      effectiveDestination: string;
      automationReady: boolean;
      googleDrive: {
        folderId: string;
        folderLabel: string;
        connected: boolean;
        email: string | null;
        oauthClientConfigured: boolean;
        serverServiceAccountConfigured: boolean;
        serviceAccountEmail: string | null;
      };
      webhook: { url: string | null; secretConfigured: boolean };
    } | null;
  }>("/artifacts/sync-summary");
}

export async function registerSyncAgent(label?: string) {
  return api<{ agentId: string; token: string; note: string }>("/artifacts/agent/register", {
    method: "POST",
    body: JSON.stringify({ label: label || "Desktop Sync Agent" }),
  });
}

export async function retryArtifact(id: string) {
  return api<StagedArtifact>(`/artifacts/${id}/retry`, { method: "POST", body: "{}" });
}

export {
  fetchPendingArtifacts,
  fetchSyncAgents,
  revokeSyncAgent,
  syncPendingViaFsa,
  probeLocalAgent,
  triggerLocalAgentSync,
  resolveAgentApiBase,
  buildAgentLauncherScript,
  downloadTextFile,
  LOCAL_AGENT_BRIDGE,
} from "@/lib/artifact-delivery/sync-center";
export type {
  ArtifactListItem,
  SyncAgentRow,
  LocalAgentStatus,
} from "@/lib/artifact-delivery/sync-center";

export function pdfBase64ToBytes(pdfBase64: string): Uint8Array {
  const binary = atob(pdfBase64.replace(/^data:application\/pdf;base64,/, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
