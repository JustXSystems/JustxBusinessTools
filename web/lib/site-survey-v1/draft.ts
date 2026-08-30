import { seedAppliances } from "./appliances";
import { ALL_FIELDS, DEFAULT_COMPANY, fieldsForStep, flowForType, stepsForFlow } from "./catalog";
import { todayISO, uid, val, withFreshEstimate } from "./compute";
import type {
  InstallationType,
  SiteSurveyV1,
  SurveyCompanySnapshot,
  SurveyFieldDef,
  SurveyValues,
} from "./types";

export function blankValues(): SurveyValues {
  const values: SurveyValues = {
    solartype: "Residential Rooftop",
    starttime: "",
    systemtype: "",
    moduletype: [],
    ownership: "",
    rooftype: "",
    amc: "",
    othersites: "",
    f_date: todayISO(),
    sv_date: todayISO(),
    sv2_date: todayISO(),
    f_areaunit: "sq.ft",
  };
  return values;
}

export function newSurveyDraft(surveyorName = ""): SiteSurveyV1 {
  const values = blankValues();
  if (surveyorName) {
    values.sv_name = surveyorName;
    values.sv2_name = surveyorName;
  }
  const draft: SiteSurveyV1 = {
    id: uid(),
    status: "draft",
    reportNo: null,
    installationType: "Residential Rooftop",
    values,
    appliances: seedAppliances(uid),
    photos: {},
    estimate: null,
    createdAt: new Date().toISOString(),
    history: [{ ts: new Date().toISOString(), event: "Draft created" }],
  };
  return withFreshEstimate(draft);
}

export function setInstallationType(survey: SiteSurveyV1, type: InstallationType): SiteSurveyV1 {
  return withFreshEstimate({
    ...survey,
    installationType: type,
    values: { ...survey.values, solartype: type },
  });
}

export function setValue(
  survey: SiteSurveyV1,
  key: string,
  value: string | string[],
): SiteSurveyV1 {
  const next = {
    ...survey,
    values: { ...survey.values, [key]: value },
  };
  if (key === "solartype" && typeof value === "string") {
    next.installationType = value as InstallationType;
  }
  return withFreshEstimate(next);
}

export function getMissingForStep(survey: SiteSurveyV1, stepId: string): string[] {
  const flow = flowForType(survey.installationType);
  const fields = fieldsForStep(flow, stepId, survey.installationType).filter(
    (f) => f.required && f.kind !== "file",
  );
  const missing: string[] = [];
  for (const f of fields) {
    const v = survey.values[f.key];
    if (Array.isArray(v)) {
      if (!v.length) missing.push(f.label);
    } else if (!String(v ?? "").trim()) {
      missing.push(f.label);
    }
  }
  return missing;
}

export function getMissingRequiredFields(survey: SiteSurveyV1): string[] {
  const missing: string[] = [];
  if (!val(survey.values, "f_name").trim()) missing.push("Customer / Company Name");
  if (!val(survey.values, "f_phone").trim()) missing.push("Phone Number");
  if (!val(survey.values, "f_address").trim()) missing.push("Site Address");
  if (!val(survey.values, "f_city").trim()) missing.push("City");
  if (!val(survey.values, "f_date").trim()) missing.push("Survey Date");
  if (!survey.installationType) missing.push("Installation Type");
  return missing;
}

export function snapshotOf(s: SiteSurveyV1): string {
  const { updatedAt: _u, history: _h, companySnapshot: _c, estimate: _e, ...rest } = s;
  return JSON.stringify(rest);
}

export function mergeCompanyFromBusinessProfile(
  stored: SurveyCompanySnapshot,
  profile: {
    businessName?: string | null;
    logo?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null,
): SurveyCompanySnapshot {
  if (!profile) return { ...DEFAULT_COMPANY, ...stored };
  const address = [profile.addressLine1, profile.addressLine2]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const name = String(profile.businessName ?? "").trim();
  // Business Profile logo always wins when set (same as Quotation V1).
  const logo = String(profile.logo ?? "").trim() || stored.logo || null;
  const prefixFromName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return {
    ...DEFAULT_COMPANY,
    ...stored,
    // Business Profile is source of truth for letterhead on survey PDFs.
    name: name || stored.name || DEFAULT_COMPANY.name,
    logo: logo || null,
    address: address || stored.address?.trim() || stored.address,
    phone: String(profile.phone ?? "").trim() || stored.phone,
    email: String(profile.email ?? "").trim() || stored.email,
    website: String(profile.website ?? "").trim() || stored.website,
    reportPrefix:
      stored.reportPrefix && stored.reportPrefix !== "ZSS"
        ? stored.reportPrefix
        : prefixFromName || stored.reportPrefix || "ZSS",
  };
}

export function requiredFieldsForCurrentStep(
  survey: SiteSurveyV1,
  stepIndex: number,
): SurveyFieldDef[] {
  const flow = flowForType(survey.installationType);
  const steps = stepsForFlow(flow);
  const step = steps[stepIndex];
  if (!step || step.id === "report" || step.id === "load") return [];
  return fieldsForStep(flow, step.id, survey.installationType).filter((f) => f.required);
}

export { ALL_FIELDS };
