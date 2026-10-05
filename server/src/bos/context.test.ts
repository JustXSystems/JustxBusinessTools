import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BosError } from "./host.js";
import { parsePatch } from "./context.js";

describe("parsePatch", () => {
  const Project = z.object({
    name: z.string().min(1),
    status: z.enum(["lead", "active"]).default("lead"),
    valueEstimate: z.coerce.number().default(0),
    notes: z.string().nullable().optional(),
  });

  it("keeps only the fields that were sent, so defaults don't overwrite stored values", () => {
    expect(parsePatch(Project, { status: "active" })).toEqual({ status: "active" });
    expect(parsePatch(Project, {})).toEqual({});
  });

  it("still validates, coerces and passes explicit nulls", () => {
    expect(parsePatch(Project, { valueEstimate: "1200", notes: null })).toEqual({ valueEstimate: 1200, notes: null });
    expect(() => parsePatch(Project, { status: "won" })).toThrow(BosError);
  });
});
