import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { localUploadDir, uploadDriver } from "../lib/storage.js";

const router = Router();

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

router.get(/.*/, async (req, res) => {
  if (uploadDriver() === "s3") {
    res.status(404).json({ error: "Use the cloud public URL for this file" });
    return;
  }
  const raw = String(req.path ?? "").replace(/^\/+/, "");
  if (!raw || raw.includes("..")) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  const root = localUploadDir();
  const abs = path.resolve(root, raw);
  if (!abs.startsWith(root)) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
    createReadStream(abs).pipe(res);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

export default router;
