import { buildMailtoHref } from "@/lib/mailto";

export type QrType =
  | "url"
  | "text"
  | "upi"
  | "maps"
  | "email"
  | "phone"
  | "sms"
  | "whatsapp"
  | "vcard"
  | "wifi"
  | "event"
  | "review"
  | "social"
  | "app"
  | "meeting"
  | "bank"
  | "asset"
  | "coupon";

export type QrFields = Record<string, string>;

export type QrFieldType =
  | "text"
  | "url"
  | "email"
  | "tel"
  | "number"
  | "textarea"
  | "select"
  | "checkbox"
  | "date"
  | "datetime-local";

export type QrFieldDef = {
  key: string;
  label: string;
  type: QrFieldType;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Render at half width on wide screens (paired with the next half field). */
  half?: boolean;
  hint?: string;
  maxLength?: number;
  showIf?: (fields: QrFields) => boolean;
};

export type QrTypeDef = {
  id: QrType;
  label: string;
  icon: string;
  group: string;
  hint: string;
  fields: QrFieldDef[];
  defaults?: QrFields;
};

export type QrPayloadResult =
  | { ok: true; payload: string; warning?: string }
  /** `error` is empty when the form is merely incomplete (nothing to flag yet). */
  | { ok: false; error: string };

const MAPS_MODES = [
  { value: "coords", label: "Latitude / longitude" },
  { value: "search", label: "Address or place name" },
  { value: "link", label: "Paste a Google Maps link" },
];

const WIFI_SECURITY = [
  { value: "WPA", label: "WPA / WPA2 / WPA3 (most networks)" },
  { value: "WEP", label: "WEP (legacy)" },
  { value: "nopass", label: "None — open network" },
];

type Platform = { value: string; label: string; base?: string; hosts: string[] };

const SOCIAL_PLATFORMS: Platform[] = [
  { value: "instagram", label: "Instagram", base: "https://www.instagram.com/", hosts: ["instagram.com"] },
  { value: "linkedin-company", label: "LinkedIn company page", base: "https://www.linkedin.com/company/", hosts: ["linkedin.com"] },
  { value: "linkedin", label: "LinkedIn profile", base: "https://www.linkedin.com/in/", hosts: ["linkedin.com"] },
  { value: "facebook", label: "Facebook", base: "https://www.facebook.com/", hosts: ["facebook.com", "fb.com", "fb.me"] },
  { value: "youtube", label: "YouTube channel", base: "https://www.youtube.com/@", hosts: ["youtube.com", "youtu.be"] },
  { value: "x", label: "X (Twitter)", base: "https://x.com/", hosts: ["x.com", "twitter.com"] },
  { value: "telegram", label: "Telegram", base: "https://t.me/", hosts: ["t.me", "telegram.me"] },
  { value: "threads", label: "Threads", base: "https://www.threads.net/@", hosts: ["threads.net", "threads.com"] },
];

const APP_STORES: Platform[] = [
  { value: "play", label: "Google Play", hosts: ["play.google.com"] },
  { value: "appstore", label: "Apple App Store", hosts: ["apps.apple.com", "itunes.apple.com"] },
];

const MEETING_PLATFORMS: Platform[] = [
  { value: "zoom", label: "Zoom", hosts: ["zoom.us", "zoom.com"] },
  { value: "meet", label: "Google Meet", hosts: ["meet.google.com"] },
  { value: "teams", label: "Microsoft Teams", hosts: ["teams.microsoft.com", "teams.live.com"] },
  { value: "webex", label: "Webex", hosts: ["webex.com"] },
  { value: "other", label: "Other", hosts: [] },
];

const ACCOUNT_TYPES = [
  { value: "", label: "—" },
  { value: "Current", label: "Current" },
  { value: "Savings", label: "Savings" },
];

const options = (list: Platform[]) => list.map(({ value, label }) => ({ value, label }));

