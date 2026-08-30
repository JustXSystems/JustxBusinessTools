import { describe, expect, it } from "vitest";
import { buildNotificationsFromRecords } from "../notifications.js";
import { expandAudienceForActor, NOTIFICATION_EVENTS } from "../notification-events.js";

const today = "2026-03-15";

describe("hierarchy Admin → Owner → Staff", () => {
  it("staff actions always notify owner and never broadcast to staff role", () => {
    const roles = expandAudienceForActor(["owner", "staff"], "staff");
    expect(roles).toContain("owner");
    expect(roles).not.toContain("staff");
  });

  it("admin actions always reach owner and never broadcast to all staff", () => {
    const roles = expandAudienceForActor(["admin"], "admin");
    expect(roles).toEqual(expect.arrayContaining(["admin", "owner"]));
    expect(roles).not.toContain("staff");
  });

  it("owner receives staff major activity events", () => {
    expect(NOTIFICATION_EVENTS["activity.staff_completed"].audience).toEqual(["owner"]);
    expect(NOTIFICATION_EVENTS["activity.staff_major_event"].audience).toEqual(["owner"]);
  });

  it("business profile admin events reach owner", () => {
    for (const key of [
      "business.branch_approved",
      "business.branch_rejected",
      "business.branch_archived",
      "business.profile_updated",
      "admin.business_update",
    ] as const) {
      expect(NOTIFICATION_EVENTS[key].audience).toEqual(
        expect.arrayContaining(["owner"]),
      );
      expect(NOTIFICATION_EVENTS[key].audience).not.toContain("staff");
    }
  });

  it("UPI decide is admin+owner; staff only via personal target", () => {
    const catalog = NOTIFICATION_EVENTS["billing.upi_claim_decided"].audience;
    expect(catalog).toEqual(expect.arrayContaining(["admin", "owner"]));
    expect(catalog).not.toContain("staff");
    const asAdmin = expandAudienceForActor(catalog, "admin");
    expect(asAdmin).not.toContain("staff");
  });

  it("team role changes do not fan-out to all staff", () => {
    expect(NOTIFICATION_EVENTS["team.role_changed"].audience).not.toContain("staff");
  });

  it("workflow events are owner-scoped (staff get personal copies only)", () => {
    expect(NOTIFICATION_EVENTS["workflow.stage_changed"].audience).toEqual(["owner"]);
  });
});

describe("buildNotificationsFromRecords", () => {
  it("includes overdue AMC renewals", () => {
    const items = buildNotificationsFromRecords(
      [
        {
          id: "1",
          toolId: "amc",
          data: { client: "ABC Ltd", renewalDate: "2026-03-01" },
        },
      ],
      today,
    );
    expect(items.length).toBe(1);
    expect(items[0].urgent).toBe(true);
    expect(items[0].text).toContain("overdue");
    expect(items[0].eventType).toBe("billing.amc_renewal");
    expect(items[0].source).toBe("derived");
  });

  it("includes pending payments", () => {
    const items = buildNotificationsFromRecords(
      [
        {
          id: "p1",
          toolId: "paymenttracker",
          data: { kind: "Receivable", party: "Vendor", amount: 5000, status: "Pending", date: "2026-03-10" },
        },
      ],
      today,
    );
    expect(items.length).toBe(1);
    expect(items[0].icon).toBe("💰");
    expect(items[0].category).toBe("reminder");
  });

  it("skips completed service tasks", () => {
    const items = buildNotificationsFromRecords(
      [
        {
          id: "t1",
          toolId: "servicetasks",
          data: { title: "Done job", status: "Completed", dueDate: "2026-03-20" },
        },
      ],
      today,
    );
    expect(items.length).toBe(0);
  });

  it("flags installation revisit as urgent", () => {
    const items = buildNotificationsFromRecords(
      [
        {
          id: "i1",
          toolId: "installations",
          data: { site: "Roof A", status: "Needs Revisit" },
        },
      ],
      today,
    );
    expect(items.length).toBe(1);
    expect(items[0].urgent).toBe(true);
    expect(items[0].eventType).toBe("workflow.revisit_needed");
  });

  it("includes delayed purchase orders", () => {
    const items = buildNotificationsFromRecords(
      [
        {
          id: "po1",
          toolId: "purchaseorders",
          data: { vendor: "Solar Co", status: "Delayed", expectedDate: "2026-03-01" },
        },
      ],
      today,
    );
    expect(items.length).toBe(1);
    expect(items[0].eventType).toBe("workflow.po_delayed");
  });
});
