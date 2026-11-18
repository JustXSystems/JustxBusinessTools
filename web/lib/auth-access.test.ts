import { describe, expect, it } from "vitest";
import {
  areaAccessLevel,
  canAccessAdmin,
  canAccessPath,
  canEditBusinessProfile,
  canManageBusinessTeam,
  canUseEmailOutbox,
  canUseSyncCenter,
  effectiveOrgRole,
  isEnterableBranch,
  isEnterPath,
  isOperatorAppPath,
  isPublicHomePreview,
  pathWithSearch,
  platformNeedsOperatorEnter,
  safeAppPath,
} from "@/lib/auth-access";
import { mobileNavForUser, operatorNavForUser } from "@/config/navigation.config";
import type { SessionUser } from "@/lib/types/auth";

function user(partial: Partial<SessionUser>): SessionUser {
  return {
    id: 1,
    email: "a@b.c",
    name: "A",
    role: "owner",
    organizationId: 1,
    organizationName: "Org",
    businessProfileId: 1,
    branches: [],
    ...partial,
  };
}

describe("BAU org roles (live clients)", () => {
  it("owner keeps Business Profile, Sync, Team, and no Admin Console", () => {
    const u = user({ role: "owner", isPlatformAdmin: false });
    expect(canAccessAdmin(u)).toBe(false);
    expect(canAccessPath(u, "/admin")).toBe(false);
    expect(canAccessPath(u, "/")).toBe(true);
    expect(canAccessPath(u, "/profile")).toBe(true);
    expect(canAccessPath(u, "/sync")).toBe(true);
    expect(canEditBusinessProfile(u)).toBe(true);
    expect(canManageBusinessTeam(u)).toBe(true);
    expect(canUseSyncCenter(u)).toBe(true);
    expect(operatorNavForUser(u).workspace.map((i) => i.href)).toEqual(
      expect.arrayContaining(["/", "/profile", "/sync", "/email-outbox", "/notifications"]),
    );
  });

  it("org admin matches owner operator access and cannot open /admin", () => {
    const u = user({ role: "admin", isPlatformAdmin: false });
    expect(canAccessAdmin(u)).toBe(false);
    expect(canAccessPath(u, "/admin")).toBe(false);
    expect(canAccessPath(u, "/profile")).toBe(true);
    expect(canManageBusinessTeam(u)).toBe(true);
    expect(canUseSyncCenter(u)).toBe(true);
    expect(canUseEmailOutbox(u)).toBe(true);
  });

  it("staff keeps tools + outbox, loses Sync Center write areas", () => {
    const u = user({ role: "staff", isPlatformAdmin: false });
    expect(canAccessAdmin(u)).toBe(false);
    expect(canAccessPath(u, "/subscription")).toBe(true);
    expect(canAccessPath(u, "/email-outbox")).toBe(true);
    expect(canAccessPath(u, "/profile")).toBe(true);
    expect(canEditBusinessProfile(u)).toBe(false);
    expect(canManageBusinessTeam(u)).toBe(false);
    expect(canUseSyncCenter(u)).toBe(false);
    expect(operatorNavForUser(u).workspace.map((i) => i.href)).not.toContain("/sync");
  });

  it("viewer keeps Home + My Tools only", () => {
    const u = user({ role: "viewer", isPlatformAdmin: false });
    expect(canAccessPath(u, "/")).toBe(true);
    expect(canAccessPath(u, "/subscription")).toBe(true);
    expect(canAccessPath(u, "/profile")).toBe(false);
    expect(canAccessPath(u, "/email-outbox")).toBe(false);
    expect(canAccessPath(u, "/notifications")).toBe(false);
    expect(canManageBusinessTeam(u)).toBe(false);
    const hrefs = operatorNavForUser(u).workspace.map((i) => i.href);
    expect(hrefs).toEqual(["/"]);
    expect(mobileNavForUser(u).some((i) => i.href === "/subscription")).toBe(true);
  });

  it("ignores stale actAsRole on non-platform sessions", () => {
    const u = user({
      role: "owner",
      isPlatformAdmin: false,
      actAsRole: "viewer",
    });
    expect(effectiveOrgRole(u)).toBe("owner");
    expect(canManageBusinessTeam(u)).toBe(true);
    expect(areaAccessLevel(u, "syncCenter")).toBe("write");
  });
});

