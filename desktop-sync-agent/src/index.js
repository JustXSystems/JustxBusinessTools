#!/usr/bin/env node
/**
 * JustX Desktop Sync Agent
 *
 * Polls / can be triggered from the web Sync Center via a localhost bridge
 * (http://127.0.0.1:17865) so staff/owners can click "Sync now" in the UI.
 *
 * Config (env wins over config.json):
 *   JBT_API_BASE / apiBase
 *   JBT_AGENT_TOKEN / agentToken
 *   JBT_DOWNLOAD_FOLDER / downloadFolder
 *   JBT_POLL_MS / pollMs
 *   JBT_BRIDGE_PORT / bridgePort
 *   JBT_BRIDGE_ORIGIN
 *   JBT_CONFIG — optional path to config.json
 */

import http from "node:http";
import { access, mkdir, writeFile, rename as renameFile, stat, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const AGENT_VERSION = "1.1.3";

function loadFileConfig() {
  const candidates = [];
  if (process.env.JBT_CONFIG) candidates.push(process.env.JBT_CONFIG);
  candidates.push(path.join(process.cwd(), "config.json"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // app/src -> install root config.json
    candidates.push(path.join(here, "..", "..", "config.json"));
    candidates.push(path.join(here, "..", "config.json"));
  } catch {
    // ignore
  }
  for (const p of candidates) {
    try {
      if (!p || !existsSync(p)) continue;
      const text = readFileSync(p, "utf8").replace(/^\uFEFF/, "");
      const raw = JSON.parse(text);
      if (raw && typeof raw === "object") return { ...raw, _configPath: p };
    } catch {
      // try next
    }
  }
  return {};
}

const fileCfg = loadFileConfig();
if (!process.env.JBT_DOWNLOAD_FOLDER && fileCfg.downloadFolder) {
  process.env.JBT_DOWNLOAD_FOLDER = String(fileCfg.downloadFolder);
}

const API_BASE = String(process.env.JBT_API_BASE || fileCfg.apiBase || "http://localhost:4000/api").replace(
  /\/$/,
  "",
);
const TOKEN = String(process.env.JBT_AGENT_TOKEN || fileCfg.agentToken || "");
const POLL_MS = Number(process.env.JBT_POLL_MS ?? fileCfg.pollMs ?? 15000);
const BRIDGE_PORT = Math.min(
  Math.max(Number(process.env.JBT_BRIDGE_PORT || fileCfg.bridgePort) || 17865, 1024),
  65535,
);
const BRIDGE_ORIGINS = String(process.env.JBT_BRIDGE_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PACK_VERSION = String(fileCfg.packVersion || AGENT_VERSION);
const ONCE = process.argv.includes("--once");
const NO_BRIDGE = process.argv.includes("--no-bridge");

if (!TOKEN.startsWith("jxsa_")) {
  console.error("Set JBT_AGENT_TOKEN (or config.json agentToken) from Sync Center → Download setup");
  process.exit(1);
}

const state = {
  running: false,
  lastResult: null,
  lastError: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  folder: null,
  folderOk: null,
  startedAt: new Date().toISOString(),
};

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function api(pathname, init) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `API returned non-JSON (${res.status}) from ${API_BASE}${pathname}. ` +
        `Check JBT_API_BASE (production must end with /jbt/api). Got: ${snippet}`,
    );
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (contentType && !contentType.includes("json") && text && !Object.keys(data).length) {
    throw new Error(`API returned unexpected content-type ${contentType} from ${API_BASE}`);
  }
  return data;
}

async function probeFolder(folder) {
  try {
    await access(folder, fsConstants.W_OK);
    await api("/artifacts/agent/probe", {
      method: "POST",
      body: JSON.stringify({ ok: true, path: folder }),
    });
    state.folder = folder;
    state.folderOk = true;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.folder = folder;
    state.folderOk = false;
    await api("/artifacts/agent/probe", {
      method: "POST",
      body: JSON.stringify({ ok: false, path: folder, error: msg }),
    }).catch(() => undefined);
    return { ok: false, error: msg };
  }
}

function conflictName(base, attempt) {
  const i = base.lastIndexOf(".");
  if (i <= 0) return `${base} (${attempt})`;
  return `${base.slice(0, i)} (${attempt})${base.slice(i)}`;
}

async function resolveDest(folder, filename, policy) {
  let name = filename;
  const target = () => path.join(folder, name);
  if (policy === "overwrite") return target();
  if (policy === "skip") {
    try {
      await stat(target());
      return null;
    } catch {
      return target();
    }
  }
  for (let n = 0; n < 50; n++) {
    name = n === 0 ? filename : conflictName(filename, n);
    try {
      await stat(target());
    } catch {
      return target();
    }
  }
  return target();
}

async function downloadContent(id) {
  const res = await fetch(`${API_BASE}/artifacts/${id}/content`, { headers: headers() });
  if (!res.ok) throw new Error(`Content download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, hash: res.headers.get("x-content-hash") };
}

async function writeAtomic(dest, buf) {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.jbt-partial`;
  await writeFile(tmp, buf);
  await renameFile(tmp, dest);
}

export async function syncOnce() {
  if (state.running) {
    return { synced: 0, failed: 0, skipped: true, message: "Sync already running" };
  }
  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  try {
    const list = await api("/artifacts?pending=1&limit=50");
    const folder =
      (process.env.JBT_DOWNLOAD_FOLDER || "").trim() ||
      (list.downloadFolder || "").trim();
    if (!folder) {
      const result = {
        synced: 0,
        failed: 0,
        inaccessible: true,
        message: "No Download Folder configured on the Business Profile",
      };
      state.lastResult = result;
      return result;
    }

    const probe = await probeFolder(folder);
    if (!probe.ok) {
      const result = {
        synced: 0,
        failed: 0,
        inaccessible: true,
        message: probe.error || "Folder not accessible",
      };
      state.lastResult = result;
      return result;
    }

    const policy = list.conflictPolicy || "overwrite";
    let synced = 0;
    let failed = 0;
    const details = [];

    for (const item of list.items || []) {
      try {
        await api(`/artifacts/${item.id}/ack`, {
          method: "POST",
          body: JSON.stringify({ status: "in_progress", channel: "desktop_agent" }),
        });
        const { buf } = await downloadContent(item.id);
        const dest = await resolveDest(folder, item.originalFilename, policy);
        if (!dest) {
          await api(`/artifacts/${item.id}/ack`, {
            method: "POST",
            body: JSON.stringify({
              status: "skipped_duplicate",
              channel: "desktop_agent",
              destinationPath: path.join(folder, item.originalFilename),
            }),
          });
          synced += 1;
          details.push({ id: item.id, status: "skipped_duplicate" });
          continue;
        }
        await writeAtomic(dest, buf);
        await api(`/artifacts/${item.id}/ack`, {
          method: "POST",
          body: JSON.stringify({
            status: "synced",
            channel: "desktop_agent",
            destinationPath: dest,
          }),
        });
        console.log(`Synced ${item.originalFilename} → ${dest}`);
        synced += 1;
        details.push({ id: item.id, status: "synced", path: dest });
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed ${item.id}: ${msg}`);
        details.push({ id: item.id, status: "failed", error: msg });
        await api(`/artifacts/${item.id}/ack`, {
          method: "POST",
          body: JSON.stringify({
            status: "failed",
            channel: "desktop_agent",
            error: msg,
          }),
        }).catch(() => undefined);
      }
    }
    const result = { synced, failed, folder, details };
    state.lastResult = result;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = msg;
    throw err;
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date().toISOString();
  }
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || "");
  const allow =
    BRIDGE_ORIGINS.includes("*") || !origin
      ? "*"
      : BRIDGE_ORIGINS.includes(origin)
        ? origin
        : BRIDGE_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function runPowershell(script) {
  return new Promise((resolve, reject) => {
    // Avoid -NonInteractive: Outlook.Display() can fail under that flag on some hosts.
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exit ${code}`));
    });
  });
}

