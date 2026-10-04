import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BosDb } from "./db.js";
import type { BosActor, BosHost } from "./host.js";
import { createBosRouter } from "./index.js";

const ACTOR: BosActor = { tenantId: 7, userId: 3, role: "staff", name: "Asha", email: "asha@example.com" };

/** Every query fails as if the BOS tables were missing, so a request that passes the gates answers 503. */
function missingTablesDb() {
  const missing = () => Promise.reject(Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" }));
  return { query: vi.fn(missing), getConnection: vi.fn(missing) };
}

function host(overrides: Partial<BosHost> = {}): BosHost {
  return {
    id: "test",
    appHref: "/tools/bos",
    actor: async () => ACTOR,
    requireWrite: (_req, _res, next) => next(),
    audit: async () => undefined,
    notify: () => undefined,
    brand: async () => ({ name: "", gstin: null, state: null, stateCode: null, address: null, email: null, phone: null, logoUrl: null, accent: null }),
    ...overrides,
  };
}

let server: Server | null = null;

async function call(h: BosHost) {
  const db = missingTablesDb();
  const app = express();
  app.use("/api/bos", createBosRouter({ db: db as unknown as BosDb, host: h }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/api/bos/session`);
  return { status: res.status, body: (await res.json()) as { error?: string; code?: string }, db };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("createBosRouter gates", () => {
  it("asks anonymous callers to sign in", async () => {
    const { status, db } = await call(host({ actor: async () => null }));
    expect(status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("refuses an org where BOS isn't enabled, before touching any data", async () => {
    const enabled = vi.fn(async () => false);
    const { status, body, db } = await call(host({ enabled }));
    expect(status).toBe(403);
    expect(body.code).toBe("BOS_NOT_ENABLED");
    expect(enabled).toHaveBeenCalledWith(ACTOR);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("lets enabled orgs through to the API", async () => {
    const { status, body } = await call(host({ enabled: async () => true }));
    expect(status).toBe(503);
    expect(body.code).toBe("BOS_SCHEMA_PENDING");
  });

  it("treats a host without an enabled check as always on", async () => {
    const { status } = await call(host());
    expect(status).toBe(503);
  });
});
