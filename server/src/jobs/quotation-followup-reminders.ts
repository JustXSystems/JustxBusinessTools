import {
  FOLLOW_UP_REMINDER_TIMEZONE_DEFAULT,
  listReminderEnabledProfileIds,
  localDateParts,
  runFollowUpRemindersForProfile,
} from "../lib/quotation-followup-reminders.js";

function reminderTimeZone(): string {
  return process.env.FOLLOWUP_REMINDER_TZ?.trim() || FOLLOW_UP_REMINDER_TIMEZONE_DEFAULT;
}

function reminderSendHour(): number {
  const h = Number(process.env.FOLLOWUP_REMINDER_HOUR ?? 9);
  return Number.isFinite(h) ? Math.min(Math.max(Math.floor(h), 0), 23) : 9;
}

export async function runFollowUpRemindersTick(now = new Date()): Promise<void> {
  const { date, hour } = localDateParts(now, reminderTimeZone());
  if (hour < reminderSendHour()) return;

  const profileIds = await listReminderEnabledProfileIds();
  let sent = 0;
  let queued = 0;
  let failed = 0;
  for (const profileId of profileIds) {
    try {
      const r = await runFollowUpRemindersForProfile(profileId, date);
      sent += r.sent;
      queued += r.queued;
      failed += r.failed;
    } catch (err) {
      console.error(`[followup-reminders] profile=${profileId} failed`, err);
    }
  }
  if (sent || queued || failed) {
    console.log(
      `[followup-reminders] date=${date} profiles=${profileIds.length} sent=${sent} queued=${queued} failed=${failed}`,
    );
  }
}

export function startFollowUpReminderScheduler(): void {
  const minutes = Number(process.env.FOLLOWUP_REMINDER_INTERVAL_MINUTES ?? 15);
  if (!minutes || minutes <= 0) {
    console.log(
      "[followup-reminders] scheduler disabled (set FOLLOWUP_REMINDER_INTERVAL_MINUTES>0 to enable)",
    );
    return;
  }

  const tick = () => {
    runFollowUpRemindersTick().catch((err) =>
      console.error("[followup-reminders] scheduler failed", err),
    );
  };

  console.log(
    `[followup-reminders] scheduler every ${minutes}m (sends from ${reminderSendHour()}:00 ${reminderTimeZone()})`,
  );
  setInterval(tick, minutes * 60_000).unref?.();
  setTimeout(tick, 30_000).unref?.();
}
