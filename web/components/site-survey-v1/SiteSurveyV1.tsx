"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fetchProfile } from "@/lib/api";
import { publicAssetUrl } from "@/lib/base-path";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh, invalidateAdminData } from "@/hooks/useLiveRefresh";
import {
  cardTone,
  computeLoadSummary,
  DEFAULT_COMPANY,
  fieldsForStep,
  flowForType,
  fmtRs,
  getMissingForStep,
  getMissingRequiredFields,
  groupBySection,
  INSTALLATION_TYPES,
  mergeCompanyFromBusinessProfile,
  newSurveyDraft,
  previewReportId,
  setValue,
  snapshotOf,
  stepsForFlow,
  surveyPdfToBase64,
  uid,
  val,
  withFreshEstimate,
  type Appliance,
  type SiteSurveyV1 as Survey,
  type SurveyCompanySnapshot,
  type SurveyFieldDef,
  type SurveyHistoryRow,
  type SurveyPhoto,
} from "@/lib/site-survey-v1";
import {
  fillSendTemplate,
  normalizeSendSettings,
  type BusinessProfileSendSettings,
} from "@/lib/types/business-profile";
import { deliverToolArtifact, pdfBase64ToBytes } from "@/lib/artifact-delivery";
import "./site-survey-v1.css";

type Route = "new" | "list" | "history";
type SendChannel = "menu" | "whatsapp" | "email";

const DEFAULT_WA_MESSAGE = `Hi {{customerName}},

Thank you for the opportunity to survey your site for solar installation.

* Report ID: {{reportNo}}
* Installation Type: {{typeLabel}}
* Estimated Capacity: {{genLabel}}
* Estimated Cost: Rs. {{totalCost}}

Please find the detailed survey report attached as a PDF.

Regards,
{{companyName}}
{{companyPhone}}`;

const DEFAULT_EMAIL_SUBJECT = "{{companyName}} — Site Survey Report {{reportNo}}";
const DEFAULT_EMAIL_MESSAGE = `Dear {{customerName}},

Please find attached the site survey report for your solar installation.

* Report ID: {{reportNo}}
* Installation Type: {{typeLabel}}
* Estimated Capacity: {{genLabel}}
* Estimated Cost: Rs. {{totalCost}}

Feel free to reach out if you have any questions.

Regards,
{{companyName}}
{{companyPhone}}`;

const APPLIANCE_ICONS: Record<string, string> = {
  bulb: "\u{1F4A1}",
  wind: "\u{1F300}",
  "device-tv": "\u{1F4FA}",
  fridge: "\u{1F9CA}",
  wash: "\u{1F9FA}",
  droplet: "\u{1F6BF}",
  toaster: "\u{1F35E}",
  snowflake: "\u2744\uFE0F",
  "device-desktop": "\u{1F5A5}\uFE0F",
  "device-laptop": "\u{1F4BB}",
  car: "\u{1F697}",
  gauge: "\u{1F6B0}",
};

/** othersitessolar is only relevant when the owner has confirmed other sites. */
function isFieldVisible(field: SurveyFieldDef, values: Survey["values"]): boolean {
  if (field.key === "othersitessolar") {
    return val(values, "othersites") === "Yes";
  }
  return true;
}

function fileFieldLabel(field: SurveyFieldDef): string {
  if (field.label) return field.label;
  return field.key
    .replace(/^[a-z]+_/i, "")
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function pdfBase64ToUint8(pdfBase64: string) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function forceDownloadPdf(filename: string, pdfBase64: string) {
  const bytes = pdfBase64ToUint8(pdfBase64);
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return new File([bytes], safeName, { type: "application/pdf" });
}

function waDigits(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function whatsappChatUrl(phoneDigits: string, text: string) {
  return `https://api.whatsapp.com/send?phone=${encodeURIComponent(phoneDigits)}&text=${encodeURIComponent(text)}`;
}

function userDisplayName(user: { name?: string | null; email?: string } | null | undefined) {
  const name = (user?.name ?? "").trim();
  if (name) return name;
  const email = (user?.email ?? "").trim();
  if (email.includes("@")) return email.split("@")[0] || "";
  return email;
}

async function compressImageFile(file: File): Promise<{ name: string; mime: string; dataUrl: string }> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image"));
    el.src = rawDataUrl;
  });
  const longest = Math.max(img.width, img.height) || 1;
  const scale = longest > 960 ? 960 / longest : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { name: file.name, mime: "image/jpeg", dataUrl: rawDataUrl };
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
  return { name: file.name, mime: "image/jpeg", dataUrl };
}

function messageVars(survey: Survey, company: SurveyCompanySnapshot) {
  const est = survey.estimate;
  return {
    customerName: val(survey.values, "f_name") || "Customer",
    reportNo: survey.reportNo || previewReportId(company.reportPrefix),
    typeLabel: survey.installationType,
    genLabel: est?.genLabel || "—",
    totalCost: est ? Math.round(est.totalCost).toLocaleString("en-IN") : "—",
    companyName: company.name,
    companyPhone: company.phone,
  };
}

/* ------------------------------------------------------------------ */
/* Field renderer                                                     */
/* ------------------------------------------------------------------ */

