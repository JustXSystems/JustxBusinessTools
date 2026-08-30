import { pool } from "../../db.js";
import { jsonVal } from "../admin/approvals.js";

export type UpiPayee = {
  enabled: boolean;
  vpa: string;
  payeeName: string;
  merchantCode: string;
};

export type UpiNotify = {
  emailEnabled: boolean;
  emailTo: string;
  whatsappEnabled: boolean;
  whatsappTo: string;
  submitSubject: string;
  submitBody: string;
  decisionSubject: string;
  decisionBody: string;
};

const DEFAULT_PAYEE: UpiPayee = {
  enabled: true,
  vpa: "justx@upi",
  payeeName: "JustXSystems LLP",
  merchantCode: "",
};

const DEFAULT_NOTIFY: UpiNotify = {
  emailEnabled: true,
  emailTo: "billing@justx.local",
  whatsappEnabled: true,
  whatsappTo: "",
  submitSubject: "New UPI subscription payment to verify",
  submitBody:
    "Claim #{{id}} from {{payerName}} ({{payerEmail}} / {{payerPhone}}) paid ₹{{amount}} via UPI. UTR {{utr}}. Payer UPI: {{payerUpi}}. Org: {{orgName}}.",
  decisionSubject: "JustXSystems subscription payment {{status}}",
  decisionBody:
    "Hello {{payerName}}, your JustXSystems payment of ₹{{amount}} (UTR {{utr}}) was {{status}}. {{reviewNote}}",
};

let schemaReady: Promise<void> | null = null;

export async function ensureUpiSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS upi_payment_claims (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          organization_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          plan_id VARCHAR(40) NOT NULL,
          tool_ids JSON NULL,
          amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          payer_name VARCHAR(160) NOT NULL,
          payer_email VARCHAR(180) NOT NULL,
          payer_phone VARCHAR(20) NULL,
          payer_upi VARCHAR(80) NULL,
          utr VARCHAR(64) NOT NULL,
          paid_at DATE NULL,
          notes TEXT NULL,
          review_note TEXT NULL,
          reviewed_by INT UNSIGNED NULL,
          reviewed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_upi_claim_org (organization_id, status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      try {
        await pool.query(`ALTER TABLE upi_payment_claims ADD COLUMN tool_ids JSON NULL`);
      } catch {
        /* column already exists */
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notify_outbox (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          channel VARCHAR(20) NOT NULL,
          destination VARCHAR(180) NOT NULL,
          subject VARCHAR(200) NULL,
          body TEXT NOT NULL,
          kind VARCHAR(40) NOT NULL,
          claim_id BIGINT UNSIGNED NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'sent',
          error_message VARCHAR(255) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

async function readConfig<T extends Record<string, unknown>>(key: string, fallback: T): Promise<T> {
  await ensureUpiSchema();
  const [rows] = await pool.query(
    `SELECT value FROM platform_config WHERE config_key = :key`,
    { key },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ...fallback };
  const raw = jsonVal((row as { value: unknown }).value);
  if (!raw || Array.isArray(raw)) return { ...fallback };
  return { ...fallback, ...(raw as T) };
}

async function writeConfig(key: string, value: Record<string, unknown>): Promise<void> {
  await ensureUpiSchema();
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value = :value`,
    { key, value: JSON.stringify(value) },
  );
}

export async function getUpiPayee(): Promise<UpiPayee> {
  return readConfig("upi_payee", DEFAULT_PAYEE);
}

export async function saveUpiPayee(input: Partial<UpiPayee>): Promise<UpiPayee> {
  const current = await getUpiPayee();
  const next: UpiPayee = {
    enabled: input.enabled ?? current.enabled,
    vpa: String(input.vpa ?? current.vpa).trim(),
    payeeName: String(input.payeeName ?? current.payeeName).trim() || "JustXSystems LLP",
    merchantCode: String(input.merchantCode ?? current.merchantCode ?? "").trim(),
  };
  await writeConfig("upi_payee", next);
  return next;
}

export async function getUpiNotify(): Promise<UpiNotify> {
  return readConfig("upi_notify", DEFAULT_NOTIFY);
}

export async function saveUpiNotify(input: Partial<UpiNotify>): Promise<UpiNotify> {
  const current = await getUpiNotify();
  const next: UpiNotify = {
    ...current,
    ...input,
    emailTo: String(input.emailTo ?? current.emailTo).trim(),
    whatsappTo: String(input.whatsappTo ?? current.whatsappTo).trim(),
  };
  await writeConfig("upi_notify", next);
  return next;
}

export function buildUpiIntent(payee: UpiPayee, amountInr: number, note: string): string {
  const params = new URLSearchParams();
  params.set("pa", payee.vpa);
  params.set("pn", payee.payeeName);
  params.set("am", amountInr.toFixed(2));
  params.set("cu", "INR");
  params.set("tn", note.slice(0, 50));
  if (payee.merchantCode) params.set("mc", payee.merchantCode);
  return `upi://pay?${params.toString()}`;
}

export function publicPayee(payee: UpiPayee) {
  return {
    enabled: payee.enabled && Boolean(payee.vpa),
    vpa: payee.vpa,
    payeeName: payee.payeeName,
  };
}
