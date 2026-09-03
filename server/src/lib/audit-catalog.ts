/** Shared taxonomy for admin audit console (security, support, governance). */

export type AuditCategory =
  | "auth"
  | "team"
  | "billing"
  | "catalog"
  | "profile"
  | "documents"
  | "artifacts"
  | "system";

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export type AuditCategoryMeta = {
  id: AuditCategory;
  label: string;
  short: string;
  description: string;
};

export const AUDIT_CATEGORIES: AuditCategoryMeta[] = [
  { id: "auth", label: "Sign-in & MFA", short: "Auth", description: "Logins, Google/OTP, MFA changes" },
  { id: "team", label: "Team & access", short: "Team", description: "Invites, roles, approvals, sessions" },
  { id: "billing", label: "Billing & payments", short: "Billing", description: "Plans, licenses, UPI, gateways" },
  { id: "catalog", label: "Tools & catalog", short: "Catalog", description: "Tools, SKUs, product packs" },
  { id: "profile", label: "Profiles & Drive", short: "Profiles", description: "Branches, Drive connect, branding data" },
  { id: "documents", label: "Documents & records", short: "Docs", description: "Quotes, surveys, tool records" },
  { id: "artifacts", label: "File delivery", short: "Files", description: "PDF staging and sync agents" },
  { id: "system", label: "Platform config", short: "System", description: "Role matrix and platform settings" },
];

const CATEGORY_BY_PREFIX: Array<{ prefix: string; category: AuditCategory }> = [
  { prefix: "auth.", category: "auth" },
  { prefix: "team.", category: "team" },
  { prefix: "upi.", category: "billing" },
  { prefix: "payment", category: "billing" },
  { prefix: "gateway.", category: "billing" },
  { prefix: "plan.", category: "billing" },
  { prefix: "subscription.", category: "billing" },
  { prefix: "sku.", category: "billing" },
  { prefix: "bundle.", category: "billing" },
  { prefix: "tool.create", category: "catalog" },
  { prefix: "tool.update", category: "catalog" },
  { prefix: "tool.disable", category: "catalog" },
  { prefix: "tool.record", category: "documents" },
  { prefix: "profile.", category: "profile" },
  { prefix: "document.", category: "documents" },
  { prefix: "quotation", category: "documents" },
  { prefix: "sitesurvey", category: "documents" },
  { prefix: "artifact.", category: "artifacts" },
];

const SEVERITY_BY_ACTION: Record<string, AuditSeverity> = {
  "auth.mfa_disable": "critical",
  "team.suspend": "critical",
  "org.suspend_access": "critical",
  "team.reset_password": "critical",
  "team.revoke_sessions": "critical",
  "team.remove": "critical",
  "sku.revoke": "critical",
  "gateway.create": "critical",
  "gateway.update": "critical",
  "gateway.delete": "critical",
  "auth.mfa_enable": "high",
  "team.approve": "high",
  "team.reject": "high",
  "team.invite": "high",
  "team.update": "high",
  "team.role_matrix": "high",
  "team.tools": "high",
  "team.grant_branch": "high",
  "team.branches": "high",
  "team.revoke_branch": "high",
  "team.copy_access": "high",
  "team.verify": "high",
  "plan.update": "high",
  "plan.availability": "high",
  "sku.upsert": "high",
  "sku.extend": "high",
  "bundle.create": "high",
  "bundle.upsert": "high",
  "bundle.delete": "high",
  "payment_op.create": "high",
  "upi.claim.approve": "high",
  "upi.claim.reject": "high",
  "profile.drive_disconnect": "high",
  "profile.archive": "high",
  "profile.approve": "high",
  "profile.grant_access": "high",
  "tool.disable": "high",
  "artifact.agent_revoke": "high",
  "auth.login": "low",
  "auth.google": "low",
  "auth.otp": "low",
  "auth.mfa": "low",
  "artifact.stage": "low",
  "tool.record.create": "low",
  "tool.record.update": "low",
  "document.create": "low",
  "quotationv1.create": "low",
  "sitesurveyv1.create": "low",
};

