import { api } from "@/lib/api";
import { writeFileViaFsa, probeFsaFolder, getFsaSupport } from "@/lib/artifact-delivery/fsa";

export type ArtifactDeliveryResult = {
  artifactId: string;
  channel: string;
  syncStatus: string;
  message: string;
  duplicateOf?: string;
  /** True when company Google Drive / webhook upload succeeded. */
  cloudOk?: boolean;
};

export type StagedArtifact = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  syncStatus: string;
  deliveryChannel?: string | null;
  destinationPath?: string | null;
  lastError?: string | null;
  toolId: string;
};

type StageResponse = {
  artifact: StagedArtifact;
  duplicateOf?: string;
  delivery?: {
    ok: boolean;
    channel: string;
    status: string;
    message?: string;
  };
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
 * Stage artifact on server (awaits company Drive/webhook), then optionally:
 * 1) File System Access (Chromium, if folder linked)
 * 2) Share sheet (mobile)
 * 3) Browser download fallback
 *
 * Pass `companyOnly: true` to skip all local copy paths (Submit / archive-to-company flows).
 */
export async function deliverToolArtifact(input: {
  toolId: string;
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
  meta?: Record<string, unknown>;
  /** Prefer share sheet on mobile before browser download. */
  preferShare?: boolean;
  /** Stage + company delivery only — no FSA, share sheet, or browser download. */
  companyOnly?: boolean;
  conflictPolicy?: "rename" | "skip" | "overwrite";
}): Promise<ArtifactDeliveryResult> {
  const mimeType = input.mimeType || "application/octet-stream";
  const staged = await api<StageResponse>("/artifacts", {
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
  const delivery = staged.delivery;
  const cloudSynced =
    Boolean(delivery?.ok) &&
    delivery?.status === "synced" &&
    (delivery.channel === "google_drive" || delivery.channel === "webhook");
  const uncQueued =
    Boolean(delivery?.ok) &&
    delivery?.status === "pending" &&
    (delivery.channel === "desktop_agent" || delivery.channel === "unc_agent");

  let cloudPrefix = "";
  if (delivery?.channel === "google_drive" && delivery.status === "synced" && delivery.ok) {
    cloudPrefix = staged.artifact.destinationPath
      ? `Uploaded to company Google Drive (${staged.artifact.destinationPath}).`
      : "Uploaded to company Google Drive.";
  } else if (delivery?.channel === "webhook" && delivery.status === "synced" && delivery.ok) {
    cloudPrefix = "Delivered to company webhook.";
  } else if (delivery?.channel === "google_drive" && !delivery.ok) {
    cloudPrefix = `Google Drive upload failed: ${delivery.message || staged.artifact.lastError || "unknown error"}.`;
  } else if (delivery?.channel === "webhook" && !delivery.ok) {
    cloudPrefix = `Webhook delivery failed: ${delivery.message || staged.artifact.lastError || "unknown error"}.`;
  } else if (uncQueued) {
    cloudPrefix = delivery?.message || "Queued for company file server (UNC) via desktop agent.";
  } else if (delivery?.channel === "none" || !delivery) {
    cloudPrefix =
      delivery?.message ||
      "No company destination configured (Profile → Company document delivery).";
  } else if (delivery?.message) {
    cloudPrefix = delivery.message;
  }

  if (input.companyOnly) {
    const ok = cloudSynced || uncQueued;
    return {
      artifactId,
      channel: delivery?.channel || staged.artifact.deliveryChannel || "none",
      syncStatus: delivery?.status || staged.artifact.syncStatus,
      message: cloudPrefix || (ok ? "Submitted to company document delivery." : "Company delivery did not complete."),
      duplicateOf: staged.duplicateOf,
      cloudOk: ok,
    };
  }

  // Local FSA is optional — never treat it as a substitute for company Drive.
  const fsa = getFsaSupport();
  if (fsa.supported) {
    const probe = await probeFsaFolder();
    if (probe.ok) {
      try {
        const written = await writeFileViaFsa({
          filename: input.filename,
          bytes: input.bytes,
          mimeType,
          conflictPolicy: input.conflictPolicy ?? "overwrite",
        });
        if (!cloudSynced) {
          if (written.skipped) {
            await ack(artifactId, {
              status: "skipped_duplicate",
              channel: "fsa",
              destinationPath: written.pathLabel,
            });
          } else {
            await ack(artifactId, {
              status: "synced",
              channel: "fsa",
              destinationPath: written.pathLabel,
            });
          }
        }
        const localBit = written.skipped
          ? `Also already in linked browser folder (${written.pathLabel}).`
          : `Also saved to linked browser folder (${written.pathLabel}).`;
        return {
          artifactId,
          channel: cloudSynced ? delivery!.channel : "fsa",
          syncStatus: cloudSynced ? "synced" : written.skipped ? "skipped_duplicate" : "synced",
          message: cloudPrefix ? `${cloudPrefix} ${localBit}` : written.skipped
            ? `Skipped — already in linked folder (${written.pathLabel}).`
            : `Saved to linked Download Folder (${written.pathLabel}).`,
          duplicateOf: staged.duplicateOf,
          cloudOk: cloudSynced,
        };
      } catch (err) {
        if (!cloudSynced) {
          await ack(artifactId, {
            status: "pending",
            channel: "fsa",
            error: err instanceof Error ? err.message : "FSA write failed",
          }).catch(() => undefined);
        }
      }
    }
  }

  if (input.preferShare) {
    const shared = await tryShareSheet(input.filename, input.bytes, mimeType);
    if (shared) {
      if (!cloudSynced) {
        await ack(artifactId, { status: "pending", channel: "share_sheet" });
      }
      return {
        artifactId,
        channel: cloudSynced ? delivery!.channel : "share_sheet",
        syncStatus: cloudSynced ? "synced" : "pending",
        message: cloudPrefix
          ? `${cloudPrefix} Also shared from this device.`
          : "Shared from this device. File remains queued until company delivery completes.",
        duplicateOf: staged.duplicateOf,
        cloudOk: cloudSynced,
      };
    }
  }

  forceBrowserDownload(input.filename, input.bytes, mimeType);
  if (!cloudSynced) {
    await ack(artifactId, { status: "pending", channel: "browser_download" });
  }

  if (cloudPrefix) {
    return {
      artifactId,
      channel: delivery?.channel || "browser_download",
      syncStatus: delivery?.status || staged.artifact.syncStatus,
      message: `${cloudPrefix} Also downloaded locally.`,
      duplicateOf: staged.duplicateOf,
      cloudOk: cloudSynced,
    };
  }

  return {
    artifactId,
    channel: "browser_download",
    syncStatus: "pending",
    message:
      "Downloaded locally. Configure Company Google Drive on Business Profile (connect + save folder) to auto-upload PDFs.",
    duplicateOf: staged.duplicateOf,
    cloudOk: false,
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
