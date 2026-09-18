import { describe, expect, it } from "vitest";
import {
  buildSavedSurveyListRow,
  filterSavedSurveys,
  newSurveyDraft,
  surveyCityDisplay,
  surveyCompanyDisplay,
  surveyDescriptionSummary,
  surveySubmittedDateIso,
  EMPTY_SAVED_SURVEY_FILTERS,
} from "@/lib/site-survey-v1";

describe("site-survey-v1 saved list helpers", () => {
  it("reads city and company from values", () => {
    const s = newSurveyDraft();
    s.values.f_name = "Acme Solar";
    s.values.f_city = "Bengaluru";
    expect(surveyCompanyDisplay(s)).toBe("Acme Solar");
    expect(surveyCityDisplay(s)).toBe("Bengaluru");
  });

  it("builds description from capacity and system type", () => {
    const s = newSurveyDraft();
    s.estimate = {
      flow: "residential",
      type: "Residential Rooftop",
      systemKW: 5,
      genLabel: "5 kW",
      panels: 10,
      batteryKWh: 0,
      totalCost: 250000,
      costPerKW: 50000,
      monthlyGenUnits: 600,
      annualGenUnits: 7200,
    };
    s.values.systemtype = "On-Grid";
    expect(surveyDescriptionSummary(s)).toContain("5 kW");
    expect(surveyDescriptionSummary(s)).toContain("On-Grid");
  });

  it("reads submitted date from history", () => {
    const s = newSurveyDraft();
    expect(surveySubmittedDateIso(s)).toBe("");
    s.status = "submitted";
    s.values.f_date = "2026-03-01";
    expect(surveySubmittedDateIso(s)).toBe("2026-03-01");
    s.history = [{ ts: "2026-03-12T10:00:00.000Z", event: "Submitted" }];
    expect(surveySubmittedDateIso(s)).toBe("2026-03-12");
  });

  it("maps list row fields including follow-up", () => {
    const s = newSurveyDraft();
    s.reportNo = "ZSS-001";
    s.status = "saved";
    s.values.f_name = "Zigma";
    s.values.f_city = "Mysuru";
    s.values.f_date = "2026-02-01";
    s.values.f_followup = "2026-04-01";
    s.values.sv_name = "Ravi Kumar";
    s.estimate = {
      flow: "residential",
      type: "Residential Rooftop",
      systemKW: 3,
      genLabel: "3 kW",
      panels: 6,
      batteryKWh: 0,
      totalCost: 180000,
      costPerKW: 60000,
      monthlyGenUnits: 360,
      annualGenUnits: 4320,
    };
    const row = buildSavedSurveyListRow(s);
    expect(row.reportNo).toBe("ZSS-001");
    expect(row.companyName).toBe("Zigma");
    expect(row.city).toBe("Mysuru");
    expect(row.followUpDateRaw).toBe("2026-04-01");
    expect(row.estimatedCost).toBe(180000);
    expect(row.preparedBy).toBe("Ravi Kumar");
  });

  it("filters by status, city, query, follow-up, and cost", () => {
    const a = newSurveyDraft();
    a.id = "a";
    a.reportNo = "A-1";
    a.status = "submitted";
    a.installationType = "Residential Rooftop";
    a.values.f_name = "Zigma";
    a.values.f_city = "Mysuru";
    a.values.f_followup = "2020-01-01";
    a.values.sv_name = "Ravi";
    a.estimate = {
      flow: "residential",
      type: "Residential Rooftop",
      systemKW: 5,
      genLabel: "5 kW",
      panels: 10,
      batteryKWh: 0,
      totalCost: 200000,
      costPerKW: 40000,
      monthlyGenUnits: 500,
      annualGenUnits: 6000,
    };

    const b = newSurveyDraft();
    b.id = "b";
    b.reportNo = "B-1";
    b.status = "draft";
    b.installationType = "Ground Mount";
    b.values.f_name = "Acme";
    b.values.f_city = "Bengaluru";
    b.values.f_followup = "";
    b.values.sv_name = "Anita";
    b.estimate = {
      flow: "epc",
      type: "Ground Mount",
      systemKW: 100,
      genLabel: "100 kW",
      panels: 200,
      batteryKWh: 0,
      totalCost: 5000,
      costPerKW: 50,
      monthlyGenUnits: 12000,
      annualGenUnits: 144000,
    };

    const list = [a, b];
    expect(filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, statuses: ["submitted"] })).toEqual([a]);
    expect(filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, city: "Bengaluru" })).toEqual([b]);
    expect(filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, query: "ground" })).toEqual([b]);
    expect(
      filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, followUp: "overdue" }, "2026-01-01"),
    ).toEqual([a]);
    expect(filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, costMin: "100000" })).toEqual([a]);
    expect(filterSavedSurveys(list, { ...EMPTY_SAVED_SURVEY_FILTERS, preparedBy: "Anita" })).toEqual([b]);
  });
});
