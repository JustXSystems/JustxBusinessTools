import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { withBasePath } from "@/lib/base-path";

export const WIN_SETUP_PACK_PATH = "/JustX-Sync-Agent-win-x64.zip";
export const WIN_SETUP_ROOT = "JustX-Sync-Agent";
export const AGENT_PACK_VERSION = "1.1.0";

export type AgentSetupConfig = {
  apiBase: string;
  agentToken: string;
  downloadFolder?: string | null;
  pollMs?: number;
  bridgePort?: number;
  packVersion?: string;
};

export function resolveWinSetupPackUrl(): string {
  if (typeof window === "undefined") return WIN_SETUP_PACK_PATH;
  return `${window.location.origin}${withBasePath(WIN_SETUP_PACK_PATH)}`;
}

export function buildAgentConfigJson(input: AgentSetupConfig): string {
  return `${JSON.stringify(
    {
      apiBase: input.apiBase,
      agentToken: input.agentToken,
      downloadFolder: input.downloadFolder || null,
      pollMs: input.pollMs ?? 15000,
      bridgePort: input.bridgePort ?? 17865,
      packVersion: input.packVersion || AGENT_PACK_VERSION,
    },
    null,
    2,
  )}\n`;
}

/**
 * Take the published base Windows pack and inject config.json for this token.
 */
export function personalizeWinSetupZip(
  baseZipBytes: Uint8Array,
  config: AgentSetupConfig,
): Uint8Array {
  const entries = unzipSync(baseZipBytes);
  const configPath = `${WIN_SETUP_ROOT}/config.json`;
  entries[configPath] = strToU8(buildAgentConfigJson(config));

  // Sanity: required install entry must exist
  const installKey = Object.keys(entries).find((k) =>
    k.replace(/\\/g, "/").endsWith("Install JustX Sync Agent.cmd"),
  );
  if (!installKey) {
    throw new Error("Setup pack is missing Install JustX Sync Agent.cmd — redeploy web pack");
  }
  const nodeKey = Object.keys(entries).find((k) =>
    k.replace(/\\/g, "/").endsWith("runtime/node.exe"),
  );
  if (!nodeKey) {
    throw new Error("Setup pack is missing runtime/node.exe — redeploy web pack");
  }

  return zipSync(entries, { level: 6 });
}

export function downloadBinaryFile(filename: string, bytes: Uint8Array, mime = "application/zip") {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
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

export async function fetchAndPersonalizeWinSetup(config: AgentSetupConfig): Promise<Uint8Array> {
  const url = resolveWinSetupPackUrl();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Could not download Windows setup pack (${res.status}). Deploy may be missing JustX-Sync-Agent-win-x64.zip.`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 1_000_000) {
    throw new Error("Windows setup pack looks incomplete. Rebuild with npm run pack:agent:win");
  }
  return personalizeWinSetupZip(buf, config);
}

/** Dev helper: read START-HERE from a personalized zip (tests). */
export function readZipTextEntry(zipBytes: Uint8Array, entryName: string): string | null {
  const entries = unzipSync(zipBytes);
  const hit = Object.keys(entries).find(
    (k) => k.replace(/\\/g, "/") === entryName.replace(/\\/g, "/"),
  );
  if (!hit) return null;
  return strFromU8(entries[hit]);
}
