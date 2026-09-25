import { describe, expect, it } from "vitest";
import {
  buildReminderRecipients,
  fillReminderTemplate,
  localDateParts,
  matchPreparedByEmail,
  parseEmailList,
  reminderTextToHtml,
} from "../quotation-followup-reminders.js";
import { normalizeProfileSendSettings } from "../profile-send-settings.js";

const members = [
  { email: "ravi.kumar@acme.in", name: "Ravi Kumar" },
  { email: "anita@acme.in", name: null },
  { email: "owner@acme.in", name: "Owner" },
];

describe("follow-up reminder helpers", () => {
  it("parses and dedupes email lists", () => {
    expect(parseEmailList("a@x.com, B@x.com; a@X.com  bad  c@y.in")).toEqual([
      "a@x.com",
      "B@x.com",
      "c@y.in",
    ]);
    expect(parseEmailList("")).toEqual([]);
  });

  it("matches Prepared By by name, email local part, or literal email", () => {
    expect(matchPreparedByEmail("ravi kumar", members)).toBe("ravi.kumar@acme.in");
    expect(matchPreparedByEmail("Anita", members)).toBe("anita@acme.in");
    expect(matchPreparedByEmail("someone@else.com", members)).toBe("someone@else.com");
    expect(matchPreparedByEmail("Unknown", members)).toBeNull();
    expect(matchPreparedByEmail("  ", members)).toBeNull();
  });

  it("puts creator in To and owners + extra CC in CC without duplicating To", () => {
    expect(
      buildReminderRecipients({
        creatorEmail: "owner@acme.in",
        ownerEmails: ["owner@acme.in", "boss@acme.in"],
        settings: { ccOwners: true, cc: "mgr@acme.in" },
      }),
    ).toEqual({ to: ["owner@acme.in"], cc: ["boss@acme.in", "mgr@acme.in"] });

    expect(
      buildReminderRecipients({
        creatorEmail: "ravi.kumar@acme.in",
        ownerEmails: ["boss@acme.in"],
        settings: { ccOwners: false, cc: "" },
      }),
    ).toEqual({ to: ["ravi.kumar@acme.in"], cc: [] });
  });

  it("falls back to CC list as To when creator email is unknown", () => {
    expect(
      buildReminderRecipients({
        creatorEmail: null,
        ownerEmails: ["boss@acme.in"],
        settings: { ccOwners: true, cc: "mgr@acme.in" },
      }),
    ).toEqual({ to: ["boss@acme.in", "mgr@acme.in"], cc: [] });
  });

  it("computes local date and hour in IST", () => {
    // 2026-09-25 20:00 UTC = 2026-09-26 01:30 IST
    expect(localDateParts(new Date("2026-09-25T20:00:00Z"), "Asia/Kolkata")).toEqual({
      date: "2026-09-26",
      hour: 1,
    });
  });

  it("fills templates and renders escaped HTML with links", () => {
    expect(fillReminderTemplate("Hi {{ preparedBy }} — {{missing}}!", { preparedBy: "Ravi" })).toBe(
      "Hi Ravi — !",
    );
    const html = reminderTextToHtml("A <b>\nhttps://x.com/tools");
    expect(html).toContain("A &lt;b&gt;<br>");
    expect(html).toContain('<a href="https://x.com/tools">https://x.com/tools</a>');
  });

  it("defaults follow-up reminder to disabled with owners CC'd", () => {
    const s = normalizeProfileSendSettings(null).followUpReminder;
    expect(s.enabled).toBe(false);
    expect(s.ccOwners).toBe(true);
    expect(s.subject).toContain("{{quoteNo}}");
    const on = normalizeProfileSendSettings({
      followUpReminder: { enabled: true, ccOwners: false, cc: " a@b.co ", subject: "", message: "" },
    }).followUpReminder;
    expect(on).toMatchObject({ enabled: true, ccOwners: false, cc: "a@b.co" });
    expect(on.message).toContain("{{preparedBy}}");
  });
});
