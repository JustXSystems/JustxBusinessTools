import { describe, expect, it } from "vitest";
import { mergeTrackerConfig } from "../merge-tool-config";
import type { TrackerConfig } from "@/config/tools.config";

const base: TrackerConfig = {
  key: "paymenttracker",
  title: "Payment Tracker",
  icon: "💰",
  subtitle: "Test",
  addLabel: "+ Add",
  fields: [{ key: "party", label: "Party", type: "text", required: true }],
  titleField: "party",
  subtitleFields: ["ref"],
  metaFields: [],
  statusField: "status",
};

describe("mergeTrackerConfig", () => {
  it("returns base when no override", () => {
    expect(mergeTrackerConfig(base, undefined)).toEqual(base);
  });

  it("merges admin fields over base", () => {
    const merged = mergeTrackerConfig(base, {
      id: "paymenttracker",
      toolType: "tracker",
      definition: {
        type: "tracker",
        fields: [{ key: "party", label: "Customer", type: "text", required: true }],
      },
    });
    expect(merged?.fields[0].label).toBe("Customer");
    expect(merged?.title).toBe("Payment Tracker");
  });
});
