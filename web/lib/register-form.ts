import { GSTIN_RE as SERVER_STYLE_GSTIN } from "./register-gstin";

export type AccountType = "individual" | "business";

export type RegisterFormState = {
  accountType: AccountType;
  name: string;
  phone: string;
  email: string;
  password: string;
  gstin: string;
  businessName: string;
  joiningExisting: boolean;
  homeToolIds: string[];
};

export type RegisterFormError = { ok: false; error: string };
export type RegisterFormOk = { ok: true };
export type RegisterFormResult = RegisterFormOk | RegisterFormError;

export function normalizeAccountType(raw: unknown): AccountType {
  return String(raw ?? "").trim().toLowerCase() === "individual" ? "individual" : "business";
}

export function isValidRegisterGstin(gstin: string): boolean {
  return SERVER_STYLE_GSTIN.test(gstin.trim().toUpperCase());
}

/** Client-side gate before calling /auth/register. */
export function validateRegisterForm(state: RegisterFormState): RegisterFormResult {
  const email = state.email.trim();
  const password = state.password;
  const name = state.name.trim();

  if (!email || password.length < 8) {
    return { ok: false, error: "Email and password (min 8 chars) required" };
  }

  if (state.accountType === "individual") {
    if (!name) return { ok: false, error: "Your name is required" };
    return { ok: true };
  }

  const gstin = state.gstin.trim().toUpperCase();
  if (!isValidRegisterGstin(gstin)) {
    return { ok: false, error: "Enter a valid 15-character GSTIN" };
  }
  if (!state.joiningExisting && !state.businessName.trim()) {
    return { ok: false, error: "Business name is required for a new GSTIN" };
  }
  if (!state.joiningExisting && state.homeToolIds.length === 0) {
    return { ok: false, error: "Select at least one tool to show on your home screen" };
  }
  return { ok: true };
}
