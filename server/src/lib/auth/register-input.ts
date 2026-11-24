import { isValidGstin, normalizeGstin } from "../gstin.js";

export type AccountType = "individual" | "business";

export type RegisterPayload = {
  accountType: AccountType;
  email: string;
  password: string;
  name: string;
  phone: string | null;
  gstin: string;
};

export type RegisterValidationOk = { ok: true; data: RegisterPayload };
export type RegisterValidationErr = { ok: false; error: string };
export type RegisterValidation = RegisterValidationOk | RegisterValidationErr;

function blank(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/** Normalize client accountType; unknown values fall back to business. */
export function normalizeAccountType(raw: unknown): AccountType {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "individual" ? "individual" : "business";
}

/**
 * Validate the public registration body.
 * Individual: email + password + name (no GSTIN).
 * Business: email + password + name + valid GSTIN (business name checked on create).
 */
export function validateRegisterPayload(body: unknown): RegisterValidation {
  const src = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const accountType = normalizeAccountType(src.accountType);
  const email = String(src.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(src.password ?? "").trim();
  const name = String(src.name ?? "").trim();
  const phone = blank(src.phone);
  const gstin = normalizeGstin(src.gstin);

  if (!email || password.length < 8) {
    return { ok: false, error: "Email and password (min 8 chars) required" };
  }

  if (!name) {
    return { ok: false, error: "Your name is required" };
  }

  if (accountType === "individual") {
    return {
      ok: true,
      data: { accountType, email, password, name, phone, gstin: "" },
    };
  }

  if (!isValidGstin(gstin)) {
    return { ok: false, error: "A valid 15-character GSTIN is required" };
  }

  return {
    ok: true,
    data: { accountType, email, password, name, phone, gstin },
  };
}

/** New business owners must pick at least one home tool (NULL = all; [] = none). */
export function requireHomeToolsForNewBusiness(homeToolIds: string[] | null | undefined): string | null {
  if (!homeToolIds || homeToolIds.length === 0) {
    return "Select at least one tool to show on your home screen";
  }
  return null;
}

/** Legal / trading name required when creating a profile for a new GSTIN. */
export function requireBusinessNameForNewGstin(raw: unknown): string | null {
  const name = String(raw ?? "").trim();
  return name ? null : "Business name is required for a new GSTIN";
}
