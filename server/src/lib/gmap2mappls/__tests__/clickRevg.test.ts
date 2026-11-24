import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptMapplsRevg, fetchMapplsClickRevg } from "../clickRevg.js";

const PASSPHRASE = "bW1pMjM3QDEy";

function encryptLikeCryptoJs(plain: string, passphrase: string): string {
  const salt = randomBytes(8);
  // EVP_BytesToKey MD5 → 32-byte key + 16-byte IV
  const parts: Buffer[] = [];
  let block = Buffer.alloc(0);
  while (Buffer.concat(parts).length < 48) {
    block = createHash("md5")
      .update(Buffer.concat([block, Buffer.from(passphrase, "utf8"), salt]))
      .digest();
    parts.push(block);
  }
  const keyIv = Buffer.concat(parts);
  const cipher = createCipheriv("aes-256-cbc", keyIv.subarray(0, 32), keyIv.subarray(32, 48));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "utf8"), salt, enc]).toString("base64");
}

describe("decryptMapplsRevg", () => {
  it("decrypts CryptoJS OpenSSL AES-256-CBC payloads", () => {
    const payload = JSON.stringify({
      elc: "kcf7zj",
      digipin: "4P3 KCM 7J87",
      name: "Zigma Technologies",
    });
    const cipher = encryptLikeCryptoJs(payload, PASSPHRASE);
    expect(decryptMapplsRevg(cipher)).toBe(payload);
  });
});

describe("fetchMapplsClickRevg live", () => {
  it("resolves Zigma pin kcf7zj from lat/lng", async () => {
    const hit = await fetchMapplsClickRevg(12.877073, 77.613574);
    expect(hit).not.toBeNull();
    expect(hit?.mapplsPin).toBe("kcf7zj");
    expect(hit?.digipin?.replace(/\s+/g, "")).toMatch(/^[23456789CJKLMPFT]{10}$/);
    expect(hit?.name?.toLowerCase()).toContain("zigma");
  }, 30_000);
});
