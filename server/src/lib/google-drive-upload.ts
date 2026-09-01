import { createHash, createPrivateKey, createSign, createHmac, randomBytes } from "node:crypto";

type DriveConfig = {
  clientEmail: string;
  privateKey: string;
};

export type DriveConflictPolicy = "rename" | "skip" | "overwrite";

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  filename: string;
  action: "created" | "updated" | "skipped";
};

type DriveFileHit = {
  id: string;
  name: string;
  webViewLink: string | null;
  modifiedTime: string | null;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function getGoogleDriveServiceConfig(): DriveConfig | null {
  const clientEmail = (process.env.GOOGLE_DRIVE_CLIENT_EMAIL ?? "").trim();
  let privateKey = (process.env.GOOGLE_DRIVE_PRIVATE_KEY ?? "").trim();
  if (!clientEmail || !privateKey) return null;
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { clientEmail, privateKey };
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(getGoogleDriveServiceConfig());
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf.toString("base64url");
}

async function getAccessToken(): Promise<string> {
  const cfg = getGoogleDriveServiceConfig();
  if (!cfg) throw new Error("Google Drive is not configured on the server");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = createPrivateKey(cfg.privateKey);
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = b64url(signer.sign(key));
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text.slice(0, 180)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token response missing access_token");
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return data.access_token;
}

/** Escape a value for use inside a Drive `q` single-quoted string. */
export function escapeDriveQueryValue(value: string): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Same naming pattern as FSA / desktop agent: `name (1).ext`. */
export function conflictFilename(base: string, attempt: number): string {
  const i = base.lastIndexOf(".");
  if (i <= 0) return `${base} (${attempt})`;
  return `${base.slice(0, i)} (${attempt})${base.slice(i)}`;
}

export function pickNewestDriveFile(files: DriveFileHit[]): DriveFileHit | null {
  if (!files.length) return null;
  return [...files].sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return tb - ta;
  })[0]!;
}

/**
 * Pure planner for unit tests: given existing same-name hits, decide create/update/skip/rename target.
 */
export function planDriveConflict(input: {
  policy: DriveConflictPolicy;
  filename: string;
  existingSameName: DriveFileHit[];
  /** For rename: names already taken in the folder (candidates checked so far). */
  takenNames?: Set<string>;
}):
  | { action: "create"; filename: string }
  | { action: "update"; fileId: string; filename: string }
  | { action: "skip"; fileId: string; filename: string; webViewLink: string | null } {
  const newest = pickNewestDriveFile(input.existingSameName);
  if (!newest) return { action: "create", filename: input.filename };

  if (input.policy === "skip") {
    return {
      action: "skip",
      fileId: newest.id,
      filename: input.filename,
      webViewLink: newest.webViewLink,
    };
  }
  if (input.policy === "overwrite") {
    return { action: "update", fileId: newest.id, filename: input.filename };
  }

  const taken = input.takenNames ?? new Set(input.existingSameName.map((f) => f.name));
  for (let n = 1; n < 50; n++) {
    const candidate = conflictFilename(input.filename, n);
    if (!taken.has(candidate)) return { action: "create", filename: candidate };
  }
  return { action: "create", filename: conflictFilename(input.filename, Date.now()) };
}

async function resolveDriveToken(accessToken?: string): Promise<string> {
  const token = accessToken?.trim() || (await getAccessToken());
  if (!token) throw new Error("Google Drive access token is required");
  return token;
}

async function findFilesByNameInFolder(
  token: string,
  folderId: string,
  filename: string,
): Promise<DriveFileHit[]> {
  const q = [
    `name = '${escapeDriveQueryValue(filename)}'`,
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("pageSize", "25");
  url.searchParams.set("fields", "files(id,name,webViewLink,modifiedTime)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive lookup failed (${res.status}): ${text.slice(0, 220)}`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id?: string;
      name?: string;
      webViewLink?: string;
      modifiedTime?: string;
    }>;
  };
  return (data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      webViewLink: f.webViewLink ?? null,
      modifiedTime: f.modifiedTime ?? null,
    }));
}