describe("platform act-as", () => {
  it("keeps Admin Console for platform even while acting as viewer", () => {
    const u = user({ isPlatformAdmin: true, actAsRole: "viewer", role: "viewer" });
    expect(canAccessAdmin(u)).toBe(true);
    expect(areaAccessLevel(u, "adminConsole")).toBe("write");
    expect(canAccessPath(u, "/admin")).toBe(true);
  });

  it("limits operator menus to act-as role", () => {
    const u = user({ isPlatformAdmin: true, actAsRole: "viewer", role: "viewer" });
    expect(effectiveOrgRole(u)).toBe("viewer");
    expect(areaAccessLevel(u, "businessProfile")).toBe("none");
    expect(areaAccessLevel(u, "syncCenter")).toBe("none");
    expect(areaAccessLevel(u, "myTools")).toBe("write");
    expect(canManageBusinessTeam(u)).toBe(false);
  });

  it("denies Operator areas when act-as is cleared (must re-enter)", () => {
    const u = user({ isPlatformAdmin: true, actAsRole: null, role: "owner" });
    expect(areaAccessLevel(u, "syncCenter")).toBe("none");
    expect(areaAccessLevel(u, "adminConsole")).toBe("write");
    expect(canManageBusinessTeam(u)).toBe(false);
    expect(canAccessAdmin(u)).toBe(true);
  });

  it("gates Operator paths through /enter until act-as is set", () => {
    const bare = user({ isPlatformAdmin: true, actAsRole: null, role: "owner" });
    const acting = user({ isPlatformAdmin: true, actAsRole: "staff", role: "staff" });
    const org = user({ isPlatformAdmin: false, role: "owner" });
    const preview = new URLSearchParams("preview=public");

    expect(isEnterPath("/enter")).toBe(true);
    expect(isOperatorAppPath("/")).toBe(true);
    expect(isOperatorAppPath("/profile")).toBe(true);
    expect(isOperatorAppPath("/admin")).toBe(false);
    expect(isOperatorAppPath("/enter")).toBe(false);
    expect(isOperatorAppPath("/bos")).toBe(true);
    expect(isOperatorAppPath("/ims")).toBe(true);
    expect(isOperatorAppPath("/ims/inventory")).toBe(true);

    expect(platformNeedsOperatorEnter(bare, "/")).toBe(true);
    expect(platformNeedsOperatorEnter(bare, "/profile")).toBe(true);
    expect(platformNeedsOperatorEnter(bare, "/bos")).toBe(true);
    expect(platformNeedsOperatorEnter(bare, "/ims")).toBe(true);
    expect(platformNeedsOperatorEnter(bare, "/admin")).toBe(false);
    expect(platformNeedsOperatorEnter(bare, "/enter")).toBe(false);
    expect(isPublicHomePreview("/", preview)).toBe(true);
    expect(platformNeedsOperatorEnter(bare, "/", preview)).toBe(false);
    expect(platformNeedsOperatorEnter(acting, "/")).toBe(false);
    expect(platformNeedsOperatorEnter(acting, "/bos")).toBe(false);
    expect(platformNeedsOperatorEnter(org, "/")).toBe(false);
    expect(platformNeedsOperatorEnter(org, "/bos")).toBe(false);
    expect(canAccessPath(bare, "/enter")).toBe(true);
  });

  it("preserves query string for next= redirects", () => {
    expect(pathWithSearch("/tools/foo", new URLSearchParams("tab=bar"))).toBe(
      "/tools/foo?tab=bar",
    );
    expect(pathWithSearch("/", null)).toBe("/");
    expect(pathWithSearch("", new URLSearchParams())).toBe("/");
  });

  it("rejects open-redirect next= values", () => {
    expect(safeAppPath("//evil.example")).toBe("/");
    expect(safeAppPath("/\\evil.example")).toBe("/");
    expect(safeAppPath("https://evil.example")).toBe("/");
    expect(safeAppPath("/login")).toBe("/");
    expect(safeAppPath("/profile?tab=team")).toBe("/profile?tab=team");
    expect(safeAppPath("/bos", { fallback: "" })).toBe("/bos");
    expect(safeAppPath("//x", { fallback: "" })).toBe("");
  });

  it("classifies enterable branches by approval and archive", () => {
    expect(isEnterableBranch({ approvalStatus: "approved" })).toBe(true);
    expect(isEnterableBranch({})).toBe(true);
    expect(isEnterableBranch({ approvalStatus: "pending" })).toBe(false);
    expect(isEnterableBranch({ approvalStatus: "approved", archivedAt: "2026-01-01" })).toBe(
      false,
    );
    expect(isEnterableBranch({ approvalStatus: "rejected" })).toBe(false);
  });
});
