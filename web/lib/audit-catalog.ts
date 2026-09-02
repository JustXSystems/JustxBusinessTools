/** Client-side audit category labels (server enriches events with severity/summary). */

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

export const AUDIT_CATEGORIES: Array<{
  id: AuditCategory;
  label: string;
  short: string;
}> = [
  { id: "auth", label: "Sign-in & MFA", short: "Auth" },
  { id: "team", label: "Team & access", short: "Team" },
  { id: "billing", label: "Billing & payments", short: "Billing" },
  { id: "catalog", label: "Tools & catalog", short: "Catalog" },
  { id: "profile", label: "Profiles & Drive", short: "Profiles" },
  { id: "documents", label: "Documents & records", short: "Docs" },
  { id: "artifacts", label: "File delivery", short: "Files" },
  { id: "system", label: "Platform config", short: "System" },
];
