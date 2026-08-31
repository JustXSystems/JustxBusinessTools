import { pool } from "../db.js";
import { getGoogleOAuthConfig } from "./auth/google-oauth.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPES = [
  "openid",
  "email",
  // Full Drive access is required to upload into a pasted/shared company folder ID.
  // drive.file alone only covers files the app created or opened via Picker — paste-folder fails.
  "https://www.googleapis.com/auth/drive",
].join(" ");

export type ProfileDriveConnection = {
  connected: boolean;
  email: string | null;
  folderId: string;
  folderLabel: string;
  connectedAt: string | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureProfileDriveSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS business_profile_drive (
          business_profile_id INT UNSIGNED NOT NULL,
          google_email VARCHAR(180) NULL,
          refresh_token_enc TEXT NULL,
          access_token_enc TEXT NULL,
          access_token_expires_at TIMESTAMP NULL,
          folder_id VARCHAR(128) NULL,
          folder_label VARCHAR(255) NULL,
          connected_at TIMESTAMP NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (business_profile_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export function isDriveOAuthClientConfigured(): boolean {
  return Boolean(getGoogleOAuthConfig());
}

export function driveConnectRedirectUri(): string {
  return (
    process.env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${process.env.API_PUBLIC_URL ?? "http://localhost:4000"}/api/profile/drive/callback`
  );
}

export function buildDriveConnectUrl(state: string): string | null {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: driveConnectRedirectUri(),
    response_type: "code",
    scope: DRIVE_SCOPES,
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export async function exchangeDriveCode(code: string): Promise<TokenResponse | null> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) return null;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: driveConnectRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse | null> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) return null;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ? data.email.toLowerCase() : null;
}

export async function saveProfileDriveConnection(input: {
  profileId: number;
  refreshToken: string;
  accessToken: string;
  expiresIn?: number;
  email?: string | null;
  folderId?: string;
  folderLabel?: string;
}): Promise<void> {
  await ensureProfileDriveSchema();
  const expiresAt = new Date(Date.now() + (Number(input.expiresIn) || 3600) * 1000);
  await pool.query(
    `INSERT INTO business_profile_drive
     (business_profile_id, google_email, refresh_token_enc, access_token_enc, access_token_expires_at,
      folder_id, folder_label, connected_at)
     VALUES (:profileId, :email, :refresh, :access, :expires, :folderId, :folderLabel, NOW())
     ON DUPLICATE KEY UPDATE
       google_email = COALESCE(:email, google_email),
       refresh_token_enc = :refresh,
       access_token_enc = :access,
       access_token_expires_at = :expires,
       folder_id = COALESCE(:folderId, folder_id),
       folder_label = COALESCE(:folderLabel, folder_label),
       connected_at = COALESCE(connected_at, NOW())`,
    {
      profileId: input.profileId,
      email: input.email ?? null,
      refresh: encryptSecret(input.refreshToken),
      access: encryptSecret(input.accessToken),
      expires: expiresAt,
      folderId: input.folderId ?? null,
      folderLabel: input.folderLabel ?? null,
    },
  );
}

export async function getProfileDrivePublic(profileId: number): Promise<ProfileDriveConnection> {
  await ensureProfileDriveSchema();
  const [rows] = await pool.query(
    `SELECT google_email, refresh_token_enc, folder_id, folder_label, connected_at
     FROM business_profile_drive WHERE business_profile_id = :id LIMIT 1`,
    { id: profileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as
        | {
            google_email: string | null;
            refresh_token_enc: string | null;
            folder_id: string | null;
            folder_label: string | null;
            connected_at: Date | string | null;
          }
        | undefined)
    : undefined;
  return {
    connected: Boolean(row?.refresh_token_enc),
    email: row?.google_email ?? null,
    folderId: row?.folder_id ?? "",
    folderLabel: row?.folder_label ?? "",
    connectedAt: row?.connected_at ? String(row.connected_at) : null,
  };
}

export async function updateProfileDriveFolder(
  profileId: number,
  folderId: string,
  folderLabel: string,
): Promise<void> {
  await ensureProfileDriveSchema();
  // Upsert so a folder can be saved even if the row was partially created.
  await pool.query(
    `INSERT INTO business_profile_drive (business_profile_id, folder_id, folder_label)
     VALUES (:id, :folderId, :folderLabel)
     ON DUPLICATE KEY UPDATE
       folder_id = :folderId,
       folder_label = :folderLabel`,
    { id: profileId, folderId: folderId.slice(0, 128), folderLabel: folderLabel.slice(0, 255) },
  );
}

export async function disconnectProfileDrive(profileId: number): Promise<void> {
  await ensureProfileDriveSchema();
  await pool.query(`DELETE FROM business_profile_drive WHERE business_profile_id = :id`, {
    id: profileId,
  });
}

/** Returns a usable access token for this Business Profile (refreshes if needed). */
export async function getProfileDriveAccessToken(profileId: number): Promise<string | null> {
  await ensureProfileDriveSchema();
  const [rows] = await pool.query(
    `SELECT refresh_token_enc, access_token_enc, access_token_expires_at
     FROM business_profile_drive WHERE business_profile_id = :id LIMIT 1`,
    { id: profileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as
        | {
            refresh_token_enc: string | null;
            access_token_enc: string | null;
            access_token_expires_at: Date | string | null;
          }
        | undefined)
    : undefined;
  if (!row?.refresh_token_enc) return null;

  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;
  if (row.access_token_enc && expiresAt > Date.now() + 60_000) {
    try {
      return decryptSecret(row.access_token_enc);
    } catch {
      /* refresh below */
    }
  }

  const refreshToken = decryptSecret(row.refresh_token_enc);
  const tokens = await refreshAccessToken(refreshToken);
  if (!tokens?.access_token) return null;

  const newExpires = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000);
  await pool.query(
    `UPDATE business_profile_drive
     SET access_token_enc = :access, access_token_expires_at = :expires
     WHERE business_profile_id = :id`,
    {
      id: profileId,
      access: encryptSecret(tokens.access_token),
      expires: newExpires,
    },
  );
  return tokens.access_token;
}

export async function completeDriveConnect(input: {
  profileId: number;
  code: string;
}): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const tokens = await exchangeDriveCode(input.code);
  if (!tokens?.access_token) return { ok: false, error: "Google token exchange failed" };
  if (!tokens.refresh_token) {
    return {
      ok: false,
      error:
        "Google did not return a refresh token. Disconnect the app in Google Account permissions and try again.",
    };
  }
  const email = await fetchGoogleEmail(tokens.access_token);
  await saveProfileDriveConnection({
    profileId: input.profileId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    email,
  });
  return { ok: true, email };
}

export { fetchGoogleEmail };
