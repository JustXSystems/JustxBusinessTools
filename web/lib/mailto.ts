/**
 * Build a mailto: URL using RFC 6068 percent-encoding.
 * Do NOT use URLSearchParams here — it encodes spaces as "+" (form-urlencoded),
 * and many mail clients (including Outlook) show those "+" literally in the body.
 */
export function buildMailtoHref(input: {
  to: string;
  cc?: string;
  subject?: string;
  body?: string;
}): string {
  const to = String(input.to ?? "").trim();
  const parts: string[] = [];
  const cc = String(input.cc ?? "").trim();
  const subject = String(input.subject ?? "");
  const body = String(input.body ?? "");
  if (cc) parts.push(`cc=${encodeURIComponent(cc)}`);
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body.slice(0, 1800))}`);
  return parts.length ? `mailto:${to}?${parts.join("&")}` : `mailto:${to}`;
}
