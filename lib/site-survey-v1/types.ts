export type InstallationType =
  | "Residential Rooftop"
  | "Commercial Rooftop"
  | "Industrial Rooftop"
  | "Ground Mount";

export type SurveyFlow = "residential" | "epc";

export type SurveyStatus = "draft" | "saved" | "submitted";

export type SurveyFieldKind =
  | "text"
  | "number"
  | "email"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file";

export type SurveyFieldOption = { value: string; label: string };

export type SurveyFieldDef = {
  key: string;
  kind: SurveyFieldKind;
  label: string;
  section: string;
  required: boolean;
  flow: "common" | SurveyFlow;
  itype: InstallationType | null;
  options: SurveyFieldOption[];
  placeholder?: string | null;
  stepId: string;
  card?: string;
};

export type SurveyStepMeta = {
  id: string;
  label: string;
  icon: string;
};

export type Appliance = {
  id: string;
  name: string;
  icon: string;
  qty: number;
  watt: number;
  hours: number;
  on: boolean;
  custom?: boolean;
};

export type SurveyPhoto = {
  name: string;
  mime: string;
  dataUrl: string | null;
};

export type LoadSummary = {
  connLoad: number;
  dailyUnits: number;
  monthlyUnits: number;
};

export type SurveyEstimate = {
  flow: SurveyFlow;
  type: InstallationType;
  systemKW: number;
  genLabel: string;
  panels: number;
  roofSqft?: number;
  areaLabel?: string;
  batteryKWh: number;
  totalCost: number;
  costPerKW: number;
  monthlyGenUnits: number;
  annualGenUnits: number;
  loadReduction?: number;
  monthlySavings?: number;
  sysType?: string;
};

export type SurveyCompanySnapshot = {
  name: string;
  logo: string | null;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  reportPrefix: string;
};

export type HistoryEvent = { ts: string; event: string };

/** Scalar / multi values keyed by field id or radio/checkbox name. */
export type SurveyValues = Record<string, string | string[]>;

export type SiteSurveyV1 = {
  id: string;
  status: SurveyStatus;
  reportNo: string | null;
  installationType: InstallationType;
  values: SurveyValues;
  appliances: Appliance[];
  photos: Record<string, SurveyPhoto[]>;
  estimate: SurveyEstimate | null;
  createdAt: string;
  updatedAt?: string;
  history: HistoryEvent[];
  companySnapshot?: SurveyCompanySnapshot;
};

export type SurveyHistoryRow = {
  id: string;
  surveyId: string;
  reportNo: string | null;
  customerName: string;
  installationType: string;
  status: string;
  estimatedCost: number;
  savedAt: string;
};

export type SurveyNotification = {
  id: string;
  surveyId: string;
  message: string;
  read: boolean;
  createdAt: string;
};