/** Run a .ps1 file — required for large HTML bodies (Windows -Command max ~8191 chars). */
function runPowershellFile(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exit ${code}`));
    });
  });
}

function psQuote(s) {
  return `'${String(s ?? "").replace(/'/g, "''")}'`;
}

/** Open Outlook compose with PDF attachment (Windows + Outlook). */
export async function openEmailCompose(outboxId) {
  if (process.platform !== "win32") {
    throw new Error("Open in Outlook is only supported on Windows with desktop Outlook installed");
  }
  const data = await api(`/email-outbox/${encodeURIComponent(outboxId)}/agent-compose`);
  const compose = data.compose || {};
  const to = compose.to || "";
  const cc = compose.cc || "";
  const subject = compose.subject || "";
  const body = compose.body || "";
  const html = String(compose.html || "").trim();
  const filename = (compose.filename || "quotation.pdf").replace(/[<>:"/\\|?*]/g, "_");
  if (!compose.pdfBase64) {
    throw new Error("Outbox item has no PDF attachment");
  }

  const tmpDir = path.join(os.tmpdir(), "jbt-email");
  await mkdir(tmpDir, { recursive: true });
  const pdfPath = path.join(tmpDir, `${outboxId}_${filename}`);
  const bodyPath = path.join(tmpDir, `${outboxId}_body.txt`);
  const htmlPath = path.join(tmpDir, `${outboxId}_body.html`);
  const ps1Path = path.join(tmpDir, `${outboxId}_open.ps1`);
  await writeFile(pdfPath, Buffer.from(compose.pdfBase64, "base64"));

  // Corporate HTML is often >8KB. Never put it on powershell -Command (Windows limit ~8191).
  // Write body/html to temp files and drive Outlook from a -File script.
  const useHtml = Boolean(html);
  if (useHtml) {
    await writeFile(htmlPath, html, "utf8");
  } else {
    await writeFile(bodyPath, body, "utf8");
  }

  const script = `
$ErrorActionPreference = 'Stop'
try {
  $outlook = New-Object -ComObject Outlook.Application
} catch {
  throw 'Microsoft Outlook is not installed or COM is unavailable on this PC'
}
$mail = $outlook.CreateItem(0)
$mail.To = ${psQuote(to)}
$mail.CC = ${psQuote(cc)}
$mail.Subject = ${psQuote(subject)}
${
  useHtml
    ? `$html = Get-Content -LiteralPath ${psQuote(htmlPath)} -Raw -Encoding UTF8
if (-not $html) { throw 'HTML body file was empty' }
$mail.BodyFormat = 2
$mail.HTMLBody = $html
if ($mail.BodyFormat -ne 2) { throw 'Outlook refused HTML body format (BodyFormat=' + $mail.BodyFormat + ')' }`
    : `$plain = Get-Content -LiteralPath ${psQuote(bodyPath)} -Raw -Encoding UTF8
$mail.BodyFormat = 1
$mail.Body = $plain`
}
$mail.Attachments.Add(${psQuote(pdfPath)}) | Out-Null
$mail.Display($true) | Out-Null
Write-Output 'ok'
`.trim();

  await writeFile(ps1Path, script, "utf8");

  try {
    await runPowershellFile(ps1Path);
    await api(`/email-outbox/${encodeURIComponent(outboxId)}/agent-opened`, {
      method: "POST",
      body: "{}",
    }).catch(() => undefined);
    return {
      ok: true,
      message: useHtml
        ? "Outlook compose opened with HTML body and PDF attached"
        : "Outlook compose opened with PDF attached",
      pdfPath,
      html: useHtml,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await api(`/email-outbox/${encodeURIComponent(outboxId)}/agent-open-failed`, {
      method: "POST",
      body: JSON.stringify({ error: msg }),
    }).catch(() => undefined);
    throw err;
  } finally {
    setTimeout(() => {
      unlink(pdfPath).catch(() => undefined);
      unlink(bodyPath).catch(() => undefined);
      unlink(htmlPath).catch(() => undefined);
      unlink(ps1Path).catch(() => undefined);
    }, 60_000);
  }
}

function startBridge() {
  const server = http.createServer(async (req, res) => {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${BRIDGE_PORT}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        sendJson(
          res,
          200,
          {
            ok: true,
            service: "jbt-sync-agent",
            version: AGENT_VERSION,
            packVersion: PACK_VERSION,
            startedAt: state.startedAt,
          },
          cors,
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(
          res,
          200,
          {
            ok: true,
            running: state.running,
            version: AGENT_VERSION,
            packVersion: PACK_VERSION,
            apiBase: API_BASE,
            folder: state.folder,
            folderOk: state.folderOk,
            lastResult: state.lastResult,
            lastError: state.lastError,
            lastStartedAt: state.lastStartedAt,
            lastFinishedAt: state.lastFinishedAt,
            startedAt: state.startedAt,
            pollMs: POLL_MS,
            outlookCompose: process.platform === "win32",
          },
          cors,
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/sync-once") {
        const result = await syncOnce();
        sendJson(res, 200, { ok: true, ...result }, cors);
        return;
      }
      if (req.method === "POST" && url.pathname === "/open-email") {
        const body = await readJsonBody(req);
        const outboxId = String(body.outboxId || "").trim();
        if (!outboxId) {
          sendJson(res, 400, { error: "outboxId required" }, cors);
          return;
        }
        const result = await openEmailCompose(outboxId);
        sendJson(res, 200, result, cors);
        return;
      }
      sendJson(res, 404, { error: "Not found" }, cors);
    } catch (err) {
      sendJson(
        res,
        500,
        { error: err instanceof Error ? err.message : String(err) },
        cors,
      );
    }
  });

  server.listen(BRIDGE_PORT, "127.0.0.1", () => {
    console.log(`Sync Center bridge: http://127.0.0.1:${BRIDGE_PORT}`);
  });
  return server;
}

async function bridgeAlreadyHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`, {
      signal: AbortSignal.timeout(900),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.ok && data?.service === "jbt-sync-agent");
  } catch {
    return false;
  }
}

async function main() {
  console.log(`JustX sync agent v${AGENT_VERSION} → ${API_BASE}`);
  if (fileCfg._configPath) console.log(`Config: ${fileCfg._configPath}`);

  if (!NO_BRIDGE && !ONCE) {
    if (await bridgeAlreadyHealthy()) {
      console.log(`Bridge already healthy on http://127.0.0.1:${BRIDGE_PORT} — exiting.`);
      process.exit(0);
    }
    startBridge();
  }

  if (ONCE) {
    const result = await syncOnce();
    console.log(
      `synced=${result.synced} failed=${result.failed}${
        result.inaccessible ? ` (${result.message || "inaccessible"})` : ""
      }`,
    );
    return;
  }

  // Background poll (optional). UI can still trigger /sync-once anytime.
  if (POLL_MS > 0) {
    do {
      try {
        const result = await syncOnce();
        if (!result.skipped) {
          console.log(
            `[${new Date().toISOString()}] synced=${result.synced} failed=${result.failed}${
              result.inaccessible ? ` (${result.message || "inaccessible"})` : ""
            }`,
          );
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
      await sleep(Math.max(POLL_MS, 3000));
    } while (true);
  } else {
    console.log("Background poll disabled (JBT_POLL_MS=0). Use Sync Center → Sync now.");
    await new Promise(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
