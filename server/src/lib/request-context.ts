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
  return store.getStore()?.role ?? "legacy";
}

export function getIsPlatformAdmin(): boolean {
  return Boolean(store.getStore()?.isPlatformAdmin);
}