async function createDriveFile(
  token: string,
  input: { folderId: string; filename: string; mimeType: string; buffer: Buffer },
): Promise<DriveUploadResult> {
  const boundary = `jbt_${randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({
    name: input.filename,
    parents: [input.folderId],
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.mimeType || "application/octet-stream"}\r\n\r\n`,
      "utf8",
    ),
    input.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive upload failed (${res.status}): ${text.slice(0, 220)}`);
  }
  const data = (await res.json()) as { id?: string; webViewLink?: string; name?: string };
  if (!data.id) throw new Error("Google Drive upload returned no file id");
  return {
    fileId: data.id,
    webViewLink: data.webViewLink ?? null,
    filename: data.name || input.filename,
    action: "created",
  };
}

async function updateDriveFileContent(
  token: string,
  input: { fileId: string; filename: string; mimeType: string; buffer: Buffer },
): Promise<DriveUploadResult> {
  const url = new URL(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(input.fileId)}`,
  );
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("keepRevisionForever", "true");
  url.searchParams.set("fields", "id,webViewLink,name");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": input.mimeType || "application/octet-stream",
      "Content-Length": String(input.buffer.length),
    },
    body: input.buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive revision upload failed (${res.status}): ${text.slice(0, 220)}`);
  }
  const data = (await res.json()) as { id?: string; webViewLink?: string; name?: string };
  if (!data.id) throw new Error("Google Drive update returned no file id");
  return {
    fileId: data.id,
    webViewLink: data.webViewLink ?? null,
    filename: data.name || input.filename,
    action: "updated",
  };
}

/**
 * Upload a file into a Drive folder using either:
 * - a user/tenant OAuth access token (preferred, multi-tenant), or
 * - a platform service-account token (optional fallback).
 *
 * Conflict handling (same display name in the target folder):
 * - overwrite → update existing file (new Drive revision, same file id / name)
 * - skip → leave existing file; return action "skipped"
 * - rename → create `name (1).ext`, `(2)`, … when the original name is taken
 */
export async function uploadToGoogleDriveFolder(input: {
  folderId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** When set, use this access token instead of the platform service account. */
  accessToken?: string;
  conflictPolicy?: DriveConflictPolicy;
}): Promise<DriveUploadResult> {
  const folderId = String(input.folderId || "").trim();
  if (!folderId) throw new Error("Google Drive folder ID is required");
  const filename = String(input.filename || "artifact").trim() || "artifact";
  const policy: DriveConflictPolicy = input.conflictPolicy ?? "overwrite";
  const token = await resolveDriveToken(input.accessToken);

  const existing = await findFilesByNameInFolder(token, folderId, filename);
  let taken: Set<string> | undefined;
  if (policy === "rename" && existing.length > 0) {
    taken = new Set(existing.map((f) => f.name));
    for (let n = 1; n < 50; n++) {
      const candidate = conflictFilename(filename, n);
      if (taken.has(candidate)) continue;
      const hits = await findFilesByNameInFolder(token, folderId, candidate);
      if (hits.length === 0) break;
      for (const h of hits) taken.add(h.name);
    }
  }

  const plan = planDriveConflict({
    policy,
    filename,
    existingSameName: existing,
    takenNames: taken,
  });

  if (plan.action === "skip") {
    return {
      fileId: plan.fileId,
      webViewLink: plan.webViewLink,
      filename: plan.filename,
      action: "skipped",
    };
  }
  if (plan.action === "update") {
    return updateDriveFileContent(token, {
      fileId: plan.fileId,
      filename: plan.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
    });
  }
  return createDriveFile(token, {
    folderId,
    filename: plan.filename,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });
}

export function driveFolderHint(): string | null {
  const email = (process.env.GOOGLE_DRIVE_CLIENT_EMAIL ?? "").trim();
  return email || null;
}

export function contentSha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function signWebhookBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}
