import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  return toBase32(buf);
}

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function fromBase32(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: string, counter: number, digits = 6): string {
  const key = fromBase32(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const cleaned = String(token ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const expected = totpAt(secret, counter + w);
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(cleaned);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

export function totpOtpauthUrl(input: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(input.issuer ?? "JustXSystems");
  const account = encodeURIComponent(input.accountName);
  return `otpauth://totp/${issuer}:${account}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

/** Short-lived signed MFA challenge between password and session. */
export function signMfaChallenge(userId: number, ttlSec = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${userId}.${exp}`;
  const sig = createHmac("sha256", mfaChallengeSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMfaChallenge(token: string): number | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [userIdRaw, expRaw, sig] = parts;
  const userId = Number(userIdRaw);
  const exp = Number(expRaw);
  if (!Number.isInteger(userId) || userId < 1 || !Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return null;
  }
  const body = `${userId}.${exp}`;
  const expected = createHmac("sha256", mfaChallengeSecret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(sig));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return userId;
}

function mfaChallengeSecret(): string {
  return (
    process.env.MFA_CHALLENGE_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "jbt-dev-mfa-challenge"
  );
}
