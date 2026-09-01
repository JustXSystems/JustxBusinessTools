import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getJwtSecret } from "./env.js";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** Default signed URL lifetime for logos returned to browsers (7 days). */
export const DEFAULT_FILE_URL_TTL_SEC = 7 * 24 * 3600;

export function uploadDriver(): "local" | "s3" {
  const raw = (process.env.UPLOAD_DRIVER ?? "local").trim().toLowerCase();
  return raw === "s3" || raw === "cloud" ? "s3" : "local";
}

export function localUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));
}

/** True when abs is exactly root or a file/dir under root (sep-safe). */
export function isPathInsideRoot(absPath: string, rootPath: string): boolean {
  const root = path.resolve(rootPath);
  const abs = path.resolve(absPath);
  return abs === root || abs.startsWith(root + path.sep);
}

function fileSigningSecret(): string {
  return process.env.FILE_URL_SECRET?.trim() || getJwtSecret();
}

function publicBase(): string {
  // Prefer explicit upload CDN/base; else API_PUBLIC_URL (includes /jbt in prod).
  const raw = (
    process.env.UPLOAD_PUBLIC_BASE_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
  return raw;
}

/** Stable storage URL without access token (persist this in DB). */
export function publicFileUrl(key: string): string {
  if (uploadDriver() === "s3") {
    const base = (process.env.S3_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (!base) throw new Error("S3_PUBLIC_URL is required when UPLOAD_DRIVER=s3");
    return `${base}/${key}`;
  }
  const base = publicBase();
  // Always store/serve under /api/files/...; prefix with /jbt via API_PUBLIC_URL when set.
  const rel = `/api/files/${key}`;
  return base ? `${base}${rel}` : rel;
}

export function extractLocalFileKey(urlOrPath: string): string | null {
  const raw = String(urlOrPath ?? "").trim();
  if (!raw) return null;
  try {
    const pathOnly = raw.includes("://")
      ? new URL(raw).pathname
      : raw.split("?")[0] ?? raw;
    const cleaned = pathOnly.replace(/^\/jbt(?=\/)/, "");
    const m = /^\/api\/files\/(.+)$/.exec(cleaned);
    if (!m) return null;
    const key = decodeURIComponent(m[1]);
    if (!key || key.includes("..")) return null;
    return key;
  } catch {
    return null;
  }
}

function signFileKey(key: string, expiresAtSec: number): string {
  return createHmac("sha256", fileSigningSecret())
    .update(`${key}.${expiresAtSec}`, "utf8")
    .digest("base64url");
}

export function verifyFileAccessToken(
  key: string,
  expRaw: string | undefined,
  sigRaw: string | undefined,
): boolean {
  if (!key || !expRaw || !sigRaw) return false;
  const expiresAtSec = Number(expRaw);
  if (!Number.isFinite(expiresAtSec) || expiresAtSec * 1000 < Date.now()) return false;
  const expected = signFileKey(key, expiresAtSec);
  const got = String(sigRaw);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(got);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Strip exp/sig so clients cannot poison stored URLs with foreign tokens. */
export function canonicalizeStoredImageUrl(value: string): string {
  const trimmed = value.trim();
  const key = extractLocalFileKey(trimmed);
  if (!key) {
    // Drop query string from absolute non-file URLs we still accept as "stored"
    const q = trimmed.indexOf("?");
    return q >= 0 && !trimmed.startsWith("data:") ? trimmed.slice(0, q) : trimmed;
  }
  return publicFileUrl(key);
}

/** Attach expiring HMAC for browser/public GETs of local uploads. */
export function withFileAccessToken(
  urlOrPath: string | null | undefined,
  ttlSec: number = DEFAULT_FILE_URL_TTL_SEC,
): string | null {
  if (urlOrPath == null) return null;
  const trimmed = String(urlOrPath).trim();
  if (!trimmed) return null;
  if (uploadDriver() === "s3") return trimmed;
  const key = extractLocalFileKey(trimmed);
  if (!key) return trimmed;
  const expiresAtSec = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec);
  const sig = signFileKey(key, expiresAtSec);
  const base = publicFileUrl(key);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}exp=${expiresAtSec}&sig=${sig}`;
}

function parseDataUrl(input: string): { mime: string; buffer: Buffer } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input.replace(/\s/g, ""));
  if (!match) {
    throw new Error("Logo must be a PNG, JPEG, WebP, or GIF image");
  }
  const mime = match[1].toLowerCase();
  if (!ALLOWED.has(mime)) {
    throw new Error("Unsupported image type. Use PNG, JPEG, WebP, or GIF");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new Error("Image file is empty");
  if (buffer.length > MAX_BYTES) throw new Error("Image must be 2 MB or smaller");
  return { mime, buffer };
}

export function isStoredImageUrl(value: string): boolean {
  const v = value.trim();
  return (
    Boolean(extractLocalFileKey(v)) ||
    v.startsWith("/api/files/") ||
    v.startsWith("/jbt/api/files/") ||
    v.includes("/api/files/") ||
    v.startsWith("http://") ||
    v.startsWith("https://")
  );
}

export async function saveImageUpload(
  input: string | null | undefined,
  folder: string,
): Promise<string | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isStoredImageUrl(trimmed)) return canonicalizeStoredImageUrl(trimmed);

  const { mime, buffer } = parseDataUrl(trimmed);
  const ext = ALLOWED.get(mime) ?? "png";
  const key = `${folder.replace(/[^a-z0-9/_-]/gi, "")}/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  if (uploadDriver() === "s3") {
    await putS3Object(key, buffer, mime);
  } else {
    const dest = path.join(localUploadDir(), key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buffer);
  }
  return publicFileUrl(key);
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function putS3Object(key: string, body: Buffer, contentType: string): Promise<void> {
  const accessKey = process.env.S3_ACCESS_KEY_ID ?? "";
  const secret = process.env.S3_SECRET_ACCESS_KEY ?? "";
  const region = process.env.S3_REGION ?? "ap-south-1";
  const bucket = process.env.S3_BUCKET ?? "";
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/$/, "");
  if (!accessKey || !secret || !bucket) {
    throw new Error("S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET are required for cloud uploads");
  }

  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");

  let host: string;
  let url: string;
  let canonicalUri: string;
  if (endpoint) {
    const u = new URL(endpoint);
    host = u.host;
    canonicalUri = `/${bucket}/${encodedKey}`;
    url = `${u.origin}/${bucket}/${encodedKey}`;
  } else {
    host = `${bucket}.s3.${region}.amazonaws.com`;
    canonicalUri = `/${encodedKey}`;
    url = `https://${host}/${encodedKey}`;
  }

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const dateKey = hmac(`AWS4${secret}`, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloud upload failed (${res.status}) ${text.slice(0, 180)}`);
  }
}
