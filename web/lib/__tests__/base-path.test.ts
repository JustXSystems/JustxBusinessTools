import { afterEach, describe, expect, it } from "vitest";
import { getBasePath, publicAssetUrl, resolvePublicOrigin, withBasePath } from "@/lib/base-path";

describe("base-path", () => {
  const prev = {
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
    WEB_BASE_PATH: process.env.WEB_BASE_PATH,
    WEB_PUBLIC_ORIGIN: process.env.WEB_PUBLIC_ORIGIN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prefixes paths when base is set", () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/jbt";
    expect(getBasePath()).toBe("/jbt");
    expect(withBasePath("/manifest.webmanifest")).toBe("/jbt/manifest.webmanifest");
    expect(withBasePath("/pwa-icon/192")).toBe("/jbt/pwa-icon/192");
    expect(withBasePath("/jbt/pwa-icon/192")).toBe("/jbt/pwa-icon/192");
  });

  it("leaves paths alone without base", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.WEB_BASE_PATH;
    expect(getBasePath()).toBe("");
    expect(withBasePath("/manifest.webmanifest")).toBe("/manifest.webmanifest");
  });

  it("prefers WEB_PUBLIC_ORIGIN over loopback request url", () => {
    process.env.WEB_PUBLIC_ORIGIN = "https://justxsystems.com";
    const req = new Request("http://localhost:3002/jbt/manifest.webmanifest");
    expect(resolvePublicOrigin(req)).toBe("https://justxsystems.com");
  });

  it("uses x-forwarded headers when env unset", () => {
    delete process.env.WEB_PUBLIC_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.CORS_ORIGIN;
    const req = new Request("http://localhost:3002/jbt/manifest.webmanifest", {
      headers: {
        "x-forwarded-host": "justxsystems.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(resolvePublicOrigin(req)).toBe("https://justxsystems.com");
  });

  it("rewrites /api/files asset URLs under basePath", () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/jbt";
    expect(publicAssetUrl("/api/files/platform/x.png")).toBe("/jbt/api/files/platform/x.png");
    expect(publicAssetUrl("https://justxsystems.com/api/files/platform/x.png?bn=A")).toBe(
      "/jbt/api/files/platform/x.png?bn=A",
    );
    expect(publicAssetUrl("/icons/presets/justx-mark.png")).toBe("/jbt/icons/presets/justx-mark.png");
    expect(publicAssetUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
  });
});
