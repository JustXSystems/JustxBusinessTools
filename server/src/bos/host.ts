import type { Request, RequestHandler } from "express";

/**
 * The BOS host contract. BOS never imports platform internals directly: identity,
 * permissions, audit, notifications and branding come from a host adapter. JBT
 * provides one (`hosts/jbt.ts`); a standalone deployment provides its own.
 */

export type BosRole = "owner" | "admin" | "staff" | "viewer" | "legacy";

export type BosActor = {
  /** Data partition. In JBT this is the active business profile (branch). */
  tenantId: number;
  userId: number | null;
  role: BosRole;
  name: string | null;
  email: string | null;
};

export type BosNoticeKind = "approval_requested" | "approval_decided" | "activity" | "workflow";

export type BosNotice = {
  kind: BosNoticeKind;
  title: string;
  body: string;
  /** In-app deep link, e.g. `/tools/bos?ws=hr&m=leave`. */
  href: string;
  entityType: string;
  entityId: string;
  dedupeKey?: string;
  /** Personal recipient in addition to role audiences (e.g. the employee whose leave was decided). */
  targetUserId?: number | null;
};

export type BosBrand = {
  name: string;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  accent: string | null;
};

export interface BosHost {
  readonly id: string;
  /** Resolve the caller; `null` → 401. */
  actor(req: Request): Promise<BosActor | null>;
  /** Whether BOS is turned on for the caller; `false` → 403 `BOS_NOT_ENABLED`. Omit to always allow. */
  enabled?(actor: BosActor): Promise<boolean>;
  /** Gate for mutating requests (role write permission). */
  requireWrite: RequestHandler;
  audit(actor: BosActor, action: string, entityType: string, entityId: string, diff?: Record<string, unknown>, ip?: string): Promise<void>;
  notify(actor: BosActor, notice: BosNotice): void;
  brand(tenantId: number): Promise<BosBrand>;
  /** Base path of the BOS screen for deep links (`/tools/bos` inside JBT). */
  readonly appHref: string;
}

/** Owners, admins and single-user (legacy) installs run HR & finance approvals. */
export function isManager(actor: BosActor): boolean {
  return actor.role === "owner" || actor.role === "admin" || actor.role === "legacy";
}

export class BosError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "BosError";
  }
}

export const notFound = (what: string) => new BosError(404, `${what} not found`);
export const forbidden = (msg = "Only owners and admins can do this") => new BosError(403, msg);
