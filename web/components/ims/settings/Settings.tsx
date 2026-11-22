"use client";

import "./settings.css";
import { useState } from "react";
import { Alert, Button, useToast } from "@/components/bos";
import type { ImsSettings, ImsSettingsMeta } from "@/lib/ims/api";
import { withBomPaperSettingsDefaults } from "@/lib/ims/bom-paper";
import { PREFIX_FIELDS, PREFIX_RE, diffSettings, isValidGstin, settingsApi, unknownPlaceholders, withOpsSettingsDefaults, type SettingsPatch } from "@/lib/ims/settings";
import { Loaded, PageHeader, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { CatalogTab, PermissionsTab } from "./AccessTabs";
import { DataTab } from "./DataTab";
import { BusinessTab, DocumentsTab } from "./GeneralTabs";
import { MapTab } from "./MapTab";
import type { SetDraft, SettingsErrors } from "./parts";
import { RemindersTab } from "./RemindersTab";
import { TeamTab } from "./TeamTab";

type Tab = "business" | "documents" | "team" | "permissions" | "catalog" | "reminders" | "map" | "data";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "business", label: "Business" },
  { value: "documents", label: "Documents & numbering" },
  { value: "team", label: "Team & access" },
  { value: "permissions", label: "Role permissions" },
  { value: "catalog", label: "Catalog lists" },
  { value: "reminders", label: "Reminders" },
  { value: "map", label: "Field map" },
  { value: "data", label: "Data" },
];

const SAVE_KEYS: ReadonlyArray<keyof SettingsPatch> = [
  "businessName",
  "businessType",
  "gstin",
  "baseCurrency",
  "state",
  "stateCode",
  "address",
  "phone",
  "bankUpi",
  "bankAccountName",
  "bankAccountNo",
  "bankIfsc",
  "bankName",
  "msmeRegistered",
  "msmeUdyam",
  "email",
  "fiscalYearStart",
  "retainerPrefix",
  "soPrefix",
  "soDcPrefix",
  "poPrefix",
  "invoicePrefix",
  "cnPrefix",
  "dnPrefix",
  "proformaPrefix",
  "billPrefix",
  "returnPrefix",
  "checkPrefix",
  "ticketPrefix",
  "bomPrefix",
  "bomDcPrefix",
  "bomDcReturnPrefix",
  "bomPaperTemplate",
  "bomIndustryPack",
  "bomPaperTone",
  "bomPaperDensity",
  "bomHideMargin",
  "bomConfirmNeedsApproval",
  "bomRequireQuotationRef",
  "bomScheduleColumns",
  "poApprovalLimit",
  "invoiceApprovalLimit",
  "dunningSequences",
  "draftPoPurgeDays",
  "paymentTermsDays",
  "defaultGstRate",
  "allowNegativeStock",
  "printPackMax",
  "attachmentMaxBytes",
  "agingBreaks",
  "arPriority",
  "apDueSoonDays",
  "paymentTermPresets",
  "defaultRoundToRupee",
  "defaultRetentionPct",
  "gstRateOptions",
  "payMethods",
  "defaultPayMethod",
  "posPayMethods",
  "posRoundToRupee",
  "defaultInstallmentCount",
  "installmentEveryMonths",
  "maxInstallments",
  "exciseEnabled",
  "permissions",
  "taxonomy",
  "reminders",
  "terms",
];

