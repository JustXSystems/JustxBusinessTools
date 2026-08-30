import { Router } from "express";
import {
  getInboxNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../lib/notifications.js";
import { ensureNotificationSchema } from "../lib/notification-schema.js";

const router = Router();

router.get("/", async (_req, res) => {
  await ensureNotificationSchema();
  const payload = await getInboxNotifications();
  res.json(payload);
});

router.post("/:id/read", async (req, res) => {
  const ok = await markNotificationRead(String(req.params.id));
  if (!ok) {
    res.status(400).json({ error: "Unable to mark notification as read" });
    return;
  }
  res.json({ ok: true });
});

router.post("/read-all", async (_req, res) => {
  const count = await markAllNotificationsRead();
  res.json({ ok: true, count });
});

export default router;
