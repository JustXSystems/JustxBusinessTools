import { createHash, createPrivateKey, createSign, createHmac, randomBytes } from "node:crypto";

type DriveConfig = {
  clientEmail: string;
  privateKey: string;
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

/**
 * Upload a file into a Drive folder using either:
 * - a user/tenant OAuth access token (preferred, multi-tenant), or
 * - a platform service-account token (optional fallback).
 */
export async function uploadToGoogleDriveFolder(input: {
  folderId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** When set, use this access token instead of the platform service account. */
  accessToken?: string;
}): Promise<{ fileId: string; webViewLink: string | null }> {
  const folderId = String(input.folderId || "").trim();
  if (!folderId) throw new Error("Google Drive folder ID is required");
  const token = input.accessToken?.trim() || (await getAccessToken());
  const boundary = `jbt_${randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({
    name: input.filename,
    parents: [folderId],
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
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name",
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
  const data = (await res.json()) as { id?: string; webViewLink?: string };
  if (!data.id) throw new Error("Google Drive upload returned no file id");
  return { fileId: data.id, webViewLink: data.webViewLink ?? null };
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
