import { pool } from "../../db.js";

export type RegistrationCopy = {
  pendingOwnerTitle: string;
  pendingOwnerMessage: string;
  /** Use {{email}} for the registrant address. */
  pendingOwnerDetail: string;
  pendingJoinTitle: string;
  pendingJoinMessage: string;
  /** Use {{email}} for the registrant address. */
  pendingJoinDetail: string;
};

export const DEFAULT_REGISTRATION_COPY: RegistrationCopy = {
  pendingOwnerTitle: "Awaiting approval",
  pendingOwnerMessage:
    "Account created. A JustX admin must approve your Owner registration before you can sign in.",
  pendingOwnerDetail:
    "We registered {{email}}. You will be able to sign in after a JustX admin approves your Owner account.",
  pendingJoinTitle: "Awaiting approval",
  pendingJoinMessage:
    "Request sent. The Business Profile Owner must approve you before you can sign in.",
  pendingJoinDetail:
    "We registered {{email}}. You will be able to sign in after the Business Profile Owner (or a JustX admin) approves your request.",
};

const KEY = "registration_copy";

function parseCopy(raw: unknown): RegistrationCopy {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const pick = (key: keyof RegistrationCopy) => {
    const v = String(obj[key] ?? "").trim();
    return v || DEFAULT_REGISTRATION_COPY[key];
  };
  return {
    pendingOwnerTitle: pick("pendingOwnerTitle"),
    pendingOwnerMessage: pick("pendingOwnerMessage"),
    pendingOwnerDetail: pick("pendingOwnerDetail"),
    pendingJoinTitle: pick("pendingJoinTitle"),
    pendingJoinMessage: pick("pendingJoinMessage"),
    pendingJoinDetail: pick("pendingJoinDetail"),
  };
}

export async function getRegistrationCopy(): Promise<RegistrationCopy> {
  const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
    key: KEY,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...DEFAULT_REGISTRATION_COPY };
  return parseCopy((row as { value: unknown }).value);
}

export async function saveRegistrationCopy(
  input: Partial<RegistrationCopy>,
): Promise<RegistrationCopy> {
  const current = await getRegistrationCopy();
  const next: RegistrationCopy = {
    pendingOwnerTitle:
      input.pendingOwnerTitle != null
        ? String(input.pendingOwnerTitle).trim() || DEFAULT_REGISTRATION_COPY.pendingOwnerTitle
        : current.pendingOwnerTitle,
    pendingOwnerMessage:
      input.pendingOwnerMessage != null
        ? String(input.pendingOwnerMessage).trim() || DEFAULT_REGISTRATION_COPY.pendingOwnerMessage
        : current.pendingOwnerMessage,
    pendingOwnerDetail:
      input.pendingOwnerDetail != null
        ? String(input.pendingOwnerDetail).trim() || DEFAULT_REGISTRATION_COPY.pendingOwnerDetail
        : current.pendingOwnerDetail,
    pendingJoinTitle:
      input.pendingJoinTitle != null
        ? String(input.pendingJoinTitle).trim() || DEFAULT_REGISTRATION_COPY.pendingJoinTitle
        : current.pendingJoinTitle,
    pendingJoinMessage:
      input.pendingJoinMessage != null
        ? String(input.pendingJoinMessage).trim() || DEFAULT_REGISTRATION_COPY.pendingJoinMessage
        : current.pendingJoinMessage,
    pendingJoinDetail:
      input.pendingJoinDetail != null
        ? String(input.pendingJoinDetail).trim() || DEFAULT_REGISTRATION_COPY.pendingJoinDetail
        : current.pendingJoinDetail,
  };
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(next) },
  );
  return next;
}

export function applyRegistrationPlaceholders(template: string, email: string): string {
  return String(template || "").replaceAll("{{email}}", email);
}
