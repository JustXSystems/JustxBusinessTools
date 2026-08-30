"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { apiUrl } from "@/lib/api-base";
import { extractDriveFolderId } from "@/lib/types/business-profile";
import { fetchArtifactSyncSummary } from "@/lib/artifact-delivery";

type Destination = "auto" | "google_drive" | "webhook" | "unc_agent" | "none";

type DriveStatus = {
  connected: boolean;
  email: string | null;
  folderId: string;
  folderLabel: string;
  oauthClientConfigured: boolean;
};

type Props = {
  canEdit: boolean;
  downloadFolder: string | null;
  conflictPolicy: "rename" | "skip" | "overwrite";
  artifactDestination: Destination;
  artifactWebhookUrl: string | null;
  artifactWebhookSecretConfigured?: boolean;
  onFolderChange: (path: string) => void;
  onPolicyChange: (policy: "rename" | "skip" | "overwrite") => void;
  onDestinationChange: (d: Destination) => void;
  onWebhookUrlChange: (url: string) => void;
  onWebhookSecretChange: (secret: string) => void;
};

export function DownloadFolderPanel({
  canEdit,
  downloadFolder,
  conflictPolicy,
  artifactDestination,
  artifactWebhookUrl,
  artifactWebhookSecretConfigured,
  onFolderChange,
  onPolicyChange,
  onDestinationChange,
  onWebhookUrlChange,
  onWebhookSecretChange,
}: Props) {
  const search = useSearchParams();
  const [pending, setPending] = useState<number | null>(null);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [webhookSecretDraft, setWebhookSecretDraft] = useState("");
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderLabelDraft, setFolderLabelDraft] = useState("Business artifacts");
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");
  const [localErr, setLocalErr] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [summary, driveStatus] = await Promise.all([
        fetchArtifactSyncSummary(),
        api<DriveStatus>("/profile/drive/status"),
      ]);
      setPending(summary.pending);
      setDrive(driveStatus);
      setFolderDraft(driveStatus.folderId || "");
      setFolderLabelDraft(driveStatus.folderLabel || "Business artifacts");
      const d = summary.delivery;
      if (d?.automationReady) {
        setDeliveryNote(
          `Company delivery active → ${String(d.effectiveDestination).replace(/_/g, " ")}. Staff PDFs go to the company folder automatically.`,
        );
      } else {
        setDeliveryNote(
          "Owner: connect the company Google account and save a shared folder — then every staff user’s documents land there automatically.",
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const driveParam = search.get("drive");
    if (driveParam === "connected") {
      setLocalMsg(
        "Company Google Drive connected. Paste the shared folder link and save — staff do not need to connect.",
      );
      void refresh();
    } else if (driveParam === "error") {
      setLocalErr(search.get("reason") || "Google Drive connect failed");
    }
  }, [search, refresh]);

  async function connectDrive() {
    setBusy(true);
    setLocalErr("");
    try {
      // Full navigation so cookies + OAuth redirect work cleanly
      window.location.href = apiUrl("/api/profile/drive/connect?redirect=1");
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "Could not start Google connect");
      setBusy(false);
    }
  }

  async function saveDriveFolder() {
    setBusy(true);
    setLocalErr("");
    setLocalMsg("");
    try {
      const folderId = extractDriveFolderId(folderDraft);
      if (!folderId) throw new Error("Paste a Google Drive folder link or ID");
      const saved = await api<DriveStatus>("/profile/drive/folder", {
        method: "PUT",
        body: JSON.stringify({
          folderId,
          folderLabel: folderLabelDraft || "Business artifacts",
        }),
      });
      setDrive((d) => (d ? { ...d, ...saved, connected: true } : saved));
      setLocalMsg(
        "Company folder saved. All staff on this Business Profile will upload tool PDFs here automatically.",
      );
      onDestinationChange(artifactDestination === "none" ? "auto" : artifactDestination);
      await refresh();
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "Could not save folder");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectDrive() {
    if (!confirm("Disconnect Google Drive for this Business Profile?")) return;
    setBusy(true);
    try {
      await api("/profile/drive/disconnect", { method: "POST", body: "{}" });
      setLocalMsg("Google Drive disconnected.");
      await refresh();
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  const showDrive =
    artifactDestination === "auto" ||
    artifactDestination === "google_drive" ||
    !artifactDestination;
  const showWebhook =
    artifactDestination === "auto" ||
    artifactDestination === "webhook" ||
    showAdvanced;
  const showUnc =
    artifactDestination === "unc_agent" || showAdvanced;

  return (
    <div className="panel">
      <h3 className="panel-title">Company document delivery</h3>
      <p className="section-note">
        JustX is multi-tenant: <strong>each company (Business Profile) configures its own
        destination</strong>. The Business Owner connects the <strong>company Google account</strong>{" "}
        once and picks a shared folder. After that, every staff member who logs into JustX on their
        own machine generates quotations/surveys as usual — those files are uploaded{" "}
        <strong>automatically to that company folder</strong>. Staff do not need Google access or
        Sync Center clicks.
      </p>
      <ul className="section-note" style={{ margin: "8px 0 12px", paddingLeft: 18, lineHeight: 1.5 }}>
        <li>
          Prefer a <strong>company / Workspace</strong> Google account (or Shared Drive), not a
          personal Gmail.
        </li>
        <li>
          Share the destination folder with your team in Google so employees can open files there.
        </li>
        <li>Other companies on JustX never see your Drive — connections are per Business Profile.</li>
      </ul>
      {deliveryNote ? <p className="section-note sync-msg-ok">{deliveryNote}</p> : null}
      <p className="section-note">
        Delivery queue: <strong>{pending == null ? "—" : pending}</strong> pending
        {" · "}
        <Link href="/sync">Sync Center</Link> (status / retries)
      </p>

      <label className="field">
        <span className="label">Where should this company&apos;s files go?</span>
        <select
          value={artifactDestination}
          disabled={!canEdit}
          onChange={(e) => onDestinationChange(e.target.value as Destination)}
        >
          <option value="auto">Recommended — Auto (company Drive, then webhook, then UNC)</option>
          <option value="google_drive">Company Google Drive shared folder</option>
          <option value="webhook">Corporate webhook (SharePoint / Power Automate)</option>
          <option value="unc_agent">Company file server (UNC) via desktop agent</option>
          <option value="none">Browser download only (no company folder)</option>
        </select>
      </label>

      {showDrive ? (
        <div className="sync-setup" style={{ marginTop: 8 }}>
          <h4 className="panel-subtitle">Company Google Drive (Owner setup once)</h4>
          <p className="section-note">
            <strong>Staff do not connect Google.</strong> Only the Business Owner links the company
            account below. All employees of this Business Profile then send documents into the same
            shared folder automatically.
          </p>
          {drive?.connected ? (
            <>
              <p className="section-note sync-msg-ok">
                Company Drive connected as <strong>{drive.email || "Google account"}</strong>
                {canEdit ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void disconnectDrive()}
                    >
                      Disconnect
                    </button>
                  </>
                ) : null}
              </p>
              <label className="field">
                <span className="label">Company shared folder link or ID</span>
                <input
                  value={folderDraft}
                  disabled={!canEdit}
                  placeholder="https://drive.google.com/drive/folders/..."
                  onChange={(e) => setFolderDraft(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Folder label</span>
                <input
                  value={folderLabelDraft}
                  disabled={!canEdit}
                  onChange={(e) => setFolderLabelDraft(e.target.value)}
                />
              </label>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void saveDriveFolder()}
                >
                  Save company folder
                </button>
              ) : null}
              {!canEdit ? (
                <p className="section-note">
                  You are Staff: keep using JustX tools normally. Your PDFs go to this company folder
                  when delivery is active.
                </p>
              ) : null}
            </>
          ) : (
            <>
              {!drive?.oauthClientConfigured ? (
                <p className="section-note sync-msg-err">
                  Platform Google login is not configured yet (GOOGLE_CLIENT_ID /
                  GOOGLE_CLIENT_SECRET). Ask your JustX admin — same keys as “Sign in with Google”.
                </p>
              ) : canEdit ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void connectDrive()}
                  >
                    Connect company Google Drive
                  </button>
                  <p className="section-note" style={{ marginTop: 8 }}>
                    Sign in with the company Workspace account (recommended), then paste the shared
                    folder link.
                  </p>
                </>
              ) : (
                <p className="section-note">
                  Ask the Business Owner to connect the company Google Drive. Staff cannot change
                  this — and do not need to.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {showWebhook ? (
        <div style={{ marginTop: 16 }}>
          <h4 className="panel-subtitle">Corporate webhook (optional alternative)</h4>
          <p className="section-note">
            Same multi-tenant idea for SharePoint: one webhook per company. All staff documents
            post to that flow automatically.
          </p>
          <label className="field">
            <span className="label">Webhook URL</span>
            <input
              value={artifactWebhookUrl ?? ""}
              disabled={!canEdit}
              placeholder="https://prod-xx.westus.logic.azure.com/workflows/..."
              onChange={(e) => onWebhookUrlChange(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">
              Webhook secret{" "}
              {artifactWebhookSecretConfigured ? "(saved — leave blank to keep)" : "(optional)"}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={webhookSecretDraft}
              disabled={!canEdit}
              onChange={(e) => {
                setWebhookSecretDraft(e.target.value);
                onWebhookSecretChange(e.target.value);
              }}
            />
          </label>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 12 }}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide" : "Show"} UNC / file-server options
      </button>

      {showUnc ? (
        <div style={{ marginTop: 8 }}>
          <h4 className="panel-subtitle">Company file server (optional)</h4>
          <p className="section-note">
            Only if this company needs a Windows share. Install one desktop agent on an office PC —
            all staff still only use JustX; files queue to the company path automatically.
          </p>
          <label className="field">
            <span className="label">Download Folder path</span>
            <input
              value={downloadFolder ?? ""}
              disabled={!canEdit}
              placeholder="\\fileserver\shared\business-artifacts"
              onChange={(e) => onFolderChange(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Conflict policy</span>
            <select
              value={conflictPolicy}
              disabled={!canEdit}
              onChange={(e) =>
                onPolicyChange(e.target.value as "rename" | "skip" | "overwrite")
              }
            >
              <option value="rename">Rename</option>
              <option value="skip">Skip if exists</option>
              <option value="overwrite">Overwrite</option>
            </select>
          </label>
        </div>
      ) : null}

      {localMsg ? <p className="section-note sync-msg-ok">{localMsg}</p> : null}
      {localErr ? <p className="section-note sync-msg-err">{localErr}</p> : null}
    </div>
  );
}
