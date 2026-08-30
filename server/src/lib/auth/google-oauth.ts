import crypto from "node:crypto";
import { pool } from "../../db.js";
import { hashPassword, createSession, setSessionCookie } from "./session.js";
import type { Response } from "express";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.API_PUBLIC_URL ?? "http://localhost:4000"}/api/auth/google/callback`;

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAuthUrl(state: string): string | null {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) return null;

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token: string;
};

type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
};

async function exchangeCode(code: string): Promise<string | null> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) return null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as GoogleTokenResponse;
  return data.access_token ?? null;
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo | null> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as GoogleUserInfo;
}

export async function loginOrRegisterWithGoogle(
  code: string,
  res: Response,
): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const accessToken = await exchangeCode(code);
  if (!accessToken) return { ok: false, error: "Google token exchange failed" };

  const profile = await fetchGoogleUser(accessToken);
  if (!profile?.sub) return { ok: false, error: "Google profile unavailable" };

  const email = (profile.email ?? `google_${profile.sub}@oauth.local`).toLowerCase();
  const name = profile.name ?? null;

  const [oauthRows] = await pool.query(
    `SELECT user_id FROM oauth_identities WHERE provider = 'google' AND provider_user_id = :sub`,
    { sub: profile.sub },
  );
  const oauthRow = Array.isArray(oauthRows) ? oauthRows[0] : null;

  let userId: number;

  if (oauthRow) {
    userId = Number((oauthRow as { user_id: number }).user_id);
  } else {
    const [userRows] = await pool.query(`SELECT id FROM users WHERE email = :email`, { email });
    const existing = Array.isArray(userRows) ? userRows[0] : null;

    if (existing) {
      userId = Number((existing as { id: number }).id);
    } else {
      const randomSecret = crypto.randomBytes(32).toString("hex");
      const passwordHash = await hashPassword(randomSecret);
      const [userResult] = await pool.query(
        `INSERT INTO users (email, password_hash, name) VALUES (:email, :hash, :name)`,
        { email, hash: passwordHash, name },
      );
      userId = Number((userResult as { insertId: number }).insertId);

      const orgName = name ?? "My Business";
      const [orgResult] = await pool.query(
        `INSERT INTO organizations (name, owner_user_id) VALUES (:name, :ownerId)`,
        { name: orgName, ownerId: userId },
      );
      const orgId = Number((orgResult as { insertId: number }).insertId);

      await pool.query(
        `INSERT INTO org_members (organization_id, user_id, role) VALUES (:orgId, :userId, 'owner')`,
        { orgId, userId },
      );

      const [profileResult] = await pool.query(
        `INSERT INTO business_profiles (organization_id, business_name, is_default) VALUES (:orgId, :name, 1)`,
        { orgId, name: orgName },
      );
      const profileId = Number((profileResult as { insertId: number }).insertId);

      await pool.query(
        `INSERT INTO org_subscriptions (organization_id, plan_id, status) VALUES (:orgId, 'free', 'active')`,
        { orgId },
      );
      await pool.query(
        `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:profileId, 'free', 'active')`,
        { profileId },
      );
    }

    await pool.query(
      `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email)
       VALUES (:userId, 'google', :sub, :email)
       ON DUPLICATE KEY UPDATE email = :email`,
      { userId, sub: profile.sub, email },
    );
  }

  const [memberRows] = await pool.query(
    `SELECT organization_id FROM org_members WHERE user_id = :userId ORDER BY id LIMIT 1`,
    { userId },
  );
  const member = Array.isArray(memberRows) ? memberRows[0] : null;
  if (!member) return { ok: false, error: "Organization not found" };

  const orgId = Number((member as { organization_id: number }).organization_id);
  const [profileRows] = await pool.query(
    `SELECT id FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id LIMIT 1`,
    { orgId },
  );
  const bp = Array.isArray(profileRows) ? profileRows[0] : null;
  const profileId = bp ? Number((bp as { id: number }).id) : 1;

  const token = await createSession(userId, orgId, profileId);
  setSessionCookie(res, token);
  return { ok: true, userId };
}
