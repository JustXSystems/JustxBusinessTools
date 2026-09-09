import type { NextFunction, Request, Response } from "express";
import {
  ensureArtifactDeliverySchema,
  hashAgentToken,
} from "../lib/artifact-delivery.js";
import { pool } from "../db.js";
import { legacyContext, resolveSession, getTokenFromCookie } from "../lib/auth/session.js";
import { isUnauthenticatedApiPath } from "../lib/public-paths.js";
import { runWithContext, type RequestContext } from "../lib/request-context.js";

const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";

async function resolveArtifactAgent(
  authorization: string | undefined,
): Promise<RequestContext | null> {
  const m = /^Bearer\s+(jxsa_.+)$/i.exec(String(authorization ?? "").trim());
  if (!m) return null;
  await ensureArtifactDeliverySchema();
  const tokenHash = hashAgentToken(m[1]);
  const [rows] = await pool.query(
    `SELECT organization_id, business_profile_id, user_id
     FROM artifact_sync_agents
     WHERE token_hash = :hash AND revoked_at IS NULL LIMIT 1`,
    { hash: tokenHash },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as
        | {
            organization_id: number;
            business_profile_id: number;
            user_id: number;
          }
        | undefined)
    : undefined;
  if (!row) return null;
  // Prefer the minting user's org role so owner-created agents are not treated as
  // limited staff (branch_access ACL). Token is already scoped to one profile.
  let role: RequestContext["role"] = "staff";
  try {
    const [userRows] = await pool.query(
      `SELECT role FROM users WHERE id = :id AND organization_id = :orgId LIMIT 1`,
      { id: row.user_id, orgId: row.organization_id },
    );
    const u = Array.isArray(userRows)
      ? (userRows[0] as { role?: string } | undefined)
      : undefined;
    const r = String(u?.role ?? "").toLowerCase();
    if (r === "owner" || r === "admin" || r === "staff" || r === "viewer") {
      role = r;
    }
  } catch {
    // keep staff fallback
  }
  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    businessProfileId: row.business_profile_id,
    role,
    sessionId: null,
    isPlatformAdmin: false,
    viaAgentToken: true,
  };
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const run = async () => {
    const token = getTokenFromCookie(req.headers.cookie);
    if (token) {
      const ctx = await resolveSession(token);
      if (ctx) {
        runWithContext(ctx, () => next());
        return;
      }
    }
    const agentCtx = await resolveArtifactAgent(req.headers.authorization);
    if (agentCtx) {
      runWithContext(agentCtx, () => next());
      return;
    }
    if (REQUIRE_AUTH && !isUnauthenticatedApiPath(req.path)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    runWithContext(legacyContext(), () => next());
  };
  run().catch(next);
}
