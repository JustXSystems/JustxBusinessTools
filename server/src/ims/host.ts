import type { Request, RequestHandler } from "express";

/**
 * The IMS host contract. IMS never imports platform internals directly: identity,
 * write permission, audit, notifications and branding come from a host adapter.
 * JBT provides one (`hosts/jbt.ts`); a standalone IMS server provides its own.
 */

/** The platform role (JBT member role). IMS roles are resolved separately (see access.ts). */
export type ImsHostRole = "owner" | "admin" | "staff" | "viewer" | "legacy";

export type ImsActor = {
  /** Data partition. In JBT this is the active business profile. */
  tenantId: number;
  userId: number | null;
  role: ImsHostRole;
  name: string | null;
  email: string | null;
};

export type ImsNoticeKind = "approval_requested" | "approval_decided" | "activity" | "alert";

export type ImsNotice = {
  kind: ImsNoticeKind;
  title: string;
  body: string;
  /** In-app deep link, e.g. `/tools/imsdealer?m=purchase&open=<id>`. */
  href: string;
  entityType: string;
  entityId: string;
  dedupeKey?: string;
  targetUserId?: number | null;
};

export type ImsBrand = {
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

/** A team member as the host knows them (for assignment pickers and the team screen). */
export type ImsHostUser = { userId: number; name: string | null; email: string | null; role: ImsHostRole };

export interface ImsHost {
  readonly id: string;
  /** Resolve the caller; `null` → 401. */
  actor(req: Request): Promise<ImsActor | null>;
  /** Whether IMS is turned on for the caller; `false` → 403 `IMS_NOT_ENABLED`. Omit to always allow. */
  enabled?(actor: ImsActor): Promise<boolean>;
  /** Gate for mutating requests (platform write permission). */
  requireWrite: RequestHandler;
  audit(actor: ImsActor, action: string, entityType: string, entityId: string, diff?: Record<string, unknown>, ip?: string): Promise<void>;
  notify(actor: ImsActor, notice: ImsNotice): void;
  brand(tenantId: number): Promise<ImsBrand>;
  /** People who can be given an IMS role (JBT: members of the organization). */
  users(actor: ImsActor): Promise<ImsHostUser[]>;
  /** Base path of the IMS screen for deep links (`/tools/imsdealer` inside JBT). */
  readonly appHref: string;
}

export class ImsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
    readonly code?: string,
  ) {
    super(message);
    this.name = "ImsError";
  }
}

export const notFound = (what: string) => new ImsError(404, `${what} not found`);
export const forbidden = (msg = "You don't have permission to do this in IMS") => new ImsError(403, msg, undefined, "IMS_FORBIDDEN");
export const conflict = (msg: string) => new ImsError(409, msg);
export const badRequest = (msg: string, details?: string[]) => new ImsError(400, msg, details);
