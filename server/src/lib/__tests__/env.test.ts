import { afterEach, describe, expect, it } from "vitest";
import { DEV_JWT_FALLBACK, validateServerEnv } from "../env.js";

const KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "REQUIRE_AUTH",
  "PAYMENT_AUTO_COMPLETE",
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "CORS_ORIGIN",
  "WEB_PUBLIC_ORIGIN",
  "WEB_BASE_PATH",
] as const;

const snapshot: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

function saveEnv() {
  for (const k of KEYS) snapshot[k] = process.env[k];
}

describe("validateServerEnv", () => {
  it("allows weak JWT in development with warning only", () => {
    saveEnv();
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = DEV_JWT_FALLBACK;
    expect(() => validateServerEnv()).not.toThrow();
  });

  it("rejects production without REQUIRE_AUTH and strong JWT", () => {
    saveEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = DEV_JWT_FALLBACK;
    process.env.REQUIRE_AUTH = "false";
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_USER = "u";
    process.env.DB_PASSWORD = "p";
    process.env.DB_NAME = "d";
    process.env.CORS_ORIGIN = "https://justxsystems.com";
    expect(() => validateServerEnv()).toThrow(/Invalid server environment/);
  });

  it("rejects CORS_ORIGIN that includes /jbt in production", () => {
    saveEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(48);
    process.env.REQUIRE_AUTH = "true";
    process.env.PAYMENT_AUTO_COMPLETE = "false";
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_USER = "u";
    process.env.DB_PASSWORD = "p";
    process.env.DB_NAME = "d";
    process.env.CORS_ORIGIN = "https://justxsystems.com/jbt";
    expect(() => validateServerEnv()).toThrow(/origin only/);
  });

  it("passes a sane production config", () => {
    saveEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(48);
    process.env.REQUIRE_AUTH = "true";
    process.env.PAYMENT_AUTO_COMPLETE = "false";
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_USER = "u";
    process.env.DB_PASSWORD = "p";
    process.env.DB_NAME = "d";
    process.env.CORS_ORIGIN = "https://justxsystems.com";
    process.env.WEB_BASE_PATH = "/jbt";
    expect(() => validateServerEnv()).not.toThrow();
  });
});
