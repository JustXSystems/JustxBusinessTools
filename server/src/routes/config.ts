import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getPlatformBranding } from "../lib/config/branding.js";
import { getPoweredBy } from "../lib/config/powered-by.js";
import { getEffectiveConfig } from "../lib/config/effective.js";
import {
  isPathInsideRoot,
  localUploadDir,
  uploadDriver,
  withFileAccessToken,
} from "../lib/storage.js";

const router = Router();

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function normalizeInstallIconPath(raw: string): string {
  let u = String(raw || "").trim();
  if (/\/icons\/presets\/justx-.+\.svg$/i.test(u)) {
    u = u.replace(/\.svg$/i, ".png");
  }
  return u || "/icons/presets/justx-mark.png";
}

function webPublicRoot(): string {
  // server/ → ../web/public (monorepo) or PUBLIC_DIR override
  if (process.env.WEB_PUBLIC_DIR) {
    return path.resolve(process.env.WEB_PUBLIC_DIR);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../web/public");
}

async function resolveInstallIconFile(
  iconUrl: string,
): Promise<{ abs: string; mime: string } | null> {
  const rel = normalizeInstallIconPath(iconUrl).split("?")[0];

  if (rel.startsWith("/api/files/")) {
    if (uploadDriver() === "s3") return null;
    const key = rel.replace(/^\/api\/files\//, "").split("?")[0] ?? "";
    const root = localUploadDir();
    const abs = path.resolve(root, key);
    if (!isPathInsideRoot(abs, root) || !existsSync(abs)) return null;
    const ext = path.extname(abs).toLowerCase();
    return { abs, mime: MIME[ext] ?? "image/png" };
  }

  if (rel.startsWith("/icons/")) {
    const abs = path.resolve(webPublicRoot(), rel.replace(/^\//, ""));
    const root = webPublicRoot();
    if (!isPathInsideRoot(abs, root) || !existsSync(abs)) return null;
    const ext = path.extname(abs).toLowerCase();
    return { abs, mime: MIME[ext] ?? "image/png" };
  }

  return null;
}

router.get("/effective", async (_req, res) => {
  res.json(await getEffectiveConfig());
});

/** Public JustXSystems branding for splash / login (no auth required). */
router.get("/branding", async (_req, res) => {
  const [branding, poweredBy] = await Promise.all([getPlatformBranding(), getPoweredBy()]);
  res.json({
    branding: {
      ...branding,
      logoUrl: withFileAccessToken(branding.logoUrl) ?? branding.logoUrl,
      installIconUrl: withFileAccessToken(branding.installIconUrl) ?? branding.installIconUrl,
    },
    poweredBy,
  });
});

/**
 * Canonical install icon for PWA / desktop shortcuts.
 * Chrome reads this via the web manifest — must be a real raster file, not SVG.
 */
router.get("/install-icon.png", async (req, res) => {
  try {
    const branding = await getPlatformBranding();
    const iconUrl = normalizeInstallIconPath(branding.installIconUrl || branding.logoUrl);
    const file = await resolveInstallIconFile(iconUrl);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.setHeader("X-Install-Icon-Source", iconUrl);

    if (!file) {
      // Last resort: tiny 1x1 transparent PNG so install doesn't break.
      const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2XQAAAAASUVORK5CYII=",
        "base64",
      );
      res.setHeader("Content-Type", "image/png");
      res.status(200).send(pixel);
      return;
    }

    const info = await stat(file.abs);
    if (!info.isFile()) {
      res.status(404).json({ error: "Install icon not found" });
      return;
    }

    // Optional size query is informational; we stream the source PNG as-is.
    // Chrome scales 512→192 fine for the install dialog.
    void req.query.size;
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Length", String(info.size));
    createReadStream(file.abs).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Icon failed" });
  }
});

/** Debug helper: confirms which icon path branding currently resolves to. */
router.get("/install-icon-meta", async (_req, res) => {
  const branding = await getPlatformBranding();
  const iconUrl = normalizeInstallIconPath(branding.installIconUrl || branding.logoUrl);
  const file = await resolveInstallIconFile(iconUrl);
  let bytes = 0;
  if (file) {
    try {
      bytes = (await readFile(file.abs)).length;
    } catch {
      bytes = 0;
    }
  }
  res.json({
    installName: branding.installName,
    installIconUrl: branding.installIconUrl,
    installIconBg: branding.installIconBg,
    resolved: iconUrl,
    file: file?.abs ?? null,
    bytes,
  });
});

export default router;