export const QR_TYPES: QrTypeDef[] = [
  {
    id: "url",
    label: "Website URL",
    icon: "🔗",
    group: "Links & text",
    hint: "Opens a web page. https:// is added automatically if missing.",
    fields: [{ key: "url", label: "Website address", type: "url", required: true, placeholder: "www.example.com/offer" }],
  },
  {
    id: "text",
    label: "Plain text",
    icon: "📝",
    group: "Links & text",
    hint: "Shows the text on the scanner's screen.",
    fields: [{ key: "text", label: "Text", type: "textarea", required: true, placeholder: "Any message, serial number, notes…" }],
  },
  {
    id: "upi",
    label: "UPI payment",
    icon: "💸",
    group: "Payments",
    hint: "Opens GPay, PhonePe, Paytm, BHIM or any UPI app with the payee pre-filled.",
    fields: [
      { key: "pa", label: "UPI ID (VPA)", type: "text", required: true, placeholder: "yourname@okhdfcbank", half: true },
      { key: "pn", label: "Payee name", type: "text", placeholder: "Business or person name", half: true },
      { key: "am", label: "Amount (₹)", type: "number", placeholder: "Leave blank to let payer enter", half: true, hint: "Optional — fixes the amount on the payer's screen." },
      { key: "tr", label: "Reference / invoice no.", type: "text", placeholder: "e.g. INV-1024", half: true },
      { key: "tn", label: "Payment note", type: "text", placeholder: "e.g. Advance for solar install", maxLength: 50 },
    ],
  },
  {
    id: "bank",
    label: "Bank transfer (NEFT/IMPS)",
    icon: "🏦",
    group: "Payments",
    hint: "Shows account number, IFSC and GSTIN on the scanner's screen — perfect for invoices and B2B payments.",
    fields: [
      { key: "holder", label: "Account holder name", type: "text", required: true, placeholder: "Acme Solar Pvt Ltd" },
      { key: "account", label: "Account number", type: "text", required: true, placeholder: "50200012345678", half: true },
      { key: "ifsc", label: "IFSC", type: "text", required: true, placeholder: "HDFC0001234", half: true, maxLength: 11 },
      { key: "bankName", label: "Bank", type: "text", placeholder: "HDFC Bank", half: true },
      { key: "branch", label: "Branch", type: "text", placeholder: "Andheri East", half: true },
      { key: "accountType", label: "Account type", type: "select", options: ACCOUNT_TYPES, half: true },
      { key: "gstin", label: "GSTIN", type: "text", placeholder: "27ABCDE1234F1Z5", half: true, maxLength: 15 },
    ],
  },
  {
    id: "maps",
    label: "Google Maps location",
    icon: "📍",
    group: "Location",
    hint: "Opens the location in Google Maps (or the phone's default maps app).",
    defaults: { mode: "coords" },
    fields: [
      { key: "mode", label: "Location from", type: "select", options: MAPS_MODES },
      { key: "lat", label: "Latitude", type: "number", placeholder: "e.g. 19.0760", half: true, showIf: (f) => mapsMode(f) === "coords" },
      { key: "lng", label: "Longitude", type: "number", placeholder: "e.g. 72.8777", half: true, showIf: (f) => mapsMode(f) === "coords" },
      { key: "query", label: "Address or place", type: "textarea", placeholder: "Shop 12, MG Road, Pune 411001", showIf: (f) => mapsMode(f) === "search" },
      { key: "link", label: "Google Maps link", type: "url", placeholder: "https://maps.app.goo.gl/…", showIf: (f) => mapsMode(f) === "link", hint: "In Google Maps tap Share → Copy link, then paste here." },
    ],
  },
  {
    id: "review",
    label: "Google review link",
    icon: "⭐",
    group: "Location",
    hint: "Takes customers straight to the \"Write a review\" box for your Google Business Profile.",
    fields: [
      {
        key: "place",
        label: "Place ID or review link",
        type: "text",
        required: true,
        placeholder: "ChIJ… or https://g.page/r/…/review",
        hint: "Find your Place ID with Google's \"Place ID Finder\", or copy the review link from your Business Profile.",
      },
    ],
  },
  {
    id: "email",
    label: "Email",
    icon: "✉️",
    group: "Contact",
    hint: "Opens a new email with the recipient, subject and body pre-filled.",
    fields: [
      { key: "to", label: "To", type: "email", required: true, placeholder: "sales@example.com" },
      { key: "subject", label: "Subject", type: "text", placeholder: "Enquiry" },
      { key: "body", label: "Message", type: "textarea", placeholder: "Hi, I'd like to know more about…" },
    ],
  },
  {
    id: "phone",
    label: "Phone call",
    icon: "📞",
    group: "Contact",
    hint: "Opens the dialer with the number ready to call.",
    fields: [{ key: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+91 98765 43210" }],
  },
  {
    id: "sms",
    label: "SMS",
    icon: "💬",
    group: "Contact",
    hint: "Opens the messaging app with the number and message pre-filled.",
    fields: [
      { key: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+91 98765 43210" },
      { key: "message", label: "Message", type: "textarea", placeholder: "Hi, please call me back." },
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp chat",
    icon: "🟢",
    group: "Contact",
    hint: "Starts a WhatsApp chat. 10-digit numbers are treated as Indian (+91).",
    fields: [
      { key: "phone", label: "WhatsApp number", type: "tel", required: true, placeholder: "+91 98765 43210" },
      { key: "message", label: "Pre-filled message", type: "textarea", placeholder: "Hi, I saw your QR code…" },
    ],
  },
  {
    id: "vcard",
    label: "Contact card (vCard)",
    icon: "👤",
    group: "Contact",
    hint: "Saves a contact to the phone in one tap.",
    fields: [
      { key: "firstName", label: "First name", type: "text", half: true },
      { key: "lastName", label: "Last name", type: "text", half: true },
      { key: "org", label: "Company", type: "text", half: true },
      { key: "title", label: "Job title", type: "text", half: true },
      { key: "mobile", label: "Mobile", type: "tel", half: true },
      { key: "workPhone", label: "Work phone", type: "tel", half: true },
      { key: "email", label: "Email", type: "email", half: true },
      { key: "website", label: "Website", type: "url", half: true },
      { key: "street", label: "Street address", type: "text" },
      { key: "city", label: "City", type: "text", half: true },
      { key: "state", label: "State", type: "text", half: true },
      { key: "zip", label: "PIN code", type: "text", half: true },
      { key: "country", label: "Country", type: "text", half: true },
      { key: "note", label: "Note", type: "textarea", placeholder: "GSTIN, working hours…" },
    ],
    defaults: { country: "India" },
  },
  {
    id: "social",
    label: "Social profile",
    icon: "📣",
    group: "Social & apps",
    hint: "Opens your Instagram, LinkedIn, YouTube or other profile — in the app when it's installed.",
    defaults: { platform: "instagram" },
    fields: [
      { key: "platform", label: "Platform", type: "select", options: options(SOCIAL_PLATFORMS) },
      { key: "handle", label: "Username or profile link", type: "text", required: true, placeholder: "@acmesolar or https://…" },
    ],
  },
  {
    id: "app",
    label: "App download",
    icon: "📲",
    group: "Social & apps",
    hint: "Opens your app's store page. One code opens one store — make one per store, or link to a web page with both badges.",
    defaults: { store: "play" },
    fields: [
      { key: "store", label: "Store", type: "select", options: options(APP_STORES) },
      {
        key: "app",
        label: "App ID or store link",
        type: "text",
        required: true,
        placeholder: "com.acme.app · id1234567890 · https://…",
        hint: "Google Play: the package name. App Store: the numeric id from the store URL.",
      },
    ],
  },
  {
    id: "wifi",
    label: "Wi-Fi network",
    icon: "📶",
    group: "Network",
    hint: "Joins the Wi-Fi network without typing the password.",
    defaults: { security: "WPA" },
    fields: [
      { key: "ssid", label: "Network name (SSID)", type: "text", required: true, placeholder: "Office-WiFi" },
      { key: "security", label: "Security", type: "select", options: WIFI_SECURITY, half: true },
      { key: "password", label: "Password", type: "text", half: true, showIf: (f) => (f.security || "WPA") !== "nopass" },
      { key: "hidden", label: "Hidden network (SSID not broadcast)", type: "checkbox" },
    ],
  },
  {
    id: "meeting",
    label: "Video meeting",
    icon: "🎥",
    group: "Meetings & events",
    hint: "Joins a Zoom, Google Meet, Teams or Webex call in one scan — great for conference rooms and printed agendas.",
    defaults: { platform: "zoom" },
    fields: [
      { key: "platform", label: "Platform", type: "select", options: options(MEETING_PLATFORMS) },
      {
        key: "link",
        label: "Meeting link or ID",
        type: "text",
        required: true,
        placeholder: "https://… · Zoom ID 812 3456 7890 · Meet code abc-defg-hij",
        hint: "Paste the full invite link to include the passcode.",
      },
    ],
  },
  {
    id: "event",
    label: "Calendar event",
    icon: "📅",
    group: "Meetings & events",
    hint: "Adds a meeting, site visit or launch to the scanner's calendar.",
    fields: [
      { key: "title", label: "Event title", type: "text", required: true, placeholder: "Product demo" },
      { key: "start", label: "Starts", type: "datetime-local", required: true, half: true },
      { key: "end", label: "Ends", type: "datetime-local", half: true, hint: "Defaults to 1 hour after start." },
      { key: "location", label: "Location", type: "text" },
      { key: "description", label: "Details", type: "textarea" },
    ],
  },
  {
    id: "coupon",
    label: "Offer / coupon",
    icon: "🎟️",
    group: "Business",
    hint: "Hands out a discount code for flyers, packaging and counters — optionally straight to your redeem page.",
    fields: [
      { key: "code", label: "Coupon code", type: "text", required: true, placeholder: "DIWALI20", half: true, maxLength: 40 },
      { key: "validTill", label: "Valid till", type: "date", half: true },
      { key: "offer", label: "Offer", type: "text", placeholder: "Flat 20% off on AMC renewals", maxLength: 80 },
      { key: "terms", label: "Terms", type: "textarea", placeholder: "Min. order ₹5,000. One use per customer." },
      {
        key: "redeemUrl",
        label: "Redeem link",
        type: "url",
        placeholder: "https://shop.example.com/cart?coupon={code}",
        hint: "Optional. Put {code} where the coupon goes and the QR opens that page directly.",
      },
    ],
  },
  {
    id: "asset",
    label: "Asset / inventory tag",
    icon: "🏷️",
    group: "Business",
    hint: "Labels laptops, machines, panels and stock. Pair with bulk generation to print a whole sheet of tags.",
    fields: [
      { key: "assetId", label: "Asset ID", type: "text", required: true, placeholder: "IT-LAP-0042", half: true, maxLength: 60 },
      { key: "name", label: "Item", type: "text", placeholder: "Dell Latitude 5440", half: true },
      { key: "serial", label: "Serial no.", type: "text", half: true },
      { key: "location", label: "Location", type: "text", placeholder: "Pune HQ · Floor 3", half: true },
      { key: "custodian", label: "Custodian / department", type: "text", half: true },
      { key: "contact", label: "Report issues to", type: "text", placeholder: "it@acme.in · +91 98765 43210", half: true },
      {
        key: "lookupUrl",
        label: "Asset system link",
        type: "url",
        placeholder: "https://assets.acme.in/a/{id}",
        hint: "Optional. Put {id} where the asset ID goes and the QR opens that record; otherwise the details are shown as text.",
      },
    ],
  },
];

export function getQrTypeDef(type: QrType): QrTypeDef {
  return QR_TYPES.find((t) => t.id === type) ?? QR_TYPES[0];
}

export function isQrType(value: unknown): value is QrType {
  return QR_TYPES.some((t) => t.id === value);
}

function mapsMode(f: QrFields): string {
  return f.mode || "coords";
}

function val(fields: QrFields, key: string): string {
  return String(fields[key] ?? "").trim();
}

const INCOMPLETE: QrPayloadResult = { ok: false, error: "" };

function fail(error: string): QrPayloadResult {
  return { ok: false, error };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

/** Adds https:// when no scheme is present; returns null when not a usable http(s) URL. */
export function normalizeWebUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

export type UtmParams = { source?: string; medium?: string; campaign?: string };

/** Adds utm_* parameters that aren't already present on the URL. */
export function applyUtm(url: string, utm: UtmParams): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const pairs: Array<[string, string | undefined]> = [
    ["utm_source", utm.source],
    ["utm_medium", utm.medium],
    ["utm_campaign", utm.campaign],
  ];
  let changed = false;
  for (const [key, raw] of pairs) {
    const value = String(raw ?? "").trim();
    if (value && !u.searchParams.has(key)) {
      u.searchParams.set(key, value);
      changed = true;
    }
  }
  return changed ? u.toString() : url;
}

/** Strips formatting; keeps a leading +. Returns null unless 3–15 digits remain. */
export function normalizePhone(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const plus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

/** UPI apps are inconsistent about decoding %40, so keep "@" literal. */
function upiEncode(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@");
}

/** Wi-Fi QR (ZXing) escaping: backslash before \ ; , : " */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** vCard 3.0 / iCalendar text escaping. */
export function escapeVText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([;,])/g, "\\$1");
}

function toIcsLocal(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? "00"}`;
}

function addHourLocal(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildUpi(f: QrFields): QrPayloadResult {
  const pa = val(f, "pa");
  if (!pa) return INCOMPLETE;
  if (!VPA_RE.test(pa)) return fail("Enter a valid UPI ID, e.g. name@okicici.");
  const params = [`pa=${upiEncode(pa)}`];
  const pn = val(f, "pn");
  if (pn) params.push(`pn=${upiEncode(pn)}`);
  const am = val(f, "am");
  if (am) {
    const n = Number(am);
    if (!Number.isFinite(n) || n <= 0) return fail("Amount must be greater than zero.");
    if (!/^\d+(\.\d{1,2})?$/.test(am)) return fail("Amount can have at most 2 decimal places.");
    params.push(`am=${n.toFixed(2)}`);
  }
  params.push("cu=INR");
  const tr = val(f, "tr");
  if (tr) params.push(`tr=${upiEncode(tr)}`);
  const tn = val(f, "tn");
  if (tn) params.push(`tn=${upiEncode(tn.slice(0, 50))}`);
  const warning = pn ? undefined : "Add a payee name so payers can confirm who they're paying.";
  return { ok: true, payload: `upi://pay?${params.join("&")}`, warning };
}

function buildMaps(f: QrFields): QrPayloadResult {
  const mode = mapsMode(f);
  if (mode === "search") {
    const q = val(f, "query");
    if (!q) return INCOMPLETE;
    return { ok: true, payload: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` };
  }
  if (mode === "link") {
    const raw = val(f, "link");
    if (!raw) return INCOMPLETE;
    const url = normalizeWebUrl(raw);
    if (!url) return fail("Paste a valid Google Maps link.");
    const host = new URL(url).hostname;
    const warning = /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$/.test(host)
      ? undefined
      : "This doesn't look like a Google Maps link — double-check it opens the right place.";
    return { ok: true, payload: url, warning };
  }
  const latRaw = val(f, "lat");
  const lngRaw = val(f, "lng");
  if (!latRaw || !lngRaw) return INCOMPLETE;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail("Latitude must be between -90 and 90.");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail("Longitude must be between -180 and 180.");
  return { ok: true, payload: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` };
}

function buildReview(f: QrFields): QrPayloadResult {
  const raw = val(f, "place");
  if (!raw) return INCOMPLETE;
  if (/^(https?:\/\/|www\.)/i.test(raw) || raw.includes("/")) {
    const url = normalizeWebUrl(raw);
    return url ? { ok: true, payload: url } : fail("Enter a valid review link.");
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(raw)) return fail("That doesn't look like a Google Place ID.");
  return { ok: true, payload: `https://search.google.com/local/writereview?placeid=${raw}` };
}

function buildVcard(f: QrFields): QrPayloadResult {
  const first = val(f, "firstName");
  const last = val(f, "lastName");
  const org = val(f, "org");
  if (!first && !last && !org) return INCOMPLETE;

  const email = val(f, "email");
  if (email && !EMAIL_RE.test(email)) return fail("Enter a valid email address.");
  const websiteRaw = val(f, "website");
  const website = websiteRaw ? normalizeWebUrl(websiteRaw) : null;
  if (websiteRaw && !website) return fail("Enter a valid website address.");

  const e = escapeVText;
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${e(last)};${e(first)};;;`];
  lines.push(`FN:${e([first, last].filter(Boolean).join(" ") || org)}`);
  if (org) lines.push(`ORG:${e(org)}`);
  const title = val(f, "title");
  if (title) lines.push(`TITLE:${e(title)}`);
  const mobile = val(f, "mobile");
  if (mobile) lines.push(`TEL;TYPE=CELL:${normalizePhone(mobile) ?? e(mobile)}`);
  const work = val(f, "workPhone");
  if (work) lines.push(`TEL;TYPE=WORK,VOICE:${normalizePhone(work) ?? e(work)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${email}`);
  if (website) lines.push(`URL:${website}`);
  const adr = ["street", "city", "state", "zip", "country"].map((k) => val(f, k));
  if (adr.slice(0, 4).some(Boolean)) {
    lines.push(`ADR;TYPE=WORK:;;${adr.map(e).join(";")}`);
  }
  const note = val(f, "note");
  if (note) lines.push(`NOTE:${e(note)}`);
  lines.push("END:VCARD");
  return { ok: true, payload: lines.join("\r\n") };
}

function buildWifi(f: QrFields): QrPayloadResult {
  const ssid = String(f.ssid ?? "");
  if (!ssid.trim()) return INCOMPLETE;
  const security = f.security || "WPA";
  const password = String(f.password ?? "");
  if (security !== "nopass" && !password) return INCOMPLETE;
  if (security === "WPA" && password.length < 8) return fail("WPA passwords are at least 8 characters.");
  const parts = [`T:${security}`, `S:${escapeWifi(ssid)}`];
  if (security !== "nopass") parts.push(`P:${escapeWifi(password)}`);
  if (f.hidden === "1") parts.push("H:true");
  return { ok: true, payload: `WIFI:${parts.join(";")};;` };
}

function buildEvent(f: QrFields): QrPayloadResult {
  const title = val(f, "title");
  const startRaw = val(f, "start");
  if (!title || !startRaw) return INCOMPLETE;
  const start = toIcsLocal(startRaw);
  if (!start) return fail("Enter a valid start date and time.");
  const endRaw = val(f, "end") || addHourLocal(startRaw) || "";
  const end = toIcsLocal(endRaw);
  if (!end) return fail("Enter a valid end date and time.");
  if (end < start) return fail("The event must end after it starts.");
  const e = escapeVText;
  const lines = ["BEGIN:VEVENT", `SUMMARY:${e(title)}`, `DTSTART:${start}`, `DTEND:${end}`];
  const location = val(f, "location");
  if (location) lines.push(`LOCATION:${e(location)}`);
  const description = val(f, "description");
  if (description) lines.push(`DESCRIPTION:${e(description)}`);
  lines.push("END:VEVENT");
  return { ok: true, payload: lines.join("\r\n") };
}

function hostMatches(url: string, hosts: string[]): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function looksLikeUrl(raw: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(raw) || raw.includes("/");
}

function platformOf(list: Platform[], value: string | undefined): Platform {
  return list.find((p) => p.value === value) ?? list[0];
}

/** Checks a pasted link against the chosen platform; warns (not fails) on a mismatch. */
function platformLink(raw: string, platform: Platform, noun: string): QrPayloadResult {
  const url = normalizeWebUrl(raw);
  if (!url) return fail(`Enter a valid ${noun} link.`);
  const warning =
    platform.hosts.length && !hostMatches(url, platform.hosts)
      ? `This doesn't look like a ${platform.label} link — double-check it opens the right page.`
      : undefined;
  return { ok: true, payload: url, warning };
}

/** Fills `{token}` in an admin/operator URL template, or returns null when the URL is invalid. */
function fillUrlTemplate(template: string, token: string, value: string): string | null {
  const filled = template.split(`{${token}}`).join(encodeURIComponent(value));
  return normalizeWebUrl(filled);
}

function withQueryParam(raw: string, key: string, value: string): string | null {
  const base = normalizeWebUrl(raw);
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set(key, value);
  return u.toString();
}

function buildSocial(f: QrFields): QrPayloadResult {
  const raw = val(f, "handle");
  if (!raw) return INCOMPLETE;
  const platform = platformOf(SOCIAL_PLATFORMS, f.platform);
  if (looksLikeUrl(raw)) return platformLink(raw, platform, "profile");
  const handle = raw.replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) return fail("Usernames can only contain letters, numbers, dots, dashes and underscores.");
  return { ok: true, payload: `${platform.base}${handle}` };
}

function buildApp(f: QrFields): QrPayloadResult {
  const raw = val(f, "app");
  if (!raw) return INCOMPLETE;
  const store = platformOf(APP_STORES, f.store);
  if (looksLikeUrl(raw)) return platformLink(raw, store, "store");
  if (store.value === "appstore") {
    const m = /^(?:id)?(\d{6,12})$/i.exec(raw);
    return m ? { ok: true, payload: `https://apps.apple.com/app/id${m[1]}` } : fail("Enter the numeric App Store id, e.g. id1234567890.");
  }
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(raw)) return fail("Enter the package name, e.g. com.company.app.");
  return { ok: true, payload: `https://play.google.com/store/apps/details?id=${raw}` };
}

function buildMeeting(f: QrFields): QrPayloadResult {
  const raw = val(f, "link");
  if (!raw) return INCOMPLETE;
  const platform = platformOf(MEETING_PLATFORMS, f.platform);
  if (looksLikeUrl(raw)) return platformLink(raw, platform, "meeting");
  if (platform.value === "zoom") {
    const digits = raw.replace(/[\s-]/g, "");
    if (!/^\d{9,11}$/.test(digits)) return fail("Zoom meeting IDs are 9–11 digits.");
    return {
      ok: true,
      payload: `https://zoom.us/j/${digits}`,
      warning: "Participants will be asked for the passcode — paste the full invite link to skip that.",
    };
  }
  if (platform.value === "meet") {
    const m = /^([a-z]{3})-?([a-z]{4})-?([a-z]{3})$/i.exec(raw);
    return m
      ? { ok: true, payload: `https://meet.google.com/${m[1]}-${m[2]}-${m[3]}`.toLowerCase() }
      : fail("Google Meet codes look like abc-defg-hij.");
  }
  return fail("Paste the full meeting link.");
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function buildBank(f: QrFields): QrPayloadResult {
  const holder = val(f, "holder");
  const accountRaw = val(f, "account");
  const ifscRaw = val(f, "ifsc");
  if (!holder || !accountRaw || !ifscRaw) return INCOMPLETE;
  const account = accountRaw.replace(/[\s-]/g, "");
  if (!/^\d{9,18}$/.test(account)) return fail("Account numbers are 9–18 digits.");
  const ifsc = ifscRaw.toUpperCase();
  if (!IFSC_RE.test(ifsc)) return fail("IFSC is 11 characters, e.g. HDFC0001234.");
  const gstin = val(f, "gstin").toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) return fail("GSTIN is 15 characters, e.g. 27ABCDE1234F1Z5.");
  const bank = [val(f, "bankName"), val(f, "branch")].filter(Boolean).join(", ");
  const lines = [
    "Bank transfer details",
    `Account name: ${holder}`,
    `Account no.: ${account}`,
    `IFSC: ${ifsc}`,
    bank ? `Bank: ${bank}` : "",
    val(f, "accountType") ? `Account type: ${val(f, "accountType")}` : "",
    gstin ? `GSTIN: ${gstin}` : "",
  ];
  return {
    ok: true,
    payload: lines.filter(Boolean).join("\n"),
    warning: "Scanners show these details as text — banking apps can't auto-fill them. Use a UPI code for one-tap payments.",
  };
}

function formatDateIn(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function isPastDate(value: string, now = new Date()): boolean {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return value < today;
}

function buildCoupon(f: QrFields): QrPayloadResult {
  const code = val(f, "code");
  if (!code) return INCOMPLETE;
  if (!/^\S{2,40}$/.test(code)) return fail("Coupon codes are 2–40 characters without spaces.");
  const validTill = val(f, "validTill");
  const validLabel = validTill ? formatDateIn(validTill) : null;
  if (validTill && !validLabel) return fail("Enter a valid date.");
  const warning = validTill && isPastDate(validTill) ? "The valid-till date is in the past." : undefined;
  const redeemRaw = val(f, "redeemUrl");
  if (redeemRaw.includes("{code}")) {
    const url = fillUrlTemplate(redeemRaw, "code", code);
    return url ? { ok: true, payload: url, warning } : fail("Enter a valid redeem link.");
  }
  const redeem = redeemRaw ? normalizeWebUrl(redeemRaw) : null;
  if (redeemRaw && !redeem) return fail("Enter a valid redeem link.");
  const lines = [
    val(f, "offer"),
    `Code: ${code}`,
    validLabel ? `Valid till: ${validLabel}` : "",
    val(f, "terms"),
    redeem ? `Redeem: ${redeem}` : "",
  ];
  return { ok: true, payload: lines.filter(Boolean).join("\n"), warning };
}

function buildAsset(f: QrFields): QrPayloadResult {
  const id = val(f, "assetId");
  if (!id) return INCOMPLETE;
  const lookup = val(f, "lookupUrl");
  if (lookup) {
    const url = lookup.includes("{id}") ? fillUrlTemplate(lookup, "id", id) : withQueryParam(lookup, "asset", id);
    return url ? { ok: true, payload: url } : fail("Enter a valid asset system link.");
  }
  const rows: Array<[string, string]> = [
    ["Item", val(f, "name")],
    ["Serial", val(f, "serial")],
    ["Location", val(f, "location")],
    ["Custodian", val(f, "custodian")],
    ["Report issues", val(f, "contact")],
  ];
  const lines = [`ASSET ${id}`, ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)];
  return { ok: true, payload: lines.join("\n") };
}

export function buildQrPayload(type: QrType, fields: QrFields): QrPayloadResult {
  switch (type) {
    case "url": {
      const raw = val(fields, "url");
      if (!raw) return INCOMPLETE;
      const url = normalizeWebUrl(raw);
      if (!url) return fail("Enter a valid website address, e.g. example.com.");
      const tracked =
        fields.utmOn === "1"
          ? applyUtm(url, { source: fields.utmSource, medium: fields.utmMedium, campaign: fields.utmCampaign })
          : url;
      return { ok: true, payload: tracked };
    }
    case "text": {
      const text = String(fields.text ?? "");
      return text.trim() ? { ok: true, payload: text } : INCOMPLETE;
    }
    case "upi":
      return buildUpi(fields);
    case "maps":
      return buildMaps(fields);
    case "review":
      return buildReview(fields);
    case "email": {
      const to = val(fields, "to");
      if (!to) return INCOMPLETE;
      if (!EMAIL_RE.test(to)) return fail("Enter a valid email address.");
      return {
        ok: true,
        payload: buildMailtoHref({ to, subject: val(fields, "subject"), body: String(fields.body ?? "").trim() }),
      };
    }
    case "phone": {
      const raw = val(fields, "phone");
      if (!raw) return INCOMPLETE;
      const phone = normalizePhone(raw);
      return phone ? { ok: true, payload: `tel:${phone}` } : fail("Enter a valid phone number.");
    }
    case "sms": {
      const raw = val(fields, "phone");
      if (!raw) return INCOMPLETE;
      const phone = normalizePhone(raw);
      if (!phone) return fail("Enter a valid phone number.");
      const message = String(fields.message ?? "").trim();
      return { ok: true, payload: message ? `SMSTO:${phone}:${message}` : `SMSTO:${phone}` };
    }
    case "whatsapp": {
      const raw = val(fields, "phone");
      if (!raw) return INCOMPLETE;
      const phone = normalizePhone(raw);
      if (!phone) return fail("Enter a valid WhatsApp number.");
      let digits = phone.replace(/^\+/, "");
      if (!phone.startsWith("+") && digits.length === 10) digits = `91${digits}`;
      if (digits.length < 8) return fail("Include the country code, e.g. +91.");
      const message = String(fields.message ?? "").trim();
      return {
        ok: true,
        payload: message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`,
      };
    }
    case "vcard":
      return buildVcard(fields);
    case "wifi":
      return buildWifi(fields);
    case "event":
      return buildEvent(fields);
    case "social":
      return buildSocial(fields);
    case "app":
      return buildApp(fields);
    case "meeting":
      return buildMeeting(fields);
    case "bank":
      return buildBank(fields);
    case "coupon":
      return buildCoupon(fields);
    case "asset":
      return buildAsset(fields);
    default:
      return INCOMPLETE;
  }
}

/** Short, filesystem-safe hint for download names. */
export function qrFileStem(type: QrType, fields: QrFields, prefix = "qr"): string {
  const pick: Partial<Record<QrType, string[]>> = {
    url: ["url"],
    upi: ["pn", "pa"],
    vcard: ["firstName", "org"],
    wifi: ["ssid"],
    event: ["title"],
    email: ["to"],
    social: ["handle"],
    app: ["app"],
    meeting: ["platform"],
    bank: ["holder"],
    coupon: ["code"],
    asset: ["assetId"],
  };
  const raw = (pick[type] ?? []).map((k) => val(fields, k)).find(Boolean) ?? "";
  const slug = raw
    .replace(/^https?:\/\//i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug ? `${prefix}-${type}-${slug}` : `${prefix}-${type}`;
}

export function slugify(value: string, max = 48): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}
