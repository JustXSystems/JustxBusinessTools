"use client";

import "./settings.css";
import { useState } from "react";
import { Alert, Button, useToast } from "@/components/bos";
import type { ImsSettings, ImsSettingsMeta } from "@/lib/ims/api";
import { PREFIX_FIELDS, PREFIX_RE, diffSettings, isValidGstin, settingsApi, unknownPlaceholders, type SettingsPatch } from "@/lib/ims/settings";
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
  "state",
  "stateCode",
  "address",
  "phone",
  "email",
  "fiscalYearStart",
  "poPrefix",
  "invoicePrefix",
  "billPrefix",
  "returnPrefix",
  "checkPrefix",
  "ticketPrefix",
  "poApprovalLimit",
  "draftPoPurgeDays",
  "paymentTermsDays",
  "defaultGstRate",
  "allowNegativeStock",
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
  phone: "business",
  email: "business",
  poApprovalLimit: "documents",
  draftPoPurgeDays: "documents",
  paymentTermsDays: "documents",
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
  if (d.email && !EMAIL_RE.test(d.email.trim())) e.email = "Not a valid email";
  if (d.phone && !/^[+\d][\d\s-]{5,39}$/.test(d.phone.trim())) e.phone = "Not a valid phone number";
  for (const f of PREFIX_FIELDS) if (!PREFIX_RE.test(d[f.key])) e[f.key] = "1–12 letters, digits or dashes";
  if (!Number.isFinite(d.poApprovalLimit) || d.poApprovalLimit < 0) e.poApprovalLimit = "Enter 0 or more";
  if (!intIn(d.draftPoPurgeDays, 0, 365)) e.draftPoPurgeDays = "Whole days, 0–365";
  if (!intIn(d.paymentTermsDays, 0, 365)) e.paymentTermsDays = "Whole days, 0–365";
  const names = d.taxonomy.categories.map((c) => c.name.trim().toLowerCase());
  if (names.some((n) => !n)) e.categories = "Every category needs a name";
  else if (new Set(names).size !== names.length) e.categories = "Category names must be unique";
  const badTpl = d.reminders.templates.find((t) => !t.label.trim() || !t.body.trim() || unknownPlaceholders(t.body).length > 0);
  if (badTpl) e.reminders = `“${badTpl.label || "Untitled"}” needs a name, a message and only known placeholders`;
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
  const [base, setBase] = useState<ImsSettings>(meta.settings);
  const [draft, setDraft] = useState<ImsSettings>(meta.settings);
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
    setBase(out.settings);
    setDraft(out.settings);
    setShowErrors(false);
    setSettings(out.settings);
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
