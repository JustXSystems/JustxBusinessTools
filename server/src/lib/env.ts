/**
 * Startup environment validation — fail fast in production misconfig.
 */
const DEV_JWT_FALLBACK = "jbt-dev-secret-change-in-production";

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEV_JWT_FALLBACK;
}

export function getDriveTokenSecret(): string {
  return (
    process.env.DRIVE_TOKEN_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    DEV_JWT_FALLBACK
  );
}

/**
 * Validates critical env. Throws in production on unsafe defaults.
 * Soft-warns in development.
 */
export function validateServerEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = isProductionRuntime();
  const jwt = process.env.JWT_SECRET?.trim() ?? "";

  if (!jwt || jwt === DEV_JWT_FALLBACK || jwt.length < 32) {
    const msg =
      "JWT_SECRET must be set to a strong random value (≥32 chars); do not use the dev fallback";
    if (prod) errors.push(msg);
    else warnings.push(msg);
  }

  if (prod && process.env.REQUIRE_AUTH !== "true") {
    errors.push("REQUIRE_AUTH=true is required in production");
  }

  if (prod && process.env.PAYMENT_AUTO_COMPLETE === "true") {
    errors.push(
      "PAYMENT_AUTO_COMPLETE=true is forbidden on a public production host — set false",
    );
  }

  const dbRequired = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;
  for (const key of dbRequired) {
    if (!process.env[key]?.trim()) {
      const msg = `${key} is required`;
      if (prod) errors.push(msg);
      else warnings.push(msg);
    }
  }

  if (prod) {
    const base = (process.env.WEB_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
    if (base && !base.startsWith("/")) {
      errors.push("WEB_BASE_PATH / NEXT_PUBLIC_BASE_PATH must start with /");
    }
    if (!process.env.CORS_ORIGIN?.trim()) {
      errors.push("CORS_ORIGIN is required in production (scheme + host, no path)");
    }
    if (
      process.env.CORS_ORIGIN?.includes("/jbt") ||
      process.env.WEB_PUBLIC_ORIGIN?.includes("/jbt")
    ) {
      errors.push("CORS_ORIGIN / WEB_PUBLIC_ORIGIN must be origin only (no /jbt path)");
    }
  }

  for (const w of warnings) {
    console.warn(`[env] ${w}`);
  }
  if (errors.length) {
    throw new Error(`Invalid server environment:\n- ${errors.join("\n- ")}`);
  }
}

export { DEV_JWT_FALLBACK };