const LABEL_BY_ACTION: Record<string, string> = {
  "auth.login": "Signed in with email",
  "auth.google": "Signed in with Google",
  "auth.otp": "Signed in with phone OTP",
  "auth.mfa": "Completed MFA challenge",
  "auth.mfa_enable": "Enabled MFA",
  "auth.mfa_disable": "Disabled MFA",
  "team.invite": "Invited team member",
  "team.update": "Updated team member",
  "team.approve": "Approved team member",
  "team.reject": "Rejected team member",
  "team.suspend": "Suspended team member",
  "org.suspend_access": "Suspended organization access",
  "team.reset_password": "Reset team member password",
  "team.verify": "Updated verification flags",
  "team.revoke_sessions": "Revoked all sessions",
  "team.copy_access": "Copied access from another user",
  "team.remove": "Removed team member",
  "team.tools": "Changed tool access",
  "team.grant_branch": "Granted branch access",
  "team.branches": "Updated branch access mode",
  "team.revoke_branch": "Revoked branch access",
  "team.role_matrix": "Updated role permission matrix",
  "sku.upsert": "Updated tool SKU pricing",
  "sku.extend": "Extended tool licenses",
  "sku.revoke": "Revoked tool licenses",
  "bundle.create": "Created product pack",
  "bundle.upsert": "Updated product pack",
  "bundle.delete": "Deleted product pack",
  "plan.update": "Updated subscription plan",
  "plan.availability": "Changed plan availability",
  "subscription.notice.send": "Sent renewal notice",
  "payment_op.create": "Created payment desk op",
  "upi.claim.approve": "Approved UPI claim",
  "upi.claim.reject": "Rejected UPI claim",
  "gateway.create": "Added payment gateway",
  "gateway.update": "Updated payment gateway",
  "tool.create": "Created tool",
  "tool.update": "Updated tool",
  "tool.disable": "Disabled tool",
  "tool.record.create": "Created tool record",
  "tool.record.update": "Updated tool record",
  "tool.record.delete": "Deleted tool record",
  "profile.create": "Created business profile",
  "profile.update": "Updated business profile",
  "profile.update.homeTools": "Updated home tools",
  "profile.default": "Set default profile",
  "profile.approve": "Approved business profile",
  "profile.archive": "Archived business profile",
  "profile.unarchive": "Restored business profile",
  "profile.duplicate": "Duplicated business profile",
  "profile.grant_access": "Granted profile access",
  "profile.drive_connect": "Connected Google Drive",
  "profile.drive_disconnect": "Disconnected Google Drive",
  "document.create": "Created document",
  "document.update": "Updated document",
  "document.delete": "Deleted document",
  "quotationv1.create": "Created quotation",
  "quotationv1.update": "Updated quotation",
  "quotationv1.delete": "Deleted quotation",
  "sitesurveyv1.create": "Created site survey",
  "sitesurveyv1.update": "Updated site survey",
  "sitesurveyv1.delete": "Deleted site survey",
  "artifact.stage": "Staged delivery artifact",
  "artifact.agent_register": "Registered sync agent",
  "artifact.agent_revoke": "Revoked sync agent",
};

const ENTITY_HREF: Record<string, (id: string) => string | null> = {
  user: () => "/admin/team",
  business_profile: () => "/admin/profiles",
  tool: (id) => `/admin/tools?tool=${encodeURIComponent(id)}`,
  tool_sku: () => "/admin/skus",
  product_bundle: () => "/admin/skus",
  org_tool_license: () => "/admin/subscriptions",
  subscription_plan: () => "/admin/subscriptions",
  subscription_notice: () => "/admin/subscriptions",
  payment_op: () => "/admin/payments",
  payment_gateway: () => "/admin/gateways",
  upi_claim: () => "/admin/upi",
  platform_config: () => "/admin/team",
};

export function categorizeAuditAction(action: string): AuditCategory {
  const a = action.toLowerCase();
  for (const { prefix, category } of CATEGORY_BY_PREFIX) {
    if (a.startsWith(prefix.toLowerCase())) return category;
  }
  return "system";
}

export function severityForAuditAction(action: string): AuditSeverity {
  if (SEVERITY_BY_ACTION[action]) return SEVERITY_BY_ACTION[action];
  const cat = categorizeAuditAction(action);
  if (cat === "auth" && action.includes("mfa")) return "high";
  if (cat === "team" || cat === "billing") return "medium";
  if (cat === "catalog" || cat === "profile") return "medium";
  return "low";
}

export function labelForAuditAction(action: string): string {
  if (LABEL_BY_ACTION[action]) return LABEL_BY_ACTION[action];
  const pretty = action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return pretty || action;
}

export function entityAdminHref(entityType: string | null | undefined, entityId?: string | null): string | null {
  if (!entityType) return null;
  const fn = ENTITY_HREF[entityType];
  if (!fn) return null;
  return fn(entityId ?? "");
}

export function describeAuditEvent(input: {
  action: string;
  actorName?: string | null;
  actorEmail?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  diff?: Record<string, unknown> | null;
}): string {
  const actor =
    (input.actorName && input.actorName.trim()) ||
    (input.actorEmail && input.actorEmail.trim()) ||
    "Someone";
  const verb = labelForAuditAction(input.action).replace(/^\w/, (c) => c.toLowerCase());
  const entityBits: string[] = [];
  if (input.entityType) entityBits.push(input.entityType.replace(/_/g, " "));
  if (input.entityId) entityBits.push(`#${input.entityId}`);
  const entity = entityBits.length ? ` (${entityBits.join(" ")})` : "";

  const extra: string[] = [];
  const d = input.diff;
  if (d) {
    if (typeof d.email === "string") extra.push(d.email);
    if (typeof d.quoteNo === "string") extra.push(d.quoteNo);
    if (typeof d.reportNo === "string") extra.push(d.reportNo);
    if (typeof d.utr === "string") extra.push(`UTR ${d.utr}`);
    if (typeof d.priceInr === "number") extra.push(`₹${d.priceInr}`);
    if (typeof d.role === "string") extra.push(`role ${d.role}`);
  }
  const detail = extra.length ? ` — ${extra.join(", ")}` : "";
  return `${actor} ${verb}${entity}${detail}`;
}

export const HIGH_RISK_ACTIONS = Object.entries(SEVERITY_BY_ACTION)
  .filter(([, s]) => s === "critical" || s === "high")
  .map(([a]) => a);

export function isHighRiskAction(action: string): boolean {
  const s = severityForAuditAction(action);
  return s === "critical" || s === "high";
}
