/**
 * Mappls web click reverse-geocode (`get_click_revg`).
 * Returns Mappls Pin (eLoc) + Digipin for a lat/lng — the identifiers OEM
 * search boxes (SimpleOne, etc.) actually understand.
 *
 * Payload is CryptoJS OpenSSL AES-256-CBC; passphrase observed from Mappls web.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { roundCoord } from "@jbt/shared";

/** Base64("mmi237@12") — Mappls web AES passphrase for get_click_revg. */
const REVG_PASSPHRASE = "bW1pMjM3QDEy";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type MapplsClickRevg = {
  mapplsPin: string;
  digipin?: string;
  name?: string;
  formattedAddress?: string;
  lat: number;
  lng: number;
};

type RevgJson = {
  elc?: string;
  digipin?: string;
  name?: string;
  adrs?: string;
  add_place?: string;
  lat?: string | number;
  lng?: string | number;
};

function evpBytesToKey(password: string, salt: Buffer, keyLen: number, ivLen: number): {
  key: Buffer;
  iv: Buffer;
} {
  const parts: Buffer[] = [];
  let block = Buffer.alloc(0);
  while (Buffer.concat(parts).length < keyLen + ivLen) {
    block = createHash("md5")
      .update(Buffer.concat([block, Buffer.from(password, "utf8"), salt]))
      .digest();
    parts.push(block);
  }
  const keyIv = Buffer.concat(parts);
  return { key: keyIv.subarray(0, keyLen), iv: keyIv.subarray(keyLen, keyLen + ivLen) };
}

export function decryptMapplsRevg(cipherB64: string, passphrase = REVG_PASSPHRASE): string {
  const buf = Buffer.from(String(cipherB64).trim(), "base64");
  if (buf.subarray(0, 8).toString("utf8") !== "Salted__") {
    throw new Error("Mappls revg: unexpected ciphertext");
  }
  const salt = buf.subarray(8, 16);
  const data = buf.subarray(16);
  const { key, iv } = evpBytesToKey(passphrase, salt, 32, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function normalizePin(raw: unknown): string | undefined {
  const pin = String(raw ?? "")
    .trim()
    .toLowerCase();
  return /^[a-z0-9]{6}$/.test(pin) ? pin : undefined;
}

function normalizeDigipin(raw: unknown): string | undefined {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  // Mappls returns "4P3 KCM 7J87"; also accept continuous 10-char form
  const compact = s.replace(/[\s-]/g, "");
  if (!/^[23456789CJKLMPFT]{10}$/.test(compact)) return undefined;
  return `${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(6)}`;
}

async function openMapplsSession(
  lat: number,
  lng: number,
): Promise<{ cookie: string; referer: string }> {
  const startUrl = `https://www.mappls.com/@${lat},${lng}`;
  const start = await fetch(startUrl, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(12_000),
  });
  const html = await start.text();
  let cookies = (start.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  let referer = startUrl;
  const onclick = html.match(/window\.location='(@[^']+)'/)?.[1];
  if (onclick) {
    referer = new URL(onclick, "https://www.mappls.com/").toString();
    const second = await fetch(referer, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Cookie: cookies.filter(Boolean).join("; "),
      },
      signal: AbortSignal.timeout(12_000),
    });
    cookies = [
      ...cookies,
      ...(second.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]),
    ];
  }
  return {
    cookie: [...new Set(cookies.filter(Boolean))].join("; "),
    referer,
  };
}

async function fetchRevgOnce(
  la: number,
  ln: number,
): Promise<MapplsClickRevg | null> {
  const { cookie, referer } = await openMapplsSession(la, ln);
  const url = `https://www.mappls.com/get_click_revg?${la}&${ln}&18`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Cookie: cookie,
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const cipher = (await res.text()).trim();
  // Mappls sometimes returns "FL" / short errors when session/rate-limited
  if (!cipher.startsWith("U2FsdGVkX1")) return null;

  const plain = decryptMapplsRevg(cipher);
  // Response is often a JSON *string* (quoted), sometimes a bare object.
  let data: RevgJson;
  const parsed: unknown = JSON.parse(plain);
  if (typeof parsed === "string") {
    data = JSON.parse(parsed) as RevgJson;
  } else {
    data = parsed as RevgJson;
  }

  const mapplsPin = normalizePin(data.elc);
  if (!mapplsPin) return null;

  return {
    mapplsPin,
    digipin: normalizeDigipin(data.digipin),
    name: data.name?.trim() || undefined,
    formattedAddress: data.adrs?.trim() || data.add_place?.trim() || undefined,
    lat: la,
    lng: ln,
  };
}

/**
 * Resolve Mappls Pin + Digipin + POI name for a WGS-84 point via Mappls web
 * click reverse-geocode. Soft-fails (returns null) on network / decrypt errors.
 * Retries once — Mappls occasionally returns "FL" without a cipher.
 */
export async function fetchMapplsClickRevg(
  lat: number,
  lng: number,
): Promise<MapplsClickRevg | null> {
  const la = roundCoord(lat);
  const ln = roundCoord(lng);
  try {
    const first = await fetchRevgOnce(la, ln);
    if (first) return first;
    await new Promise((r) => setTimeout(r, 400));
    return await fetchRevgOnce(la, ln);
  } catch {
    return null;
  }
}
