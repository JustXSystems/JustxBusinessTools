import fieldsSchema from "./fields-schema.json";
import type {
  InstallationType,
  SurveyCompanySnapshot,
  SurveyFieldDef,
  SurveyFlow,
  SurveyStepMeta,
} from "./types";

export const INSTALLATION_TYPES: InstallationType[] = [
  "Residential Rooftop",
  "Commercial Rooftop",
  "Industrial Rooftop",
  "Ground Mount",
];

export const COST_PER_KW: Record<string, number> = {
  "Commercial Rooftop": 48000,
  "Industrial Rooftop": 42000,
  "Ground Mount": 38000,
};

export const DEFAULT_COMPANY: SurveyCompanySnapshot = {
  name: "Your Company",
  logo: null,
  tagline: "Solar Site Survey",
  address: "",
  phone: "",
  email: "",
  website: "",
  reportPrefix: "ZSS",
};

export const SCHEMA_STEPS = fieldsSchema.steps as {
  residential: SurveyStepMeta[];
  epc: SurveyStepMeta[];
};

export const ALL_FIELDS = fieldsSchema.fields as SurveyFieldDef[];

export function flowForType(type: InstallationType): SurveyFlow {
  return type === "Residential Rooftop" ? "residential" : "epc";
}

export function stepsForFlow(flow: SurveyFlow): SurveyStepMeta[] {
  return flow === "residential" ? SCHEMA_STEPS.residential : SCHEMA_STEPS.epc;
}

/** Common fields appear on contact (res) / project (epc). */
export function fieldsForStep(
  flow: SurveyFlow,
  stepId: string,
  itype: InstallationType,
): SurveyFieldDef[] {
  const mappedCommonStep = flow === "residential" ? "contact" : "project";
  return ALL_FIELDS.filter((f) => {
    if (f.kind === "file") {
      const fileStep = flow === "residential" ? "photos" : "checklist";
      if (stepId !== fileStep) return false;
      if (f.flow === "residential" && flow !== "residential") return false;
      if (f.flow === "epc" && flow !== "epc") return false;
      if (f.itype && f.itype !== itype) return false;
      if (f.flow === "common") return false;
      return true;
    }
    if (f.flow === "common") {
      return stepId === mappedCommonStep;
    }
    if (f.flow !== flow) return false;
    if (f.itype && f.itype !== itype) return false;
    return f.stepId === stepId;
  });
}

export function groupBySection(fields: SurveyFieldDef[]): Array<{
  section: string;
  fields: SurveyFieldDef[];
}> {
  const order: string[] = [];
  const map = new Map<string, SurveyFieldDef[]>();
  for (const f of fields) {
    const sec = f.section || "Details";
    if (!map.has(sec)) {
      map.set(sec, []);
      order.push(sec);
    }
    map.get(sec)!.push(f);
  }
  return order.map((section) => ({ section, fields: map.get(section)! }));
}

export function cardTone(section: string): string {
  const s = section.toLowerCase();
  if (s.includes("safety") || s.includes("compliance")) return "red";
  if (s.includes("budget") || s.includes("commercial") || s.includes("currency")) return "green";
  if (s.includes("electrical") || s.includes("load")) return "green";
  if (s.includes("ownership") || s.includes("site") || s.includes("dimension")) return "amber";
  if (s.includes("module") || s.includes("technical") || s.includes("surveyor")) return "purple";
  return "blue";
}