/** Which tab shows each error key, so the save bar can point at it. */
const ERROR_TAB: Record<string, Tab> = {
  businessName: "business",
  gstin: "business",
  baseCurrency: "business",
  dunningSequences: "reminders",
  phone: "business",
  email: "business",
  poApprovalLimit: "documents",
  invoiceApprovalLimit: "documents",
  draftPoPurgeDays: "documents",
  paymentTermsDays: "documents",
  printPackMax: "documents",
  attachmentMaxBytes: "documents",
  agingBreaks: "reminders",
  arPriority: "reminders",
  apDueSoonDays: "reminders",
  paymentTermPresets: "documents",
  defaultRetentionPct: "documents",
  gstRateOptions: "documents",
  payMethods: "documents",
  defaultPayMethod: "documents",
  posPayMethods: "documents",
  defaultInstallmentCount: "documents",
  installmentEveryMonths: "documents",
  maxInstallments: "documents",
  categories: "catalog",
  reminders: "reminders",
  ...Object.fromEntries(PREFIX_FIELDS.map((f) => [f.key, "documents"])),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const intIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

function validate(d: ImsSettings): SettingsErrors {
  const e: SettingsErrors = {};
  if (!d.businessName.trim()) e.businessName = "Enter your business name";
  if (d.gstin && !isValidGstin(d.gstin)) e.gstin = "Not a valid GSTIN";
  if (d.baseCurrency !== undefined && !/^[A-Z]{3}$/.test(d.baseCurrency.trim().toUpperCase())) e.baseCurrency = "Use a 3-letter ISO code, e.g. INR";
  if (d.email && !EMAIL_RE.test(d.email.trim())) e.email = "Not a valid email";
  if (d.phone && !/^[+\d][\d\s-]{5,39}$/.test(d.phone.trim())) e.phone = "Not a valid phone number";
  for (const f of PREFIX_FIELDS) if (!PREFIX_RE.test(d[f.key])) e[f.key] = "1–12 letters, digits or dashes";
  if (!Number.isFinite(d.poApprovalLimit) || d.poApprovalLimit < 0) e.poApprovalLimit = "Enter 0 or more";
  if (!Number.isFinite(d.invoiceApprovalLimit) || d.invoiceApprovalLimit < 0) e.invoiceApprovalLimit = "Enter 0 or more";
  if (!intIn(d.draftPoPurgeDays, 0, 365)) e.draftPoPurgeDays = "Whole days, 0–365";
  if (!intIn(d.paymentTermsDays, 0, 365)) e.paymentTermsDays = "Whole days, 0–365";
  if (!intIn(d.printPackMax ?? 25, 1, 200)) e.printPackMax = "Whole number, 1–200";
  if (!Number.isFinite(d.attachmentMaxBytes) || d.attachmentMaxBytes < 256 * 1024 || d.attachmentMaxBytes > 20 * 1024 * 1024) {
    e.attachmentMaxBytes = "Between 0.25 MB and 20 MB";
  }
  const breaks = d.agingBreaks ?? [];
  if (breaks.length !== 4 || breaks.some((n, i) => !Number.isInteger(n) || n < 1 || n > 3650 || (i > 0 && n <= breaks[i - 1]!))) {
    e.agingBreaks = "Enter four ascending day caps (1–3650)";
  }
  const ap = d.arPriority;
  if (!ap || !Number.isInteger(ap.critical) || !Number.isInteger(ap.high) || !Number.isInteger(ap.medium) || !(ap.critical > ap.high && ap.high > ap.medium && ap.medium >= 1)) {
    e.arPriority = "Critical > high > medium (whole days)";
  }
  if (!intIn(d.apDueSoonDays ?? 7, 1, 365)) e.apDueSoonDays = "Whole days, 1–365";
  const terms = d.paymentTermPresets ?? [];
  if (!terms.length || terms.length > 12 || terms.some((n) => !intIn(n, 0, 365))) e.paymentTermPresets = "1–12 whole-day terms, each 0–365";
  if (!Number.isFinite(d.defaultRetentionPct) || d.defaultRetentionPct < 0 || d.defaultRetentionPct > 100) e.defaultRetentionPct = "Between 0 and 100";
  const gst = d.gstRateOptions ?? [];
  if (!gst.length || gst.length > 20 || gst.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) e.gstRateOptions = "1–20 rates, each 0–100";
  if (!(d.payMethods ?? []).length) e.payMethods = "Keep at least one payment method";
  else if (!(d.payMethods ?? []).includes(d.defaultPayMethod)) e.defaultPayMethod = "Pick one of the enabled methods";
  if (!(d.posPayMethods ?? []).length) e.posPayMethods = "Keep at least one counter method";
  if (!intIn(d.maxInstallments ?? 60, 1, 60)) e.maxInstallments = "Whole number, 1–60";
  if (!intIn(d.defaultInstallmentCount ?? 3, 1, Math.min(60, Number.isInteger(d.maxInstallments) ? d.maxInstallments : 60))) e.defaultInstallmentCount = "Whole number, 1 up to the maximum";
  if (!intIn(d.installmentEveryMonths ?? 1, 1, 12)) e.installmentEveryMonths = "Whole months, 1–12";
  const offsets = d.reminders?.offsets;
  if (offsets) {
    const vals = Object.entries(offsets).filter(([k]) => k !== "due").map(([, v]) => v);
    if (vals.some((v) => !Number.isInteger(v) || v < -365 || v > 3650)) e.reminders = "Reminder offsets must be whole days (−365…3650)";
    else if (new Set(vals).size !== vals.length) e.reminders = "Reminder day offsets must be unique";
  }
  const names = d.taxonomy.categories.map((c) => c.name.trim().toLowerCase());
  if (names.some((n) => !n)) e.categories = "Every category needs a name";
  else if (new Set(names).size !== names.length) e.categories = "Category names must be unique";
  const badTpl = d.reminders.templates.find((t) => !t.label.trim() || !t.body.trim() || unknownPlaceholders(t.body).length > 0);
  if (badTpl) e.reminders = `“${badTpl.label || "Untitled"}” needs a name, a message and only known placeholders`;
  const lv = d.dunningSequences;
  if (!lv) {
    /* older API without dunning levels — nothing to validate */
  } else if (!lv.length) e.dunningSequences = "Keep at least one dunning level";
  else if (lv.some((l) => !/^[A-Za-z0-9_-]{1,24}$/.test(l.key.trim()))) e.dunningSequences = "Level keys use letters, digits, dashes or underscores (max 24)";
  else if (new Set(lv.map((l) => l.key.trim().toUpperCase())).size !== lv.length) e.dunningSequences = "Level keys must be unique";
  else if (lv.some((l) => !l.label.trim() || !Number.isInteger(l.minDaysOverdue) || l.minDaysOverdue < 0 || l.minDaysOverdue > 3650)) e.dunningSequences = "Every level needs a name and whole days overdue (0–3650)";
  return e;
}

export function SettingsModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("settings"));
  const state = useImsData(() => settingsApi.meta(), []);
  const initialTab = TABS.some((t) => t.value === intent) ? (intent as Tab) : "business";

  return (
    <Loaded state={state} rows={5}>
      {(meta) => <SettingsEditor meta={meta} initialTab={initialTab} />}
    </Loaded>
  );
}

