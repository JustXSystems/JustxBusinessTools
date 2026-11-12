/**
 * One-shot: ensure platform_config.branding has canonical Justxsystems fields
 * after the case-sensitive JustX* / Justx* → Justxsystems rename.
 */
import "dotenv/config";
import {
  BRAND_DEFAULTS,
  coerceBrandAppName,
  coerceBrandLegalName,
  coerceBrandProductName,
} from "@jbt/shared";
import { pool } from "../src/db.js";

const [rows] = await pool.query(
  `SELECT value FROM platform_config WHERE config_key = 'branding' LIMIT 1`,
);
const row = (rows as { value: unknown }[])[0];
const raw =
  row?.value && typeof row.value === "object"
    ? (row.value as Record<string, unknown>)
    : row?.value
      ? (JSON.parse(String(row.value)) as Record<string, unknown>)
      : {};

const next = {
  ...raw,
  appName: coerceBrandAppName(raw.appName ?? raw.installName),
  tagline: String(raw.tagline ?? "").trim() || BRAND_DEFAULTS.tagline,
  installName: coerceBrandAppName(raw.installName ?? raw.appName),
  legalName: coerceBrandLegalName(raw.legalName),
  productName: coerceBrandProductName(raw.productName ?? raw.appName),
};

await pool.query(
  `INSERT INTO platform_config (config_key, value) VALUES ('branding', CAST(:value AS JSON))
   ON DUPLICATE KEY UPDATE value = VALUES(value)`,
  { value: JSON.stringify(next) },
);

console.log("branding normalized:", {
  appName: next.appName,
  legalName: next.legalName,
  productName: next.productName,
  installName: next.installName,
});
await pool.end();
