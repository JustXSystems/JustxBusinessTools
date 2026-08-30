import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { logAudit } from "../lib/audit.js";
import {
  buildDriveConnectUrl,
  completeDriveConnect,
  disconnectProfileDrive,
  ensureProfileDriveSchema,
  getProfileDrivePublic,
  isDriveOAuthClientConfigured,
  updateProfileDriveFolder,
} from "../lib/profile-drive-oauth.js";
import {
  getActiveProfileId,
  getActiveUserId,
} from "../lib/request-context.js";
import { requireBusinessProfileOwner } from "../middleware/require-business-profile-owner.js";
import { requireWriteAccess } from "../middleware/require-write.js";
import { extractDriveFolderId } from "../lib/drive-folder-id.js";
import { getJwtSecret } from "../lib/env.js";
import { webAppUrl } from "../lib/web-public-url.js";

const router = Router();

function stateSecret(): string {
  return getJwtSecret();
}

function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(state: string): Record<string, unknown> | null {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

router.use(async (_req, _res, next) => {
  try {
    await ensureProfileDriveSchema();
    next();
  } catch (err) {
    next(err);
  }
});

/** Status for Business Profile UI. */
router.get("/status", async (_req, res) => {
  const profileId = getActiveProfileId();
  const drive = await getProfileDrivePublic(profileId);
  res.json({
    ...drive,
    oauthClientConfigured: isDriveOAuthClientConfigured(),
  });
});

/** Start Google Drive OAuth for this Business Profile (Owner). */
router.get("/connect", requireWriteAccess, requireBusinessProfileOwner, (req, res) => {
  if (!isDriveOAuthClientConfigured()) {
    res.status(503).json({
      error:
        "Google OAuth is not configured on the platform. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (same as Google login).",
    });
    return;
  }
  const profileId = getActiveProfileId();
  const userId = getActiveUserId();
  const state = signState({
    profileId,
    userId,
    exp: Date.now() + 15 * 60 * 1000,
    nonce: Math.random().toString(36).slice(2),
  });
  const url = buildDriveConnectUrl(state);
  if (!url) {
    res.status(503).json({ error: "Could not build Google Drive connect URL" });
    return;
  }
  // Browser navigation from Profile page
  if (String(req.query.redirect ?? "") === "1") {
    res.redirect(url);
    return;
  }
  res.json({ url });
});

/** OAuth callback — stores per-profile refresh token, then redirects to Profile. */
router.get("/callback", async (req, res) => {
  const err = String(req.query.error ?? "");
  if (err) {
    res.redirect(`${webAppUrl("/profile")}?drive=error&reason=${encodeURIComponent(err)}`);
    return;
  }
  const code = String(req.query.code ?? "");
  const stateRaw = String(req.query.state ?? "");
  const state = verifyState(stateRaw);
  if (!code || !state) {
    res.redirect(`${webAppUrl("/profile")}?drive=error&reason=invalid_state`);
    return;
  }
  if (Number(state.exp) < Date.now()) {
    res.redirect(`${webAppUrl("/profile")}?drive=error&reason=expired`);
    return;
  }
  const profileId = Number(state.profileId);
  if (!profileId) {
    res.redirect(`${webAppUrl("/profile")}?drive=error&reason=profile`);
    return;
  }
  const result = await completeDriveConnect({ profileId, code });
  if (!result.ok) {
    res.redirect(
      `${webAppUrl("/profile")}?drive=error&reason=${encodeURIComponent(result.error)}`,
    );
    return;
  }
  await logAudit("profile.drive_connect", "business_profile", String(profileId), {
    email: result.email,
  }, req.ip);
  res.redirect(`${webAppUrl("/profile")}?drive=connected`);
});

/** Save folder id/label after connect. */
router.put("/folder", requireWriteAccess, requireBusinessProfileOwner, async (req, res) => {
  const profileId = getActiveProfileId();
  const drive = await getProfileDrivePublic(profileId);
  if (!drive.connected) {
    res.status(400).json({ error: "Connect Google Drive first" });
    return;
  }
  const folderId = extractDriveFolderId(String(req.body?.folderId ?? ""));
  const folderLabel = String(req.body?.folderLabel ?? "Business artifacts").trim().slice(0, 255);
  if (!folderId) {
    res.status(400).json({ error: "Paste a Google Drive folder link or ID" });
    return;
  }
  await updateProfileDriveFolder(profileId, folderId, folderLabel || "Business artifacts");
  res.json(await getProfileDrivePublic(profileId));
});

router.post("/disconnect", requireWriteAccess, requireBusinessProfileOwner, async (req, res) => {
  const profileId = getActiveProfileId();
  await disconnectProfileDrive(profileId);
  await logAudit("profile.drive_disconnect", "business_profile", String(profileId), undefined, req.ip);
  res.json({ ok: true });
});

export default router;
