export const PROFILE_ID = 1;
export const FREE_RECORD_LIMIT = 28;

export const DOCUMENT_TOOL_IDS = ["quotation", "salesorder", "invoice", "po"] as const;

export type DocumentToolId = (typeof DOCUMENT_TOOL_IDS)[number];

export function isDocumentToolId(toolId: string): toolId is DocumentToolId {
  return (DOCUMENT_TOOL_IDS as readonly string[]).includes(toolId);
}

export const TRACKER_TOOL_IDS = [
  "paymenttracker",
  "vendors",
  "stock",
  "projects",
  "amc",
  "servicetasks",
  "installation",
  "sitesurvey",
  "pricelist",
  "creditlimit",
  "targettracker",
  "dealerorders",
  "visitors",
] as const;

export type TrackerToolId = (typeof TRACKER_TOOL_IDS)[number];

export function isTrackerToolId(toolId: string): toolId is TrackerToolId {
  return (TRACKER_TOOL_IDS as readonly string[]).includes(toolId);
}

export function newRecordId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}
