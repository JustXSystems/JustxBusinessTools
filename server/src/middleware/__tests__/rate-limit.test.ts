import { describe, expect, it } from "vitest";
import { rateLimit } from "../../middleware/rate-limit.js";
import type { Request, Response } from "express";

function mockReq(ip = "1.2.3.4"): Request {
  return { ip, headers: {}, socket: { remoteAddress: ip } } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    setHeader() {
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("rateLimit", () => {
  it("allows under the limit and blocks after", () => {
    const mw = rateLimit({ name: `test-${Date.now()}`, windowMs: 60_000, max: 2 });
    let nextCount = 0;
    const next = () => {
      nextCount += 1;
    };
    mw(mockReq(), mockRes(), next);
    mw(mockReq(), mockRes(), next);
    expect(nextCount).toBe(2);
    const blocked = mockRes();
    mw(mockReq(), blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(nextCount).toBe(2);
  });
});
