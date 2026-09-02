import { describe, expect, it } from "vitest";
import {
  categorizeAuditAction,
  describeAuditEvent,
  labelForAuditAction,
  severityForAuditAction,
} from "../audit-catalog.js";

describe("audit catalog", () => {
  it("categorizes known action families", () => {
    expect(categorizeAuditAction("auth.login")).toBe("auth");
    expect(categorizeAuditAction("team.approve")).toBe("team");
    expect(categorizeAuditAction("sku.upsert")).toBe("billing");
    expect(categorizeAuditAction("quotationv1.create")).toBe("documents");
    expect(categorizeAuditAction("profile.drive_connect")).toBe("profile");
  });

  it("assigns severities for security-sensitive actions", () => {
    expect(severityForAuditAction("auth.mfa_disable")).toBe("critical");
    expect(severityForAuditAction("team.suspend")).toBe("critical");
    expect(severityForAuditAction("auth.login")).toBe("low");
  });

  it("builds human summaries", () => {
    expect(labelForAuditAction("team.approve")).toBe("Approved team member");
    const summary = describeAuditEvent({
      action: "team.approve",
      actorName: "Priya",
      entityType: "user",
      entityId: "42",
    });
    expect(summary).toContain("Priya");
    expect(summary).toContain("#42");
  });
});
