import { describe, expect, it } from "vitest";
import { canHandOff, HANDOFF, isBosLive } from "./handoff";

describe("isBosLive", () => {
  it("needs a Live bos catalog row", () => {
    expect(isBosLive(undefined)).toBe(false);
    expect(isBosLive([])).toBe(false);
    expect(isBosLive([{ id: "bos", available: false }])).toBe(false);
    expect(isBosLive([{ id: "bosdesign", available: true }])).toBe(false);
    expect(isBosLive([{ id: "bos", available: true }])).toBe(true);
  });
});

describe("canHandOff", () => {
  it("accepts saved, submitted, sent and approved records only", () => {
    for (const s of ["saved", "submitted", "sent", "approved"]) expect(canHandOff(s)).toBe(true);
    for (const s of ["draft", "rejected", "", null, undefined]) expect(canHandOff(s)).toBe(false);
  });
});

describe("HANDOFF", () => {
  it("maps each tool to its admin switch, BOS target and deep link", () => {
    expect(HANDOFF.quotationv1).toMatchObject({ switchKey: "bos.handoff.quotationv1", target: "invoice" });
    expect(HANDOFF.sitesurveyv1).toMatchObject({ switchKey: "bos.handoff.sitesurveyv1", target: "project" });
    expect(HANDOFF.quotationv1.openHref("inv 1")).toBe("/tools/bos?ws=finance&m=invoices&open=inv%201");
    expect(HANDOFF.sitesurveyv1.openHref("pr1")).toBe("/tools/bos?ws=projects&m=board&open=pr1");
  });
});