function FieldRenderer({
  field,
  values,
  onChange,
}: {
  field: SurveyFieldDef;
  values: Survey["values"];
  onChange: (key: string, value: string | string[]) => void;
}) {
  const raw = values[field.key];
  const strVal = val(values, field.key);
  const arrVal = Array.isArray(raw) ? raw : [];
  const label = (
    <label htmlFor={`ssv1-f-${field.key}`}>
      {field.label}
      {field.required ? <span className="ssv1-req">*</span> : <span className="ssv1-optional"> (optional)</span>}
    </label>
  );

  if (field.kind === "radio") {
    return (
      <div className="ssv1-field">
        {label}
        <div className="ssv1-pill-group" role="radiogroup" aria-label={field.label}>
          {field.options.map((opt) => (
            <label key={opt.value} className={strVal === opt.value ? "is-checked" : ""}>
              <input
                type="radio"
                name={field.key}
                value={opt.value}
                checked={strVal === opt.value}
                onChange={() => onChange(field.key, opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.kind === "checkbox") {
    return (
      <div className="ssv1-field">
        {label}
        <div className="ssv1-pill-group">
          {field.options.map((opt) => {
            const checked = arrVal.includes(opt.value);
            return (
              <label key={opt.value} className={checked ? "is-checked" : ""}>
                <input
                  type="checkbox"
                  value={opt.value}
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arrVal, opt.value]
                      : arrVal.filter((v) => v !== opt.value);
                    onChange(field.key, next);
                  }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.kind === "select") {
    return (
      <div className="ssv1-field">
        {label}
        <select
          id={`ssv1-f-${field.key}`}
          value={strVal}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">— Select —</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === "textarea") {
    return (
      <div className="ssv1-field">
        {label}
        <textarea
          id={`ssv1-f-${field.key}`}
          rows={4}
          placeholder={field.placeholder ?? ""}
          value={strVal}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      </div>
    );
  }

  const inputType = field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "email" ? "email" : "text";
  return (
    <div className="ssv1-field">
      {label}
      <input
        id={`ssv1-f-${field.key}`}
        type={inputType}
        placeholder={field.placeholder ?? ""}
        value={strVal}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    </div>
  );
}

function SectionCard({ section, fields, values, onChange }: {
  section: string;
  fields: SurveyFieldDef[];
  values: Survey["values"];
  onChange: (key: string, value: string | string[]) => void;
}) {
  return (
    <div className="ssv1-card" data-tone={cardTone(section)}>
      <div className="ssv1-card-label">{section}</div>
      {fields.map((f) => (
        <FieldRenderer key={f.key} field={f} values={values} onChange={onChange} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appliance / load step                                              */
/* ------------------------------------------------------------------ */

function ApplianceList({ appliances, onChange }: { appliances: Appliance[]; onChange: (next: Appliance[]) => void }) {
  const load = computeLoadSummary(appliances);

  function patchOne(id: string, patch: Partial<Appliance>) {
    onChange(appliances.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  return (
    <>
      <div className="ssv1-card" data-tone="green">
        <div className="ssv1-card-label">Load Summary</div>
        <div className="ssv1-load-summary-grid">
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{load.connLoad.toFixed(1)}</div>
            <div className="ssv1-load-stat-lbl">Connected&nbsp;kW</div>
          </div>
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{load.dailyUnits.toFixed(1)}</div>
            <div className="ssv1-load-stat-lbl">Daily kWh</div>
          </div>
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{Math.round(load.monthlyUnits)}</div>
            <div className="ssv1-load-stat-lbl">Monthly kWh</div>
          </div>
        </div>
      </div>

      <div className="ssv1-card" data-tone="blue">
        <div className="ssv1-card-label">Appliances / Connected Load</div>
        {appliances.map((a) => {
          const daily = a.on ? ((a.qty * a.watt * a.hours) / 1000).toFixed(2) : "0.00";
          return (
            <div key={a.id} className={`ssv1-appl-card ${a.on ? "is-on" : ""}`}>
              <div className="ssv1-appl-top">
                <div className="ssv1-appl-icon">{APPLIANCE_ICONS[a.icon] ?? "\u{1F50C}"}</div>
                {a.custom ? (
                  <input
                    className="ssv1-appl-name-input"
                    value={a.name}
                    onChange={(e) => patchOne(a.id, { name: e.target.value })}
                    placeholder="Appliance name"
                  />
                ) : (
                  <span className="ssv1-appl-name">{a.name}</span>
                )}
                <span className="ssv1-appl-daily">{daily} kWh/day</span>
                <button
                  type="button"
                  className={`ssv1-appl-switch ${a.on ? "is-on" : ""}`}
                  aria-label={`Toggle ${a.name}`}
                  onClick={() => patchOne(a.id, { on: !a.on })}
                >
                  <span className="ssv1-knob" />
                </button>
                {a.custom ? (
                  <button
                    type="button"
                    className="ssv1-appl-remove"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => onChange(appliances.filter((x) => x.id !== a.id))}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {a.on ? (
                <div className="ssv1-appl-body">
                  <div className="ssv1-appl-field">
                    <label>Qty</label>
                    <input
                      type="number"
                      min={0}
                      value={a.qty}
                      onChange={(e) => patchOne(a.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div className="ssv1-appl-field">
                    <label>Watts</label>
                    <input
                      type="number"
                      min={0}
                      value={a.watt}
                      onChange={(e) => patchOne(a.id, { watt: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div className="ssv1-appl-field">
                    <label>Hrs/day</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={a.hours}
                      onChange={(e) => patchOne(a.id, { hours: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="ssv1-btn-ghost"
          onClick={() =>
            onChange([
              ...appliances,
              { id: uid(), name: "New appliance", icon: "gauge", qty: 1, watt: 100, hours: 1, on: true, custom: true },
            ])
          }
        >
          + Add custom appliance
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Photo upload field                                                 */
/* ------------------------------------------------------------------ */

function PhotoField({
  field,
  photos,
  busy,
  onChange,
}: {
  field: SurveyFieldDef;
  photos: SurveyPhoto[];
  busy: boolean;
  onChange: (next: SurveyPhoto[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = Math.max(0, 4 - photos.length);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !remaining) return;
    const picked = Array.from(files).slice(0, remaining);
    const compressed = await Promise.all(picked.map((f) => compressImageFile(f)));
    onChange([...photos, ...compressed]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="ssv1-field">
      <label>{fileFieldLabel(field)} <span className="ssv1-optional">(up to 4 photos)</span></label>
      {remaining > 0 ? (
        <div className="ssv1-upload-box">
          <span className="ssv1-upload-glyph">{"\u{1F4F7}"}</span>
          <p>{busy ? "Processing…" : "Tap to add photos"}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>
      ) : null}
      {photos.length ? (
        <div className="ssv1-thumb-grid">
          {photos.map((p, idx) => (
            <div key={`${p.name}-${idx}`} className="ssv1-thumb-wrap">
              {p.dataUrl ? <img src={p.dataUrl} alt={p.name} /> : null}
              <button
                type="button"
                className="ssv1-thumb-remove"
                aria-label="Remove photo"
                onClick={() => onChange(photos.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report / estimate hero                                             */
/* ------------------------------------------------------------------ */

function EstimateReport({ survey, company }: { survey: Survey; company: SurveyCompanySnapshot }) {
  const est = survey.estimate;
  const flow = flowForType(survey.installationType);
  return (
    <>
      <div className="ssv1-report-hero">
        <div className="ssv1-report-hero-row">
          <div>
            <div className="ssv1-report-hero-val">{est?.genLabel ?? "—"}</div>
            <div className="ssv1-report-hero-lbl">Recommended System Size</div>
          </div>
          <span className="ssv1-report-hero-badge">{survey.installationType}</span>
        </div>
      </div>
      <div className="ssv1-card" data-tone="green">
        <div className="ssv1-card-label">Estimate Summary</div>
        <div className="ssv1-load-summary-grid ssv1-cols-2">
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{fmtRs(est?.totalCost)}</div>
            <div className="ssv1-load-stat-lbl">Estimated Total Cost</div>
          </div>
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{est?.panels ?? "—"}</div>
            <div className="ssv1-load-stat-lbl">Panels Required</div>
          </div>
          <div className="ssv1-load-stat">
            <div className="ssv1-load-stat-val">{est ? `${est.monthlyGenUnits} kWh` : "—"}</div>
            <div className="ssv1-load-stat-lbl">Monthly Generation</div>
          </div>
          {flow === "residential" ? (
            <div className="ssv1-load-stat">
              <div className="ssv1-load-stat-val">{est?.monthlySavings ? fmtRs(est.monthlySavings) : "—"}</div>
              <div className="ssv1-load-stat-lbl">Est. Monthly Savings</div>
            </div>
          ) : (
            <div className="ssv1-load-stat">
              <div className="ssv1-load-stat-val">{est?.areaLabel ?? "—"}</div>
              <div className="ssv1-load-stat-lbl">Area Required</div>
            </div>
          )}
        </div>
      </div>
      <div className="ssv1-type-note">
        <b>{company.name}</b> — Report ID <b>{survey.reportNo || previewReportId(company.reportPrefix)}</b> will be
        finalised when you submit this survey. Review the details in the previous steps, then hit Submit to
        generate the PDF report.
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export function SiteSurveyV1() {
  const { user } = useAuth();
  const [route, setRoute] = useState<Route>("new");
  const [company, setCompany] = useState<SurveyCompanySnapshot>({ ...DEFAULT_COMPANY });
  const [sendSettings, setSendSettings] = useState<BusinessProfileSendSettings>(() => normalizeSendSettings(null));
  const [current, setCurrent] = useState<Survey>(() => newSurveyDraft());
  const [list, setList] = useState<Survey[]>([]);
  const [history, setHistory] = useState<SurveyHistoryRow[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusyKey, setPhotoBusyKey] = useState<string | null>(null);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendChannel, setSendChannel] = useState<SendChannel>("menu");
  const [waPhones, setWaPhones] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waCanAutoAttach, setWaCanAutoAttach] = useState(false);
  const [waLaunch, setWaLaunch] = useState<{ filename: string; file: File; links: Array<{ phone: string; label: string; href: string }> } | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  const preparedSurveyorSeeded = useRef(false);

  const flow = flowForType(current.installationType);
  const steps = useMemo(() => stepsForFlow(flow), [flow]);
  /** Clamp defensively — flow can change (fewer/more steps) while stepIndex is stale. */
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);

  const flash = useCallback((msg: string, kind = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const reloadMeta = useCallback(async () => {
    const [c, h, s, profile] = await Promise.all([
      api<{ company: SurveyCompanySnapshot | null }>("/site-survey-v1/company"),
      api<{ history: SurveyHistoryRow[] }>("/site-survey-v1/history"),
      api<{ surveys: Survey[] }>("/site-survey-v1"),
      fetchProfile().catch(() => null),
    ]);
    const stored = c.company ? { ...DEFAULT_COMPANY, ...c.company, logo: c.company.logo ?? null } : { ...DEFAULT_COMPANY };
    setCompany(mergeCompanyFromBusinessProfile(stored, profile));
    setSendSettings(normalizeSendSettings(profile?.sendSettings ?? null));
    setHistory(h.history ?? []);
    setList((s.surveys ?? []) as Survey[]);
  }, []);

  useLiveRefresh(async () => {
    try {
      await reloadMeta();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to load", "err");
    }
  }, { intervalMs: 45_000, deps: [user?.businessProfileId] });

  useEffect(() => {
    const name = userDisplayName(user);
    if (!name || preparedSurveyorSeeded.current) return;
    preparedSurveyorSeeded.current = true;
    setCurrent((s) => {
      if (s.reportNo || val(s.values, "sv_name")) return s;
      return setValue(setValue(s, "sv_name", name), "sv2_name", name);
    });
  }, [user]);

  function updateValue(key: string, value: string | string[]) {
    setCurrent((prev) => setValue(prev, key, value));
  }

  function updateAppliances(next: Appliance[]) {
    setCurrent((prev) => withFreshEstimate({ ...prev, appliances: next }));
  }

  function updatePhotos(key: string, next: SurveyPhoto[]) {
    setCurrent((prev) => ({ ...prev, photos: { ...prev.photos, [key]: next } }));
  }

  function startNewSurvey() {
    setCurrent(newSurveyDraft(val(current.values, "sv_name") || userDisplayName(user)));
    setLastSaved(null);
    setStepIndex(0);
    setShowSuccess(false);
  }

  function isSaved() {
    return Boolean(current.reportNo && snapshotOf(current) === lastSaved);
  }

  async function saveSurvey(markStatus?: Survey["status"]): Promise<Survey | null> {
    const missing = getMissingRequiredFields(current);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return null;
    }
    if (isSaved() && !markStatus) {
      flash(`No changes since last save — ${current.reportNo} is already up to date.`);
      return current;
    }
    setBusy(true);
    try {
      const payload: Survey = {
        ...current,
        status: markStatus ?? (current.status === "draft" ? "saved" : current.status),
        companySnapshot: company,
        history: markStatus
          ? [...current.history, { ts: new Date().toISOString(), event: `Status set to ${markStatus}` }]
          : current.status === "draft"
            ? [...current.history, { ts: new Date().toISOString(), event: "Saved" }]
            : current.history,
      };
      const data = await api<{ survey: Survey }>("/site-survey-v1", {
        method: "POST",
        body: JSON.stringify({ survey: payload, estimatedCost: payload.estimate?.totalCost ?? 0 }),
      });
      const saved = data.survey;
      setCurrent(saved);
      setLastSaved(snapshotOf(saved));
      flash(`Saved as ${saved.reportNo}.`);
      invalidateAdminData("site-survey-v1");
      await reloadMeta();
      return saved;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Save failed", "err");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function buildPdf(survey: Survey) {
    // Refresh letterhead from Business Profile so PDF always gets current name + logo.
    let brand = company;
    try {
      const [c, profile] = await Promise.all([
        api<{ company: SurveyCompanySnapshot | null }>("/site-survey-v1/company"),
        fetchProfile().catch(() => null),
      ]);
      const stored = c.company
        ? { ...DEFAULT_COMPANY, ...c.company, logo: c.company.logo ?? null }
        : { ...DEFAULT_COMPANY };
      brand = mergeCompanyFromBusinessProfile(stored, profile);
      setCompany(brand);
    } catch {
      // Keep in-memory company if refresh fails.
    }

    // If the wizard already rendered the logo <img>, prefer those decoded pixels.
    if (typeof document !== "undefined") {
      const img = document.querySelector(".ssv1-brand-icon img") as HTMLImageElement | null;
      if (img?.src && img.naturalWidth > 0) {
        brand = { ...brand, logo: img.currentSrc || img.src || brand.logo };
      }
    }

    return surveyPdfToBase64(survey, brand);
  }

  function goNext() {
    const step = steps[safeStepIndex];
    if (step && step.id !== "report" && step.id !== "load") {
      const missing = getMissingForStep(current, step.id);
      if (missing.length) {
        flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
        return;
      }
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  async function submitSurvey() {
    const saved = await saveSurvey("submitted");
    if (!saved) return;
    setBusy(true);
    try {
      const pdf = await buildPdf(saved);
      const result = await deliverToolArtifact({
        toolId: "site-survey-v1",
        filename: pdf.filename.toLowerCase().endsWith(".pdf")
          ? pdf.filename
          : `${pdf.filename}.pdf`,
        bytes: pdfBase64ToBytes(pdf.pdfBase64),
        mimeType: "application/pdf",
        preferShare: true,
        meta: { reportNo: saved.reportNo, surveyId: saved.id },
      });
      setShowSuccess(true);
      flash(result.message || "Survey submitted — PDF delivered.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "PDF generation failed", "err");
    } finally {
      setBusy(false);
    }
  }

  function validateSaved(): boolean {
    const missing = getMissingRequiredFields(current);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return false;
    }
    if (!current.reportNo) {
      flash("Please save this survey first — sending requires a saved survey.", "err");
      return false;
    }
    return true;
  }

  function openSendModal() {
    if (!validateSaved()) return;
    const send = normalizeSendSettings(sendSettings);
    const vars = messageVars(current, company);
    const customerPhone = val(current.values, "f_phone").replace(/\D/g, "");
    const numbers = [customerPhone, ...send.whatsappNumbers.filter((n) => n.phone).map((n) => n.phone)].filter(Boolean);
    setWaPhones([...new Set(numbers)].join(", "));
    setWaLaunch(null);
    setWaMessage(fillSendTemplate(send.whatsappMessage?.trim() || DEFAULT_WA_MESSAGE, vars));
    setEmailTo(send.email.to.trim() || val(current.values, "f_email") || "");
    setEmailCc(send.email.cc.trim());
    setEmailSubject(fillSendTemplate(send.email.subject?.trim() || DEFAULT_EMAIL_SUBJECT, vars));
    setEmailMessage(fillSendTemplate(send.email.message?.trim() || DEFAULT_EMAIL_MESSAGE, vars));
    setSendChannel("menu");
    setSendOpen(true);
    void api<{ canAutoAttach?: boolean }>("/site-survey-v1/send/whatsapp/status")
      .then((s) => setWaCanAutoAttach(Boolean(s.canAutoAttach)))
      .catch(() => setWaCanAutoAttach(false));
  }

  async function sendWhatsApp() {
    const unique = [...new Set(waPhones.split(/[,;\n]+/).map(waDigits).filter(Boolean))];
    if (!unique.length) {
      flash("Enter at least one WhatsApp number.", "err");
      return;
    }
    const text = waMessage.trim();
    if (!text) {
      flash("Enter a WhatsApp message before sending.", "err");
      return;
    }
    setBusy(true);
    try {
      const pdf = await buildPdf(current);
      if (waCanAutoAttach) {
        const result = await api<{ delivered: boolean; via: string; sent?: string[]; errors?: Array<{ phone: string; error: string }> }>(
          "/site-survey-v1/send/whatsapp",
          {
            method: "POST",
            body: JSON.stringify({ phones: unique, message: text, filename: pdf.filename, pdfBase64: pdf.pdfBase64, surveyId: current.id }),
          },
        );
        if (result.delivered) {
          setSendOpen(false);
          setSendChannel("menu");
          const partial = result.errors?.length ? ` Some failed: ${result.errors.map((e) => e.phone).join(", ")}.` : "";
          flash(`WhatsApp sent with PDF attached.${partial}`);
          return;
        }
      }
      const file = forceDownloadPdf(pdf.filename, pdf.pdfBase64);
      setWaLaunch({
        filename: pdf.filename,
        file,
        links: unique.map((phone) => ({ phone, label: phone, href: whatsappChatUrl(phone, text) })),
      });
      flash(`PDF saved as ${pdf.filename}. Open each WhatsApp chat below and attach the file.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "WhatsApp prepare failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    if (!emailTo.trim()) {
      flash("Enter an email To address.", "err");
      return;
    }
    setBusy(true);
    try {
      let pdf: { filename: string; pdfBase64: string } | null = null;
      try {
        pdf = await buildPdf(current);
      } catch {
        pdf = null;
      }
      const result = await api<{ delivered: boolean }>("/site-survey-v1/send/email", {
        method: "POST",
        body: JSON.stringify({
          to: emailTo.trim(),
          cc: emailCc.trim(),
          subject: emailSubject.trim(),
          message: emailMessage,
          surveyId: current.id,
          reportNo: current.reportNo,
          filename: pdf?.filename,
          pdfBase64: pdf?.pdfBase64,
        }),
      });
      if (!result.delivered) {
        if (pdf) forceDownloadPdf(pdf.filename, pdf.pdfBase64);
        const params = new URLSearchParams();
        if (emailCc.trim()) params.set("cc", emailCc.trim());
        params.set("subject", emailSubject.trim());
        params.set("body", emailMessage.slice(0, 1800));
        window.location.href = `mailto:${emailTo.trim()}?${params.toString()}`;
      }
      setSendOpen(false);
      flash(result.delivered ? "Email sent." : "Opened your mail app and downloaded the PDF — attach it before sending.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Email send failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function exportHistoryExcel() {
    const XLSX = await import("xlsx");
    const rows = history.map((h) => ({
      "Report No.": h.reportNo || "(unsaved)",
      Customer: h.customerName,
      Type: h.installationType,
      Status: h.status,
      "Estimated Cost": h.estimatedCost,
      Saved: h.savedAt,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    XLSX.writeFile(wb, "site-survey-history.xlsx");
    flash("History Excel downloaded.");
  }

  const step = steps[safeStepIndex];
  const stepFields = step ? fieldsForStep(flow, step.id, current.installationType).filter((f) => isFieldVisible(f, current.values)) : [];
  const normalFields = stepFields.filter((f) => f.kind !== "file");
  const fileFields = stepFields.filter((f) => f.kind === "file");
  const grouped = groupBySection(normalFields);
  const progressPct = steps.length ? ((safeStepIndex + 1) / steps.length) * 100 : 0;

  return (
    <div className="ssv1-shell">
      <header className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Site Survey Generator V1</div>
          <div className="tool-header-sub">
            Structured solar site survey · load estimate · branded PDF report
            {user?.email ? ` · ${user.email}` : ""}
          </div>
        </div>
      </header>

      <nav className="ssv1-seg" aria-label="Site survey views">
        <button
          type="button"
          className={`ssv1-seg-item ${route === "new" ? "active" : ""}`}
          onClick={() => setRoute("new")}
        >
          <span className="ssv1-seg-label">Survey</span>
          <span className="ssv1-seg-hint">Capture &amp; estimate</span>
        </button>
        <button
          type="button"
          className={`ssv1-seg-item ${route === "list" ? "active" : ""}`}
          onClick={() => setRoute("list")}
        >
          <span className="ssv1-seg-label">Saved</span>
          <span className="ssv1-seg-hint">{list.length ? `${list.length} on file` : "Open drafts"}</span>
          {list.length ? <span className="ssv1-seg-badge">{list.length}</span> : null}
        </button>
        <button
          type="button"
          className={`ssv1-seg-item ${route === "history" ? "active" : ""}`}
          onClick={() => setRoute("history")}
        >
          <span className="ssv1-seg-label">History</span>
          <span className="ssv1-seg-hint">Audit &amp; export</span>
          {history.length ? <span className="ssv1-seg-badge">{history.length}</span> : null}
        </button>
      </nav>

      {route === "new" ? (
        <div className="ssv1-wizard-wrap">
          <div className="ssv1-popup">
            <aside className="ssv1-popup-header">
              <div className="ssv1-brand-row">
                {company.logo ? (
                  <div className="ssv1-brand-icon">
                    <img src={publicAssetUrl(company.logo)} alt="" />
                  </div>
                ) : (
                  <div className="ssv1-brand-icon ssv1-brand-icon-empty" aria-hidden>
                    SS
                  </div>
                )}
                <div className="ssv1-brand-text">
                  <h1>{company.name}</h1>
                  <p>{company.tagline || "Solar Site Survey"}</p>
                </div>
              </div>

              <div className="ssv1-brand-sync">
                <div className="ssv1-brand-sync-copy">
                  Letterhead from{" "}
                  <Link href="/profile" className="ssv1-inline-link">
                    Business Profile
                  </Link>
                </div>
              </div>

              <div className="ssv1-report-id-bar">
                <span className="ssv1-rid-label">Report ID</span>
                <span className="ssv1-rid-value">{current.reportNo || previewReportId(company.reportPrefix)}</span>
                <span className={`ssv1-status-chip ssv1-status-${current.status || "draft"}`}>
                  {(current.status || "draft").toUpperCase()}
                </span>
              </div>

              <div className="ssv1-tabs" role="tablist" aria-label="Survey steps">
                {steps.map((s, idx) => {
                  const done = idx < safeStepIndex;
                  const active = idx === safeStepIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`ssv1-tab ${active ? "is-active" : ""} ${done ? "is-done" : ""}`}
                      onClick={() => {
                        setShowSuccess(false);
                        setStepIndex(idx);
                      }}
                    >
                      <span className="ssv1-tab-num" aria-hidden>
                        {done ? "✓" : idx + 1}
                      </span>
                      <span className="ssv1-tab-label">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="ssv1-progress-bar" aria-hidden>
              <div className="ssv1-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>

            <div className="ssv1-popup-body">
              {showSuccess ? (
                <div className="ssv1-success">
                  <div className="ssv1-success-icon">✓</div>
                  <h2>Survey submitted</h2>
                  <p>
                    Report saved and PDF downloaded. Send it to the customer via WhatsApp or email, or start the
                    next survey.
                  </p>
                  <div className="ssv1-success-meta">
                    <div>
                      <span>Report ID</span>
                      <b>{current.reportNo}</b>
                    </div>
                    <div>
                      <span>Customer</span>
                      <b>{val(current.values, "f_name") || "—"}</b>
                    </div>
                    <div>
                      <span>Estimated Cost</span>
                      <b>{fmtRs(current.estimate?.totalCost)}</b>
                    </div>
                  </div>
                  <div className="ssv1-success-actions">
                    <button
                      type="button"
                      className="ssv1-btn-new"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const pdf = await buildPdf(current);
                          const result = await deliverToolArtifact({
                            toolId: "site-survey-v1",
                            filename: pdf.filename.toLowerCase().endsWith(".pdf")
                              ? pdf.filename
                              : `${pdf.filename}.pdf`,
                            bytes: pdfBase64ToBytes(pdf.pdfBase64),
                            mimeType: "application/pdf",
                            preferShare: true,
                            meta: { reportNo: current.reportNo, surveyId: current.id },
                          });
                          flash(result.message || "PDF downloaded again.");
                        } catch (e) {
                          flash(e instanceof Error ? e.message : "PDF failed", "err");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Download PDF
                    </button>
                    <button type="button" className="ssv1-btn-new" onClick={() => openSendModal()}>
                      Send via WhatsApp / Email
                    </button>
                    <button type="button" className="ssv1-btn-new ssv1-btn-new-primary" onClick={startNewSurvey}>
                      Start New Survey
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ssv1-step" key={step?.id}>
                  <div className="ssv1-step-head">
                    <div>
                      <div className="ssv1-step-kicker">
                        Step {safeStepIndex + 1} of {steps.length}
                      </div>
                      <h2 className="ssv1-step-title">{step?.label ?? "Survey"}</h2>
                      <p className="ssv1-step-desc">
                        {safeStepIndex === 0
                          ? "Confirm customer details and installation type. Later steps adapt to your selection."
                          : step?.id === "load"
                            ? "Toggle appliances and hours to build the daily load profile used in the estimate."
                            : step?.id === "report"
                              ? "Review the generated estimate, then save or submit the branded PDF report."
                              : step?.id === "photos" || fileFields.length
                                ? "Attach clear site photos — they appear in the PDF photo appendix."
                                : "Complete the fields below. Required items are marked and validated before you continue."}
                      </p>
                    </div>
                    <div className="ssv1-step-pct" aria-hidden>
                      <b>{Math.round(progressPct)}%</b>
                      <span>complete</span>
                    </div>
                  </div>

                  {safeStepIndex === 0 ? (
                    <div className="ssv1-type-note">
                      Choose one of <b>{INSTALLATION_TYPES.join(" · ")}</b> — remaining steps and the final
                      estimate adapt automatically.
                    </div>
                  ) : null}

                  {grouped.map((g) => (
                    <SectionCard key={g.section} section={g.section} fields={g.fields} values={current.values} onChange={updateValue} />
                  ))}

                  {step?.id === "load" ? (
                    <ApplianceList appliances={current.appliances} onChange={updateAppliances} />
                  ) : null}

                  {step?.id === "report" ? <EstimateReport survey={current} company={company} /> : null}

                  {fileFields.length ? (
                    <div className="ssv1-card" data-tone="purple">
                      <div className="ssv1-card-label">Site Photos</div>
                      {fileFields.map((f) => (
                        <PhotoField
                          key={f.key}
                          field={f}
                          photos={current.photos[f.key] ?? []}
                          busy={photoBusyKey === f.key}
                          onChange={(next) => {
                            setPhotoBusyKey(f.key);
                            updatePhotos(f.key, next);
                            setPhotoBusyKey(null);
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {!showSuccess ? (
              <div className="ssv1-popup-footer">
                <span className="ssv1-step-counter">
                  Step <b>{safeStepIndex + 1}</b> / {steps.length}
                </span>
                <div className="ssv1-nav-btns">
                  <button type="button" className="ssv1-btn ssv1-btn-back" disabled={safeStepIndex === 0} onClick={goBack}>
                    <span>Back</span>
                  </button>
                  <button type="button" className="ssv1-btn ssv1-btn-save" disabled={busy} onClick={() => void saveSurvey()}>
                    Save
                  </button>
                  {safeStepIndex === steps.length - 1 ? (
                    <button type="button" className="ssv1-btn ssv1-btn-submit" disabled={busy} onClick={() => void submitSurvey()}>
                      Submit &amp; PDF
                    </button>
                  ) : (
                    <button type="button" className="ssv1-btn ssv1-btn-next" disabled={busy} onClick={goNext}>
                      Continue
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {route === "list" ? (
        <section className="ssv1-panel">
          <div className="ssv1-page-head">
            <div>
              <h1>Saved surveys</h1>
              <p className="ssv1-sub">Open a draft or submitted survey to continue editing, regenerate the PDF, or send it.</p>
            </div>
            <button type="button" className="ssv1-btn ssv1-btn-next ssv1-btn-compact" onClick={() => { startNewSurvey(); setRoute("new"); }}>
              New survey
            </button>
          </div>
          {list.length === 0 ? (
            <div className="ssv1-empty">
              <div className="ssv1-empty-title">No surveys on file</div>
              <p>Start a new survey to capture site details and generate a branded report.</p>
              <button type="button" className="ssv1-btn ssv1-btn-next ssv1-btn-compact" onClick={() => setRoute("new")}>
                Start survey
              </button>
            </div>
          ) : (
            <div className="tracker-list">
              {list.map((s) => (
                <div key={s.id} className="tracker-row">
                  <div className="tracker-row-main">
                    <span className="tracker-row-title ssv1-mono">{s.reportNo || "(draft)"}</span>
                    <span className="tracker-row-sub">
                      {val(s.values, "f_name") || "Unnamed"} · {s.installationType} · {fmtRs(s.estimate?.totalCost)}
                    </span>
                  </div>
                  <span className={`pill pill-${s.status === "submitted" ? "success" : s.status === "saved" ? "warning" : "neutral"}`}>
                    {s.status}
                  </span>
                  <div className="tracker-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        try {
                          const data = await api<{ survey: Survey }>(`/site-survey-v1/${s.id}`);
                          const full = withFreshEstimate(data.survey);
                          setCurrent(full);
                          setLastSaved(snapshotOf(full));
                          setStepIndex(0);
                          setShowSuccess(false);
                          setRoute("new");
                        } catch (e) {
                          flash(e instanceof Error ? e.message : "Failed to open survey", "err");
                        }
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={async () => {
                        if (!confirm(`Delete ${s.reportNo || "this draft"}?`)) return;
                        await api(`/site-survey-v1/${s.id}`, { method: "DELETE" });
                        flash("Deleted.");
                        invalidateAdminData("site-survey-v1");
                        await reloadMeta();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {route === "history" ? (
        <section className="ssv1-panel">
          <div className="ssv1-page-head">
            <div>
              <h1>Save history</h1>
              <p className="ssv1-sub">Every save is logged here for audit — even if the survey is later deleted.</p>
            </div>
            <button type="button" className="ssv1-btn ssv1-btn-back ssv1-btn-compact" onClick={() => void exportHistoryExcel()}>
              Export Excel
            </button>
          </div>
          {history.length === 0 ? (
            <div className="ssv1-empty">
              <div className="ssv1-empty-title">No history yet</div>
              <p>History fills automatically each time you save a survey.</p>
            </div>
          ) : (
            <div className="ssv1-table-wrap">
              <table className="ssv1-htable">
                <thead>
                  <tr>
                    <th>Report No.</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Estimated Cost</th>
                    <th>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="ssv1-mono">{h.reportNo || "(unsaved)"}</td>
                      <td>{h.customerName}</td>
                      <td>{h.installationType}</td>
                      <td>{h.status}</td>
                      <td>{fmtRs(h.estimatedCost)}</td>
                      <td>{h.savedAt?.slice(0, 19).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {sendOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setSendOpen(false);
            setSendChannel("menu");
            setWaLaunch(null);
          }}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {sendChannel === "menu" ? "Send Via" : sendChannel === "whatsapp" ? "WhatsApp" : "Email"}
            </h3>

            {sendChannel === "menu" ? (
              <>
                <p className="modal-msg">Choose how to deliver this survey report.</p>
                <div className="ssv1-send-options">
                  <button type="button" className="ssv1-send-option" onClick={() => setSendChannel("whatsapp")}>
                    <strong>WhatsApp</strong>
                    <span>
                      {waCanAutoAttach
                        ? "Sends message + PDF attachment automatically"
                        : "Message + PDF (attach manually if no webhook is configured)"}
                    </span>
                  </button>
                  <button type="button" className="ssv1-send-option" onClick={() => setSendChannel("email")}>
                    <strong>Email</strong>
                    <span>Opens your mail app, or sends via server if a webhook is configured</span>
                  </button>
                </div>
                <div className="modal-btns">
                  <button type="button" className="btn btn-secondary" onClick={() => setSendOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}

            {sendChannel === "whatsapp" ? (
              !waLaunch ? (
                <>
                  <label className="field">
                    <span>WhatsApp numbers (comma-separated)</span>
                    <input value={waPhones} onChange={(e) => setWaPhones(e.target.value)} placeholder="e.g. 9876543210, 9123456789" />
                  </label>
                  <label className="field" style={{ marginTop: 10 }}>
                    <span>Message</span>
                    <textarea rows={9} value={waMessage} onChange={(e) => setWaMessage(e.target.value)} />
                  </label>
                  <div className="modal-btns">
                    <button type="button" className="btn btn-ghost" onClick={() => setSendChannel("menu")}>
                      Back
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void sendWhatsApp()}>
                      {waCanAutoAttach ? "Send WhatsApp with PDF" : "Download PDF & continue"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="modal-msg">
                    PDF <strong>{waLaunch.filename}</strong> was downloaded. Open each chat below (message
                    prefilled) and attach the PDF manually.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {waLaunch.links.map((link) => (
                      <a key={link.phone} className="btn btn-primary" href={link.href} target="_blank" rel="noopener noreferrer">
                        Open WhatsApp — {link.label}
                      </a>
                    ))}
                  </div>
                  <div className="modal-btns">
                    <button type="button" className="btn btn-ghost" onClick={() => setWaLaunch(null)}>
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setWaLaunch(null);
                        setSendOpen(false);
                        setSendChannel("menu");
                        flash("Marked as sent. Attach the PDF in each WhatsApp chat if you have not yet.");
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              )
            ) : null}

            {sendChannel === "email" ? (
              <>
                <div>
                  <label className="field">
                    <span>To</span>
                    <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>CC</span>
                    <input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="comma-separated" />
                  </label>
                  <label className="field">
                    <span>Subject</span>
                    <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Message</span>
                    <textarea rows={7} value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} />
                  </label>
                </div>
                <div className="modal-btns">
                  <button type="button" className="btn btn-ghost" onClick={() => setSendChannel("menu")}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void sendEmail()}>
                    Send email
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className={`ssv1-toast is-show ${toast.kind === "err" ? "is-err" : ""}`}>
          {toast.msg}
          <button type="button" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
