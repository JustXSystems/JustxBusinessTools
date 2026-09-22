import { describe, expect, it } from "vitest";
import { buildSurveyActivityTimeline, filterSurveyActivity } from "../history-activity";
import type { SiteSurveyV1, SurveyHistoryRow } from "../types";

describe("buildSurveyActivityTimeline", () => {
  const history: SurveyHistoryRow[] = [
    {
      id: "2",
      surveyId: "s1",
      reportNo: "ZSS-1",
      customerName: "Acme",
      installationType: "Residential Rooftop",
      status: "submitted",
      estimatedCost: 120000,
      savedAt: "2026-03-15T10:00:00.000Z",
      action: "status:submitted",
    },
    {
      id: "1",
      surveyId: "s1",
      reportNo: "ZSS-1",
      customerName: "Acme",
      installationType: "Residential Rooftop",
      status: "saved",
      estimatedCost: 100000,
      savedAt: "2026-03-14T10:00:00.000Z",
      action: "create",
    },
  ];

  it("labels actions and cost deltas", () => {
    const rows = buildSurveyActivityTimeline(history, [{ id: "s1" } as SiteSurveyV1]);
    expect(rows[0].actionLabel).toBe("Submitted");
    expect(rows[0].amountDelta).toBe(20000);
    expect(rows[0].surveyExists).toBe(true);
    expect(rows[0].isLatestForSurvey).toBe(true);
    expect(rows[1].actionLabel).toBe("Created");
  });

  it("filters by search query", () => {
    const rows = buildSurveyActivityTimeline(history, []);
    expect(filterSurveyActivity(rows, "acme")).toHaveLength(2);
    expect(filterSurveyActivity(rows, "nope")).toHaveLength(0);
  });
});
