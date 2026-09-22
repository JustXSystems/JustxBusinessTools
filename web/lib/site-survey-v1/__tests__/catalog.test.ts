import { describe, expect, it } from "vitest";
import { newSurveyDraft } from "../draft";
import { stepsForFlow, flowForType, wizardStateWhenOpeningSurvey } from "../catalog";

describe("wizardStateWhenOpeningSurvey", () => {
  it("opens draft/saved at step 0 without success panel", () => {
    const draft = newSurveyDraft();
    expect(wizardStateWhenOpeningSurvey({ ...draft, status: "saved" })).toEqual({
      stepIndex: 0,
      showSuccess: false,
    });
  });

  it("opens submitted on report step with success panel", () => {
    const draft = newSurveyDraft();
    const submitted = { ...draft, status: "submitted" as const };
    const steps = stepsForFlow(flowForType(submitted.installationType));
    const reportIdx = steps.findIndex((s) => s.id === "report");
    expect(wizardStateWhenOpeningSurvey(submitted)).toEqual({
      stepIndex: reportIdx >= 0 ? reportIdx : steps.length - 1,
      showSuccess: true,
    });
  });
});
