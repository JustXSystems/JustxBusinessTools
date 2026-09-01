"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canEditBusinessProfile, canUseSyncCenter } from "@/lib/auth-access";
import {
  buildAgentLauncherScript,
  downloadTextFile,
  fetchArtifactSyncSummary,
  fetchPendingArtifacts,
  fetchSyncAgents,
  LOCAL_AGENT_BRIDGE,
  probeLocalAgent,
  registerSyncAgent,
  resolveAgentApiBase,
  retryArtifact,
  revokeSyncAgent,
  syncPendingViaFsa,
  triggerLocalAgentSync,
  type ArtifactListItem,
  type LocalAgentStatus,
  type SyncAgentRow,
} from "@/lib/artifact-delivery";
import {
  getFsaSupport,
  pickDownloadFolder,
  probeFsaFolder,
} from "@/lib/artifact-delivery/fsa";
import { fetchProfile } from "@/lib/api";

export default function SyncCenterPage() {
  const { user } = useAuth();
  const allowed = canUseSyncCenter(user);
  const canEditFolder = canEditBusinessProfile(user);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [downloadFolder, setDownloadFolder] = useState<string | null>(null);
  const [conflictPolicy, setConflictPolicy] = useState<"rename" | "skip" | "overwrite">("overwrite");
  const [items, setItems] = useState<ArtifactListItem[]>([]);
  const [agents, setAgents] = useState<SyncAgentRow[]>([]);
  const [fsaLabel, setFsaLabel] = useState("Checking…");
  const [localAgent, setLocalAgent] = useState<LocalAgentStatus | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [agentLabel, setAgentLabel] = useState("");
  const [deliveryInfo, setDeliveryInfo] = useState<{
    effectiveDestination: string;
    automationReady: boolean;
    serviceAccountEmail: string | null;
    driveConfigured: boolean;
  } | null>(null);

  const fsa = getFsaSupport();

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setError("");
    try {
      const [summary, list, agentList, local] = await Promise.all([
        fetchArtifactSyncSummary(),
        fetchPendingArtifacts(),
        fetchSyncAgents(),
        probeLocalAgent(),
      ]);
      setPending(summary.pending);
      setDownloadFolder(summary.downloadFolder ?? list.downloadFolder);
      setConflictPolicy(list.conflictPolicy || "overwrite");
      setItems(list.items);
      setAgents(agentList.items);
      setLocalAgent(local);
      if (summary.delivery) {
        setDeliveryInfo({
          effectiveDestination: summary.delivery.effectiveDestination,
          automationReady: summary.delivery.automationReady,
          serviceAccountEmail: summary.delivery.googleDrive.email,
          driveConfigured:
            summary.delivery.googleDrive.connected ||
            summary.delivery.googleDrive.oauthClientConfigured,
        });
      } else {
        setDeliveryInfo(null);
      }
      if (fsa.supported) {
        const probe = await probeFsaFolder();
        setFsaLabel(
          probe.ok
            ? `Linked: ${probe.name}`
            : probe.error || "Not linked in this browser",
        );
      } else {
        setFsaLabel("Not available in this browser");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sync status");
    } finally {
      setLoading(false);
    }
  }, [allowed, fsa.supported]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function runFsaSync() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await syncPendingViaFsa(conflictPolicy);
      setMessage(
        result.failed
          ? `Synced ${result.synced}, failed ${result.failed}. ${result.errors[0] || ""}`
          : `Synced ${result.synced} file(s) to ${result.folderName || "linked folder"}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAgentSync() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await triggerLocalAgentSync();
      if (result.inaccessible) {
        setError(result.message || "Download Folder not reachable from the agent PC");
      } else {
        setMessage(
          `Desktop agent synced ${result.synced ?? 0} file(s)` +
            (result.failed ? `, failed ${result.failed}` : "") +
            ".",
        );
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — is the desktop agent running on this PC?`
          : "Could not reach local agent",
      );
    } finally {
      setBusy(false);
    }
  }

  async function linkFolder() {
    setBusy(true);
    setError("");
    try {
      const handle = await pickDownloadFolder();
      setFsaLabel(`Linked: ${handle.name}`);
      setMessage("Folder linked in this browser. Click Sync now (this browser).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link folder");
    } finally {
      setBusy(false);
    }
  }

  async function createTokenAndLauncher() {
    setBusy(true);
    setError("");
    setNewToken(null);
    try {
      const profile = await fetchProfile().catch(() => null);
      const res = await registerSyncAgent(
        agentLabel.trim() || `${user?.name || user?.email || "Staff"} PC`,
      );
      setNewToken(res.token);
      const script = buildAgentLauncherScript({
        token: res.token,
        apiBase: resolveAgentApiBase(),
        downloadFolder: profile?.downloadFolder ?? downloadFolder,
      });
      downloadTextFile("start-justx-sync-agent.ps1", script);
      setMessage(
        "Agent token created and launcher downloaded. Run the .ps1 on a PC that can reach the share, then click Sync now (desktop agent).",
      );
      setSetupOpen(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setMessage("Token copied to clipboard.");
    } catch {
      setError("Could not copy token");
    }
  }

  if (!allowed) {
    return (
      <div className="page">
        <h1 className="page-title">Sync Center</h1>
        <p className="section-note">
          Only Business Owners and Staff can sync artifacts to the Download Folder.
        </p>
        <Link href="/" className="btn btn-secondary">
          Back to Home
        </Link>
      </div>
    );
  }

  const agentOnline = Boolean(localAgent?.ok);
  const folderMissing = !downloadFolder?.trim();

  return (
    <div className="page sync-center-page">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Sync Center</h1>
          <p className="section-note" style={{ marginTop: 4 }}>
            Each company (Business Profile) has its own destination. Staff only use JustX tools —
            documents go to the company Drive/webhook automatically. Use this page for status,
            retries, and optional UNC agent setup.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {folderMissing && deliveryInfo?.effectiveDestination === "unc_agent" ? (
        <div className="panel" style={{ borderColor: "rgba(245,166,35,0.45)" }}>
          <p className="section-note" style={{ margin: 0 }}>
            No Download Folder path is set yet.
            {canEditFolder ? (
              <>
                {" "}
                Set it in <Link href="/profile">Business Profile</Link>, then return here to sync.
              </>
            ) : (
              <> Ask a Business Owner to set it under Business Profile.</>
            )}
          </p>
        </div>
      ) : null}

      {deliveryInfo ? (
        <div className="panel">
          <h3 className="panel-title">Company automatic delivery</h3>
          <p className="section-note" style={{ marginBottom: 8 }}>
            Effective destination:{" "}
            <strong>{deliveryInfo.effectiveDestination.replace(/_/g, " ")}</strong>
            {deliveryInfo.automationReady
              ? " — every staff user’s tool PDFs for this Business Profile go here without Sync Center clicks."
              : " — Business Owner should connect company Google Drive (or webhook) on Business Profile."}
          </p>
          {deliveryInfo?.driveConfigured && deliveryInfo.serviceAccountEmail ? (
            <p className="section-note">
              Company Drive connected as <code>{deliveryInfo.serviceAccountEmail}</code>. Staff do
              not need Google accounts for upload.
            </p>
          ) : (
            <p className="section-note">
              Owner setup: Business Profile → Connect company Google Drive → save shared folder.
              Other companies on JustX use their own connections.
            </p>
          )}
          <Link href="/profile" className="btn btn-secondary btn-sm">
            Configure on Business Profile
          </Link>
        </div>
      ) : null}

      <div className="sync-status-grid">
        <div className="panel sync-stat">
          <span className="sync-stat-label">Pending</span>
          <strong className="sync-stat-value">{loading ? "…" : pending}</strong>
          <span className="section-note">Waiting for folder sync</span>
        </div>
        <div className="panel sync-stat">
          <span className="sync-stat-label">Download Folder</span>
          <strong className="sync-stat-path">{downloadFolder || "—"}</strong>
          <span className="section-note">Profile target (UNC / absolute)</span>
        </div>
        <div className="panel sync-stat">
          <span className="sync-stat-label">This browser</span>
          <strong className="sync-stat-value" style={{ fontSize: 15 }}>
            {fsaLabel}
          </strong>
          <span className="section-note">File System Access</span>
        </div>
        <div className="panel sync-stat">
          <span className="sync-stat-label">Desktop agent</span>
          <strong className="sync-stat-value" style={{ fontSize: 15 }}>
            {agentOnline ? "Connected on this PC" : "Not detected"}
          </strong>
          <span className="section-note">{LOCAL_AGENT_BRIDGE}</span>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Sync now</h3>
        <p className="section-note">
          Prefer the desktop agent for UNC/network shares. Use this browser when you have linked a
          folder in Chrome/Edge on a machine that can see the files.
        </p>
        <div className="sync-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !agentOnline || pending === 0}
            onClick={() => void runAgentSync()}
          >
            Sync now (desktop agent)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !fsa.supported || pending === 0}
            onClick={() => void runFsaSync()}
          >
            Sync now (this browser)
          </button>
          {fsa.supported ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void linkFolder()}
            >
              Link folder in this browser
            </button>
          ) : null}
        </div>
        {localAgent?.lastResult ? (
          <p className="section-note" style={{ marginTop: 12 }}>
            Last agent run: synced {localAgent.lastResult.synced ?? 0}
            {localAgent.lastResult.failed ? `, failed ${localAgent.lastResult.failed}` : ""}
            {localAgent.lastFinishedAt
              ? ` · ${new Date(localAgent.lastFinishedAt).toLocaleString()}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="panel">
        <div className="page-header-row" style={{ marginBottom: 8 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>
            Connect desktop agent
          </h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setSetupOpen((v) => !v)}
          >
            {setupOpen ? "Hide setup" : "Set up on this PC"}
          </button>
        </div>
        <p className="section-note">
          Owners and Staff can each create a token, download a launcher, and run the agent on any PC
          that reaches the share. The Sync Center then detects the local bridge and completes sync.
        </p>

        {setupOpen ? (
          <div className="sync-setup">
            <ol className="sync-setup-steps">
              <li>Confirm the Download Folder path is set on Business Profile.</li>
              <li>Create a token and download the PowerShell launcher (below).</li>
              <li>
                On the PC with share access, open PowerShell and run:{" "}
                <code>powershell -ExecutionPolicy Bypass -File .\\start-justx-sync-agent.ps1</code>
              </li>
              <li>
                Keep the agent window open. Return here and click{" "}
                <strong>Sync now (desktop agent)</strong>.
              </li>
            </ol>
            <label className="field">
              <span className="label">Agent label (optional)</span>
              <input
                value={agentLabel}
                onChange={(e) => setAgentLabel(e.target.value)}
                placeholder={`${user?.name || "Staff"} office PC`}
              />
            </label>
            <div className="sync-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void createTokenAndLauncher()}
              >
                Create token + download launcher
              </button>
              {newToken ? (
                <button type="button" className="btn btn-secondary" onClick={() => void copyToken()}>
                  Copy token
                </button>
              ) : null}
            </div>
            {newToken ? (
              <p className="section-note" style={{ marginTop: 10, wordBreak: "break-all" }}>
                Token (shown once): <code>{newToken}</code>
              </p>
            ) : null}
            <p className="section-note" style={{ marginTop: 10 }}>
              Manual start from repo: set <code>JBT_API_BASE</code> / <code>JBT_AGENT_TOKEN</code>, then{" "}
              <code>npm start</code> in <code>desktop-sync-agent</code>. Bridge listens on{" "}
              <code>{LOCAL_AGENT_BRIDGE}</code>.
            </p>
          </div>
        ) : null}

        {agents.length ? (
          <div className="sync-agent-list" style={{ marginTop: 14 }}>
            <h4 className="panel-subtitle">Registered agents</h4>
            <ul className="sync-agent-ul">
              {agents.map((a) => (
                <li key={a.id} className="sync-agent-row">
                  <div>
                    <strong>{a.label || a.id}</strong>
                    <span className="section-note" style={{ display: "block" }}>
                      {a.revokedAt
                        ? "Revoked"
                        : a.online
                          ? "Recently active"
                          : "Idle / offline"}
                      {a.lastProbePath ? ` · ${a.lastProbePath}` : ""}
                      {a.lastProbeError && !a.lastProbeOk ? ` · ${a.lastProbeError}` : ""}
                    </span>
                  </div>
                  {!a.revokedAt ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void revokeSyncAgent(a.id)
                          .then(() => refresh())
                          .catch((err: Error) => setError(err.message))
                      }
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h3 className="panel-title">Pending files</h3>
        {loading ? (
          <p className="section-note">Loading…</p>
        ) : items.length === 0 ? (
          <p className="section-note">Nothing pending — all caught up.</p>
        ) : (
          <ul className="sync-file-ul">
            {items.map((item) => (
              <li key={item.id} className="sync-file-row">
                <div>
                  <strong>{item.originalFilename}</strong>
                  <span className="section-note" style={{ display: "block" }}>
                    {item.toolId} · {item.syncStatus}
                    {item.lastError ? ` · ${item.lastError}` : ""}
                    {" · "}
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                {item.syncStatus === "failed" || item.syncStatus === "conflict" ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void retryArtifact(item.id)
                        .then(() => refresh())
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {message ? <p className="section-note sync-msg-ok">{message}</p> : null}
      {error ? <p className="section-note sync-msg-err">{error}</p> : null}
    </div>
  );
}
