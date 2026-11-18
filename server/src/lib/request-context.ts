import { AsyncLocalStorage } from "node:async_hooks";
import { PROFILE_ID } from "./constants.js";

export type OrgRole = "owner" | "admin" | "staff" | "viewer";

export type RequestContext = {
  userId: number | null;
  organizationId: number;
  businessProfileId: number;
  role: OrgRole | "legacy";
  sessionId: number | null;
  isPlatformAdmin: boolean;
  /**
   * Platform super only: optional operator “act as” role for troubleshooting.
   * When set, operator capability checks use this role; Admin Console still uses isPlatformAdmin.
   */
  actAsRole?: OrgRole | null;
  /** Desktop sync agent Bearer token — already scoped to businessProfileId. */
  viaAgentToken?: boolean;
};

const store = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return store.getStore();
}

export function getActiveProfileId(): number {
  return store.getStore()?.businessProfileId ?? PROFILE_ID;
}

export function getActiveOrgId(): number {
  return store.getStore()?.organizationId ?? 1;
}

export function getActiveUserId(): number | null {
  return store.getStore()?.userId ?? null;
}

export function getActiveSessionId(): number | null {
  return store.getStore()?.sessionId ?? null;
}

export function getActiveRole(): RequestContext["role"] {
  const ctx = store.getStore();
  if (!ctx) return "legacy";
  if (ctx.isPlatformAdmin && ctx.actAsRole) return ctx.actAsRole;
  return ctx.role ?? "legacy";
}

export function getActAsRole(): OrgRole | null {
  return store.getStore()?.actAsRole ?? null;
}

export function getIsPlatformAdmin(): boolean {
  return Boolean(store.getStore()?.isPlatformAdmin);
}

/** True when a platform super is simulating an org role in the operator app. */
export function isActingAsOrgRole(): boolean {
  const ctx = store.getStore();
  return Boolean(ctx?.isPlatformAdmin && ctx.actAsRole);
}