function SettingsEditor({ meta, initialTab }: { meta: ImsSettingsMeta; initialTab: Tab }) {
  const { can, setSettings } = useIms();
  const { run, busy } = useImsAction();
  const { show } = useToast();
  const readOnly = !can("settings");
  const [tab, setTab] = useState<Tab>(initialTab);
  const hydrate = (s: ImsSettings) => withOpsSettingsDefaults(withBomPaperSettingsDefaults(s) as ImsSettings) as ImsSettings;
  const [base, setBase] = useState<ImsSettings>(() => hydrate(meta.settings));
  const [draft, setDraft] = useState<ImsSettings>(() => hydrate(meta.settings));
  const [showErrors, setShowErrors] = useState(false);

  const patch = diffSettings(base, draft, SAVE_KEYS);
  const changed = Object.keys(patch).length;
  const errors = validate(draft);
  const errorKeys = Object.keys(errors);
  const visibleErrors = showErrors ? errors : {};

  const set: SetDraft = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (errorKeys.length) {
      setShowErrors(true);
      const first = ERROR_TAB[errorKeys[0]];
      if (first) setTab(first);
      show({ tone: "coral", title: "Fix the highlighted fields", description: errorKeys.map((k) => errors[k]).filter(Boolean).slice(0, 3).join(" · ") });
      return;
    }
    const out = await run("save", () => settingsApi.save(patch), { success: "Settings saved", description: `${changed} change${changed === 1 ? "" : "s"}` });
    if (!out) return;
    const next = hydrate(out.settings);
    setBase(next);
    setDraft(next);
    setShowErrors(false);
    setSettings(next);
  };

  const discard = () => {
    setDraft(base);
    setShowErrors(false);
  };

  const tabProps = { draft, set, errors: visibleErrors, readOnly };
  const editsTab = tab !== "team" && tab !== "data" && tab !== "map";

  return (
    <Stack>
      <PageHeader title="Settings" sub={readOnly ? "You can view these settings. Ask an owner to change them." : "Business profile, numbering, team, permissions and lists used across IMS."} />
      {readOnly ? (
        <Alert tone="blue" title="View only">
          Changing settings needs the Settings permission.
        </Alert>
      ) : null}

      <SubTabs<Tab> value={tab} onChange={setTab} label="Settings sections" options={TABS} />

      <div>
        {tab === "business" ? (
          <BusinessTab {...tabProps} meta={meta} />
        ) : tab === "documents" ? (
          <DocumentsTab {...tabProps} />
        ) : tab === "team" ? (
          <TeamTab />
        ) : tab === "permissions" ? (
          <PermissionsTab {...tabProps} meta={meta} />
        ) : tab === "catalog" ? (
          <CatalogTab {...tabProps} />
        ) : tab === "reminders" ? (
          <RemindersTab {...tabProps} />
        ) : tab === "map" ? (
          <MapTab />
        ) : (
          <DataTab />
        )}

        {!readOnly && (changed > 0 || editsTab) ? (
          <div className="ims-savebar" role="region" aria-label="Save settings">
            <span className="ims-savebar-note" aria-live="polite">
              {changed ? (
                <>
                  <strong>
                    {changed} unsaved change{changed === 1 ? "" : "s"}
                  </strong>
                  {showErrors && errorKeys.length ? <span className="ims-faint"> · {errorKeys.length} to fix</span> : null}
                </>
              ) : (
                <span className="ims-faint">All changes saved</span>
              )}
            </span>
            <span className="ims-savebar-actions">
              <Button size="sm" variant="ghost" disabled={!changed || busy === "save"} onClick={discard}>
                Discard
              </Button>
              <Button size="sm" variant="primary" icon="check" disabled={!changed || busy === "save"} onClick={save}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    </Stack>
  );
}

export default SettingsModule;
