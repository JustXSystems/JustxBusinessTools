import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, getApiBase } from "@/lib/api-base";

describe("apiUrl", () => {
  const prev = {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
    WEB_BASE_PATH: process.env.WEB_BASE_PATH,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("uses relative path when base unset", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.WEB_BASE_PATH;
    expect(getApiBase()).toBe("");
    expect(apiUrl("/api/profile")).toBe("/api/profile");
  });

  it("prefixes NEXT_PUBLIC_BASE_PATH for same-origin API calls", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_BASE_PATH = "/jbt";
    expect(apiUrl("/api/auth/login")).toBe("/jbt/api/auth/login");
    expect(apiUrl("/api/health")).toBe("/jbt/api/health");
  });

  it("uses absolute NEXT_PUBLIC_API_URL when set", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://justxsystems.com/jbt";
    process.env.NEXT_PUBLIC_BASE_PATH = "/jbt";
    expect(apiUrl("/api/auth/login")).toBe("https://justxsystems.com/jbt/api/auth/login");
  });
});
