import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeStoredImageUrl,
  extractLocalFileKey,
  isPathInsideRoot,
  publicFileUrl,
  verifyFileAccessToken,
  withFileAccessToken,
} from "../storage.js";

const KEYS = ["JWT_SECRET", "FILE_URL_SECRET", "API_PUBLIC_URL", "UPLOAD_DRIVER"] as const;
const snapshot: Record<string, string | undefined> = {};

function saveEnv() {
  for (const k of KEYS) snapshot[k] = process.env[k];
}

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("file access tokens", () => {
  it("signs and verifies local file URLs", () => {
    saveEnv();
    process.env.JWT_SECRET = "a".repeat(48);
    process.env.API_PUBLIC_URL = "https://justxsystems.com/jbt";
    delete process.env.UPLOAD_DRIVER;

    const url = withFileAccessToken("/api/files/logos/demo.png", 3600);
    expect(url).toMatch(/\/api\/files\/logos\/demo\.png\?exp=\d+&sig=/);
    const u = new URL(url!, "https://justxsystems.com");
    expect(
      verifyFileAccessToken("logos/demo.png", u.searchParams.get("exp")!, u.searchParams.get("sig")!),
    ).toBe(true);
    expect(verifyFileAccessToken("logos/demo.png", u.searchParams.get("exp")!, "bad")).toBe(false);
  });

  it("canonicalizes signed URLs back to stable storage form", () => {
    saveEnv();
    process.env.JWT_SECRET = "a".repeat(48);
    process.env.API_PUBLIC_URL = "https://justxsystems.com/jbt";
    const signed = withFileAccessToken(publicFileUrl("platform/x.png"), 60)!;
    expect(canonicalizeStoredImageUrl(signed)).toBe(
      "https://justxsystems.com/jbt/api/files/platform/x.png",
    );
  });

  it("extracts keys under /jbt and rejects traversal", () => {
    expect(extractLocalFileKey("/jbt/api/files/logos/a.png")).toBe("logos/a.png");
    expect(extractLocalFileKey("/api/files/../etc/passwd")).toBeNull();
  });

  it("hardens upload root containment", () => {
    expect(isPathInsideRoot("/var/www/jbt/server/uploads/a.png", "/var/www/jbt/server/uploads")).toBe(
      true,
    );
    expect(
      isPathInsideRoot("/var/www/jbt/server/uploads-evil/a.png", "/var/www/jbt/server/uploads"),
    ).toBe(false);
  });
});
