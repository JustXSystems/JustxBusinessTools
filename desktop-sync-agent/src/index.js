#!/usr/bin/env node
/**
 * JustX Desktop Sync Agent
 *
 * Polls / can be triggered from the web Sync Center via a localhost bridge
 * (http://127.0.0.1:17865) so staff/owners can click "Sync now" in the UI.
 *
 * Env:
 *   JBT_API_BASE   — e.g. https://app.example.com/api
 *   JBT_AGENT_TOKEN — jxsa_... from Sync Center
 *   JBT_DOWNLOAD_FOLDER — optional override
 *   JBT_POLL_MS — default 15000 (set 0 to disable background poll; UI-only)
 *   JBT_BRIDGE_PORT — default 17865
 *   JBT_BRIDGE_ORIGIN — CORS allowlist comma-separated (default *)
 */

import http from "node:http";
import { access, mkdir, writeFile, rename as renameFile, stat, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = (process.env.JBT_API_BASE ?? "http://localhost:4000/api").replace(/\/$/, "");
const TOKEN = process.env.JBT_AGENT_TOKEN ?? "";
const POLL_MS = Number(process.env.JBT_POLL_MS ?? 15000);
const BRIDGE_PORT = Math.min(Math.max(Number(process.env.JBT_BRIDGE_PORT) || 17865, 1024), 65535);
const BRIDGE_ORIGINS = String(process.env.JBT_BRIDGE_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ONCE = process.argv.includes("--once");
const NO_BRIDGE = process.argv.includes("--no-bridge");

if (!TOKEN.startsWith("jxsa_")) {
  console.error("Set JBT_AGENT_TOKEN to a token from Sync Center → Connect desktop agent");
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
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
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
  const filename = (compose.filename || "quotation.pdf").replace(/[<>:"/\\|?*]/g, "_");
  if (!compose.pdfBase64) {
    throw new Error("Outbox item has no PDF attachment");
  }

  const tmpDir = path.join(os.tmpdir(), "jbt-email");
  await mkdir(tmpDir, { recursive: true });
  const pdfPath = path.join(tmpDir, `${outboxId}_${filename}`);
  await writeFile(pdfPath, Buffer.from(compose.pdfBase64, "base64"));

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
$mail.Body = ${psQuote(body)}
$mail.Attachments.Add(${psQuote(pdfPath)}) | Out-Null
$mail.Display()
'ok'
`.trim();

  try {
    await runPowershell(script);
    await api(`/email-outbox/${encodeURIComponent(outboxId)}/agent-opened`, {
      method: "POST",
      body: "{}",
    }).catch(() => undefined);
    return { ok: true, message: "Outlook compose opened with PDF attached", pdfPath };
  } finally {
    setTimeout(() => {
      unlink(pdfPath).catch(() => undefined);
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
        sendJson(res, 200, { ok: true, service: "jbt-sync-agent", startedAt: state.startedAt }, cors);
        return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(
          res,
          200,
          {
            ok: true,
            running: state.running,
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

async function main() {
  console.log(`JustX sync agent → ${API_BASE}`);
  if (!NO_BRIDGE && !ONCE) startBridge();

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
