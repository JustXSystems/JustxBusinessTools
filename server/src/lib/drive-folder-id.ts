/** Extract a Google Drive folder id from a full URL or raw id. */
export function extractDriveFolderId(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const m = v.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return v.replace(/\?.*$/, "").trim();
}
