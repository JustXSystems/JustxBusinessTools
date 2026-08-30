import { computeLoadSummary } from "./appliances";
import { COST_PER_KW, flowForType } from "./catalog";
import type {
  InstallationType,
  LoadSummary,
  SiteSurveyV1,
  SurveyEstimate,
  SurveyValues,
} from "./types";

export function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function val(values: SurveyValues, key: string): string {
  const v = values[key];
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

export function numVal(values: SurveyValues, key: string): number {
  const n = parseFloat(String(val(values, key)).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function fmtRs(raw: number | string | null | undefined): string {
  const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  if (raw === "" || raw == null || Number.isNaN(num)) return "—";
  // Use "Rs." — jsPDF Helvetica cannot encode ₹ (U+20B9), which renders as garbage (e.g. ¹).
  return `Rs. ${Math.round(num).toLocaleString("en-IN")}`;
}

export function pad5(n: number): string {
  return String(n).padStart(5, "0");
}

export function currentYYMM(d = new Date()): string {
  return `${String(d.getFullYear()).slice(-2)}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Preview id before server assigns the real sequence. */
export function previewReportId(prefix: string, seq = 1): string {
  const p = (prefix || "ZSS").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "ZSS";
  return `${p}-ID-${currentYYMM()}:${pad5(seq)}`;
}

export function capacityKey(type: InstallationType): string {
  if (type === "Commercial Rooftop") return "c_capacity";
  if (type === "Industrial Rooftop") return "i_capacity";
  if (type === "Ground Mount") return "g_capacity";
  return "f_modulesize";
}

export function calcEstimate(
  installationType: InstallationType,
  values: SurveyValues,
  load: LoadSummary,
): SurveyEstimate {
  const flow = flowForType(installationType);
  const sunHours = 4.6;
  const pr = 0.78;
  const panelWatt = 550;
  const rate = 8;

  if (flow === "residential") {
    const billVal = numVal(values, "f_bill");
    let systemKW = 0;
    const sizeTxt = val(values, "f_modulesize");
    const parsed = parseFloat(sizeTxt.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) systemKW = parsed;
    else if (billVal > 0) systemKW = Math.max(1, Math.round((billVal / rate / 30 / sunHours / pr) * 10) / 10);
    else if (load.dailyUnits > 0) systemKW = Math.max(1, Math.round((load.dailyUnits / sunHours / pr) * 10) / 10);
    else systemKW = 3;

    const panels = Math.max(2, Math.ceil((systemKW * 1000) / panelWatt));
    const roofSqft = Math.round(panels * 2.1 * 10.764);
    const costPerKW = 55000;
    const sysType = val(values, "systemtype") || "On-Grid";
    const batteryKWh = sysType === "On-Grid" ? 0 : Math.max(5, Math.round(systemKW * 2));
    const batteryCost = batteryKWh * 22000;
    const inverterCost = (sysType === "Off-Grid" ? 6000 : 4000) * systemKW;
    const totalCost = Math.round(systemKW * costPerKW + batteryCost + inverterCost);
    const annualGenUnits = Math.round(systemKW * sunHours * 365 * pr);
    const monthlyGenUnits = Math.round(annualGenUnits / 12);
    const genLabel = systemKW >= 1000 ? `${(systemKW / 1000).toFixed(2)} MW` : `${systemKW} kW`;
    const monthlyConsumption =
      load.monthlyUnits > 0 ? load.monthlyUnits : billVal > 0 ? billVal / rate : load.dailyUnits * 30;
    const loadReduction =
      monthlyConsumption > 0
        ? Math.min(100, Math.round((monthlyGenUnits / monthlyConsumption) * 100))
        : 0;
    const monthlySavings = Math.round(Math.min(monthlyGenUnits, monthlyConsumption) * rate);

    return {
      flow,
      type: installationType,
      systemKW,
      genLabel,
      panels,
      roofSqft,
      batteryKWh,
      totalCost,
      costPerKW,
      monthlyGenUnits,
      annualGenUnits,
      loadReduction,
      monthlySavings,
      sysType,
    };
  }

  const systemKW = Math.max(0, numVal(values, capacityKey(installationType)));
  const panels = Math.max(2, Math.ceil((systemKW * 1000) / panelWatt));
  const areaSqft = Math.round(panels * 2.1 * 10.764);
  const acres = Math.round((systemKW / 1000) * 5 * 10) / 10;
  const costPerKW = COST_PER_KW[installationType] || 45000;
  const totalCost = Math.round(systemKW * costPerKW);
  const annualGenUnits = Math.round(systemKW * sunHours * 365 * pr);
  const monthlyGenUnits = Math.round(annualGenUnits / 12);
  const genLabel = systemKW >= 1000 ? `${(systemKW / 1000).toFixed(2)} MW` : `${systemKW} kW`;
  const areaLabel =
    installationType === "Ground Mount"
      ? `${acres} acres (≈ ${areaSqft.toLocaleString("en-IN")} sq.ft)`
      : `${areaSqft.toLocaleString("en-IN")} sq.ft`;

  return {
    flow,
    type: installationType,
    systemKW,
    genLabel,
    panels,
    areaLabel,
    batteryKWh: 0,
    totalCost,
    costPerKW,
    monthlyGenUnits,
    annualGenUnits,
  };
}

export function withFreshEstimate(survey: SiteSurveyV1): SiteSurveyV1 {
  const load = computeLoadSummary(survey.appliances);
  const estimate = calcEstimate(survey.installationType, survey.values, load);
  return { ...survey, estimate };
}
