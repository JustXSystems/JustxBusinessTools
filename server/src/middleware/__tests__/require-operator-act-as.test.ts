import { describe, expect, it, vi, beforeEach } from "vitest";
import { requireOperatorActAs } from "../require-operator-act-as.js";
import { runWithContext, type RequestContext } from "../../lib/request-context.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function call(
  path: string,
  ctx: RequestContext | null,
): { statusCode: number; body: unknown; next: ReturnType<typeof vi.fn> } {
  const req = { path } as import("express").Request;
  const res = mockRes();
  const next = vi.fn();
  if (ctx) {
    runWithContext(ctx, () => {
      requireOperatorActAs(req, res as never, next);
    });
  } else {
    requireOperatorActAs(req, res as never, next);
  }
  return { statusCode: res.statusCode, body: res.body, next };
}

const platformBare: RequestContext = {
  userId: 1,
  organizationId: 1,
  businessProfileId: 1,
  role: "owner",
  sessionId: 1,
  isPlatformAdmin: true,
  actAsRole: null,
};

const platformActing: RequestContext = {
  ...platformBare,
  actAsRole: "staff",
  role: "staff",
};

const orgOwner: RequestContext = {
  userId: 2,
  organizationId: 1,
  businessProfileId: 1,
  role: "owner",
  sessionId: 2,
  isPlatformAdmin: false,
};

describe("requireOperatorActAs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows exempt paths for platform without act-as", () => {
    for (const path of [
      "/api/auth/me",
      "/api/admin/profiles",
      "/api/config/branding",
      "/api/public/status",
      "/api/webhooks/razorpay",
      "/api/files/x.png",
      "/api/health",
    ]) {
      const r = call(path, platformBare);
      expect(r.next).toHaveBeenCalled();
      expect(r.statusCode).toBe(200);
    }
  });

  it("blocks operator APIs for platform without act-as", () => {
    for (const path of ["/api/profile", "/api/bos/home", "/api/ims/items", "/api/subscription"]) {
      const r = call(path, platformBare);
      expect(r.next).not.toHaveBeenCalled();
      expect(r.statusCode).toBe(403);
      expect(r.body).toMatchObject({ code: "NEED_ACT_AS" });
    }
  });

  it("allows operator APIs when platform is acting as a role", () => {
    const r = call("/api/bos/home", platformActing);
    expect(r.next).toHaveBeenCalled();
  });

  it("never blocks live org users", () => {
    const r = call("/api/profile", orgOwner);
    expect(r.next).toHaveBeenCalled();
  });
});
