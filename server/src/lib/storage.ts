import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export function uploadDriver(): "local" | "s3" {
  const raw = (process.env.UPLOAD_DRIVER ?? "local").trim().toLowerCase();
  return raw === "s3" || raw === "cloud" ? "s3" : "local";
}

export function localUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));
}

function publicBase(): string {
  return (process.env.UPLOAD_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}

export function publicFileUrl(key: string): string {
  if (uploadDriver() === "s3") {
    const base = (process.env.S3_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (!base) throw new Error("S3_PUBLIC_URL is required when UPLOAD_DRIVER=s3");
    return `${base}/${key}`;
  }
  const base = publicBase();
  const rel = `/api/files/${key}`;
  return base ? `${base}${rel}` : rel;
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
  return (
    value.startsWith("/api/files/") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

export async function saveImageUpload(
  input: string | null | undefined,
  folder: string,
): Promise<string | null> {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isStoredImageUrl(trimmed)) return trimmed;

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
