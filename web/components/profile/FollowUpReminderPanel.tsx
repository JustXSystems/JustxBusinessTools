"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { flashAppError, flashAppOk } from "@/lib/app-flash";
import {
  DEFAULT_FOLLOW_UP_REMINDER_MESSAGE,
  DEFAULT_FOLLOW_UP_REMINDER_SUBJECT,
  FOLLOW_UP_REMINDER_PLACEHOLDERS,
  type BusinessProfileSendSettings,
} from "@/lib/types/business-profile";

type Reminder = BusinessProfileSendSettings["followUpReminder"];

type RunResult = {
  date: string;
  due: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
};

type Props = {
  canEdit: boolean;
  value: Reminder;
  emailWebhookUrl: string | null;
  onChange: (next: Reminder) => void;
};

export function FollowUpReminderPanel({ canEdit, value, emailWebhookUrl, onChange }: Props) {
  const [running, setRunning] = useState(false);

  function patch(partial: Partial<Reminder>) {
    if (!canEdit) return;
    onChange({ ...value, ...partial });
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await api<RunResult>("/quotation-v1/follow-up-reminders/run-now", {
        method: "POST",
        body: JSON.stringify({}),
      });
      flashAppOk(
        `Follow-ups for ${r.date}: ${r.due} due · ${r.sent} sent · ${r.queued} queued in Email Outbox · ${r.failed} failed · ${r.skipped} skipped (already sent today or no recipient).`,
      );
    } catch (err) {
      flashAppError(err instanceof Error ? err.message : "Could not run follow-up reminders");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="profile-stack">
      <div className="profile-callout">
        <p>
          Every day, quotations whose <strong>Follow-up date</strong> is today get an automated
          reminder email to the <strong>Prepared By</strong> person (matched to their team login
          email). Approved and rejected quotations are skipped. Each quotation is reminded at most
          once per day.
        </p>
      </div>

      <label className="field toggle-row toggle-inline">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={!canEdit}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span>
          <strong>Enable follow-up email auto trigger</strong>
        </span>
      </label>

      <label className="field toggle-row toggle-inline">
        <input
          type="checkbox"
          checked={value.ccOwners}
          disabled={!canEdit}
          onChange={(e) => patch({ ccOwners: e.target.checked })}
        />
        <span className="toggle-hint">CC all Owner-role users of this business</span>
      </label>

      <label className="field">
        <span className="label">Additional CC</span>
        <input
          value={value.cc}
          disabled={!canEdit}
          placeholder="manager@company.com, sales@company.com"
          onChange={(e) => patch({ cc: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="label">Subject template</span>
        <input
          value={value.subject}
          disabled={!canEdit}
          placeholder={DEFAULT_FOLLOW_UP_REMINDER_SUBJECT}
          onChange={(e) => patch({ subject: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="label">Email template</span>
        <textarea
          rows={14}
          className="mono"
          value={value.message}
          disabled={!canEdit}
          onChange={(e) => patch({ message: e.target.value })}
        />
      </label>

      {canEdit ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            patch({
              subject: DEFAULT_FOLLOW_UP_REMINDER_SUBJECT,
              message: DEFAULT_FOLLOW_UP_REMINDER_MESSAGE,
            })
          }
        >
          Reset subject &amp; template to default
        </button>
      ) : null}

      <p className="section-note">
        Placeholders:{" "}
        {FOLLOW_UP_REMINDER_PLACEHOLDERS.map((p, i) => (
          <span key={p.key} title={p.description}>
            <code>{`{{${p.key}}}`}</code>
            {i < FOLLOW_UP_REMINDER_PLACEHOLDERS.length - 1 ? " " : ""}
          </span>
        ))}
      </p>

      <p className="section-note">
        Delivery uses the <strong>Email webhook URL</strong> above
        {emailWebhookUrl ? "" : " (not set on this profile — falls back to Admin → Integrations)"}.
        Without any webhook, reminders are queued in <Link href="/email-outbox">Email Outbox</Link>{" "}
        for manual send.
      </p>

      {canEdit ? (
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={running || !value.enabled}
            onClick={() => void runNow()}
          >
            {running ? "Sending…" : "Send today's reminders now"}
          </button>
          <p className="section-note">
            Uses the <strong>saved</strong> settings — click Save first after changes.
          </p>
        </div>
      ) : null}
    </div>
  );
}
