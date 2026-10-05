"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  ApprovalRow,
  Badge,
  Button,
  DataTable,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  type BosColumn,
  type BosPastel,
} from "@/components/bos";
import { bos, type BosExpense, type BosTrip, type ExpensesAssetsOverview, type HeldAsset, type TravelMode } from "@/lib/bos-app/api";
import { dateLabel, dayMonth, expenseBadge, heldAssetBadge, inr, inrCompact, TRAVEL_MODE_LABEL, tripBadge } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, ExpenseDialog, FormDialog, useFormState, type ExpensePrefill } from "../dialogs";

type Tab = "assets" | "travel" | "claims";
type Overview = ExpensesAssetsOverview;
type Dialog =
  | { kind: "assign"; asset: HeldAsset | null }
  | { kind: "return"; asset: HeldAsset }
  | { kind: "trip"; trip: BosTrip | null }
  | { kind: "claim"; prefill?: ExpensePrefill };

const MODES: ReadonlyArray<TravelMode> = ["train", "flight", "bus", "car", "other"];
const CATEGORY_TAG: Record<string, BosPastel> = {
  "Computers & IT": "blue",
  Software: "lavender",
  Vehicles: "mint",
  "Tools & equipment": "sage",
  "Plant & machinery": "sage",
  "Renewable energy equipment": "mint",
  "Office equipment": "rose",
  "Furniture & fittings": "rose",
};

const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const tripDates = (t: Pick<BosTrip, "departOn" | "returnOn">) => (t.departOn === t.returnOn ? dateLabel(t.departOn) : `${dayMonth(t.departOn)} – ${dateLabel(t.returnOn)}`);
const holderOf = (a: HeldAsset) => a.employeeName ?? ([a.departmentName, a.location].filter(Boolean).join(" · ") || "Unassigned");

function Described({ title, sub, width = 280 }: { title: ReactNode; sub?: ReactNode; width?: number }) {
  return (
    <span style={{ display: "block", maxWidth: width }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {sub ? (
        <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/** HR → Expenses & Assets: who holds which company asset, travel requests and expense claims. Managers see the team; everyone else sees their own. */
export function ExpensesAssets() {
  const [tab, setTab] = useState<Tab>("assets");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cancelling, setCancelling] = useState<BosTrip | null>(null);
  const { run, busy } = useBosAction();
  const state = useBosData(() => bos.expensesAssets(), []);
  const close = () => setDialog(null);

  return (
    <Loaded state={state}>
      {(o) => {
        const t = o.totals;
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Assets assigned" value={String(t.assetsAssigned)} chip={{ color: "blue", glyph: "▣" }} delta={o.manager ? `${t.assetsInStore} in store` : "With you"} deltaTone="muted" />
              <KpiCard
                label="Pending travel requests"
                value={String(t.travelPending)}
                chip={{ color: "rose", glyph: "✈" }}
                delta={t.travelPending ? `Needs approval · ${inrCompact(t.travelPendingCost)}` : t.onTrip ? `${plural(t.onTrip, "person")} on a trip` : `${t.travelUpcoming} upcoming`}
                deltaTone={t.travelPending ? "warn" : "muted"}
              />
              <KpiCard label="Open expense claims" value={String(t.claimsOpen)} chip={{ color: "mint", glyph: "₹" }} delta={`${inrCompact(t.claimsOpenAmount)} total`} deltaTone="muted" />
              <KpiCard
                label="Overdue asset returns"
                value={String(t.overdueReturns)}
                chip={{ color: "lavender", glyph: "↩" }}
                delta={t.overdueReturns ? "Ex-employees" : t.returnsDue ? `${t.returnsDue} due — serving notice` : "Nothing overdue"}
                deltaTone={t.overdueReturns ? "down" : t.returnsDue ? "warn" : "muted"}
              />
            </Grid>

            <ModuleToolbar>
              <Segmented<Tab>
                size="sm"
                aria-label="Expenses & Assets view"
                options={[
                  { value: "assets", label: o.manager ? "Asset Assignment" : "My Assets" },
                  { value: "travel", label: "Travel Requests" },
                  { value: "claims", label: "Expense Claims" },
                ]}
                value={tab}
                onChange={setTab}
              />
              <span className="bos-spacer" />
              <ToolbarActions tab={tab} o={o} open={setDialog} />
            </ModuleToolbar>
            {o.truncated ? <Alert tone="amber" title="Showing the latest records">Older trips or claims aren&apos;t listed here.</Alert> : null}

            {tab === "assets" ? <AssetsTab o={o} open={setDialog} /> : null}
            {tab === "travel" ? (
              <TravelTab
                o={o}
                open={setDialog}
                cancel={setCancelling}
                decide={(trip, decision) =>
                  run(`trip-${trip.id}`, () => bos.decideTravel(trip.id, { decision }), {
                    success: decision === "approved" ? "Travel approved" : "Travel turned down",
                    tone: decision === "approved" ? "emerald" : "amber",
                    description: `${trip.employeeName} · ${trip.toPlace}`,
                  })
                }
              />
            ) : null}
            {tab === "claims" ? (
              <ClaimsTab
                o={o}
                decide={(e, decision) =>
                  run(`exp-${e.id}`, () => bos.decideExpense(e.id, decision), {
                    success: decision === "approved" ? "Claim approved" : "Claim rejected",
                    tone: decision === "approved" ? "emerald" : "amber",
                    description: e.claimantName ?? undefined,
                  })
                }
                reimburse={(e) => run(`reimb-${e.id}`, () => bos.reimburseExpense(e.id), { success: "Marked reimbursed", description: `${e.claimantName ?? ""} · ${inr(e.amount)}` })}
                busy={busy}
              />
            ) : null}

            {dialog?.kind === "assign" ? <AssignDialog o={o} asset={dialog.asset} onClose={close} /> : null}
            {dialog?.kind === "return" ? <ReturnDialog o={o} asset={dialog.asset} onClose={close} /> : null}
            {dialog?.kind === "trip" ? <TripDialog o={o} trip={dialog.trip} onClose={close} /> : null}
            {dialog?.kind === "claim" ? <ExpenseDialog open onClose={close} categories={o.categories} employees={o.manager ? o.employees : []} prefill={dialog.prefill} /> : null}
            {cancelling ? (
              <ConfirmDialog
                open
                onClose={() => setCancelling(null)}
                destructive
                title={`Cancel ${cancelling.requestNo}?`}
                description={`${cancelling.purpose} — ${cancelling.fromPlace} → ${cancelling.toPlace}, ${tripDates(cancelling)}. It stays on record as cancelled.`}
                confirmLabel="Cancel trip"
                busy={busy === "cancel-trip"}
                onConfirm={async () => {
                  const out = await run("cancel-trip", () => bos.cancelTravel(cancelling.id), { success: "Trip cancelled", description: cancelling.requestNo });
                  if (out) setCancelling(null);
                }}
              />
            ) : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function ToolbarActions({ tab, o, open }: { tab: Tab; o: Overview; open: (d: Dialog) => void }) {
  const { navigate } = useBosApp();
  if (tab === "assets") {
    if (!o.manager) return null;
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => navigate("finance", "assets")}>
          Asset register ↗
        </Button>
        <Button size="sm" variant="primary" icon="plus" disabled={!o.employees.length || !o.assets.some((a) => !a.employeeId)} onClick={() => open({ kind: "assign", asset: null })}>
          Assign asset
        </Button>
      </>
    );
  }
  if (tab === "travel") {
    const can = o.manager ? o.employees.length > 0 : Boolean(o.me);
    return (
      <Button size="sm" variant="primary" icon="plus" disabled={!can} onClick={() => open({ kind: "trip", trip: null })}>
        Request travel
      </Button>
    );
  }
  return (
    <Button size="sm" variant="primary" icon="plus" onClick={() => open({ kind: "claim" })}>
      New claim
    </Button>
  );
}

/* ---------- Tabs ---------- */

function AssetsTab({ o, open }: { o: Overview; open: (d: Dialog) => void }) {
  const { navigate } = useBosApp();
  const [show, setShow] = useState<"assigned" | "store" | "returns" | "all">("assigned");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = o.assets.filter(
    (a) =>
      (show === "all" || (show === "assigned" ? a.employeeId : show === "store" ? !a.employeeId : a.returnState)) &&
      (!q || `${a.name} ${a.tag} ${a.serialNo ?? ""} ${a.category} ${holderOf(a)}`.toLowerCase().includes(q)),
  );
  const columns: BosColumn<HeldAsset>[] = [
    { key: "item", header: "Item", cell: (a) => <Described title={a.name} sub={[a.tag, a.serialNo].filter(Boolean).join(" · ")} /> },
    { key: "to", header: "Assigned To", cell: (a) => (a.employeeId ? <Described title={a.employeeName} sub={a.employeeDesignation ?? undefined} width={220} /> : faint(holderOf(a))) },
    { key: "cat", header: "Category", cell: (a) => <Badge tag={CATEGORY_TAG[a.category] ?? "blue"}>{a.category.toUpperCase()}</Badge> },
    { key: "on", header: "Assigned On", mono: true, cell: (a) => (a.assignedOn ? dateLabel(a.assignedOn) : "—") },
    { key: "status", header: "Status", cell: (a) => <StatusBadge view={heldAssetBadge(a)} /> },
  ];
  if (o.manager) {
    columns.push({
      key: "act",
      header: "",
      align: "right",
      cell: (a) =>
        a.employeeId ? (
          <span className="bos-row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button size="sm" variant="ghost" onClick={() => open({ kind: "assign", asset: a })}>
              Reassign
            </Button>
            <Button size="sm" onClick={() => open({ kind: "return", asset: a })}>
              Return
            </Button>
          </span>
        ) : (
          <Button size="sm" disabled={!o.employees.length} onClick={() => open({ kind: "assign", asset: a })}>
            Assign
          </Button>
        ),
    });
  }

  if (!o.assets.length) {
    return o.manager ? (
      <Alert
        tone="blue"
        title="Add company assets first"
        actions={
          <Button size="sm" variant="primary" onClick={() => navigate("finance", "assets")}>
            Open Finance → Assets
          </Button>
        }
      >
        Laptops, phones, tools, vehicles and software licences are kept in the asset register in Finance → Assets. Once they&apos;re there, assign them to people here and track returns when someone leaves.
      </Alert>
    ) : (
      <Alert tone="blue" title="No company assets with you">
        Laptops, tools or devices HR assigns to you will show here.
      </Alert>
    );
  }
  return (
    <Stack>
      {o.manager ? (
        <div className="bos-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented<typeof show>
            size="sm"
            aria-label="Show assets"
            options={[
              { value: "assigned", label: "Assigned" },
              { value: "store", label: "In store" },
              { value: "returns", label: "Returns" },
              { value: "all", label: "All" },
            ]}
            value={show}
            onChange={setShow}
          />
          <SearchInput placeholder="Search item, tag or person…" aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      ) : null}
      <DataTable
        caption={o.manager ? "Asset assignment" : "Your assets"}
        columns={columns}
        rows={o.manager ? shown : o.assets}
        rowKey={(a) => a.id}
        empty={show === "returns" ? "No one has assets to hand back." : show === "store" ? "Every asset is assigned." : "No assets match."}
      />
    </Stack>
  );
}

function TravelTab({ o, open, cancel, decide }: { o: Overview; open: (d: Dialog) => void; cancel: (t: BosTrip) => void; decide: (t: BosTrip, d: "approved" | "rejected") => void }) {
  const [show, setShow] = useState<"current" | "past" | "all">("current");
  const pending = o.trips.filter((t) => t.status === "pending");
  const current = (t: BosTrip) => t.phase === "pending" || t.phase === "upcoming" || t.phase === "on_trip";
  const shown = o.trips.filter((t) => show === "all" || (show === "current" ? current(t) : !current(t)));
  if (show === "current") shown.sort((a, b) => a.departOn.localeCompare(b.departOn));
  const columns: BosColumn<BosTrip>[] = [
    { key: "req", header: "Request", cell: (t) => <Described title={t.purpose} sub={[t.requestNo, t.projectName].filter(Boolean).join(" · ")} width={240} /> },
    ...(o.manager ? [{ key: "who", header: "Traveller", cell: (t: BosTrip) => <Described title={t.employeeName} sub={t.designation ?? undefined} width={200} /> }] : []),
    { key: "route", header: "Route", cell: (t) => <Described title={`${t.fromPlace} → ${t.toPlace}`} sub={TRAVEL_MODE_LABEL[t.mode]} width={220} /> },
    { key: "dates", header: "Dates", mono: true, cell: (t) => <Described title={tripDates(t)} sub={plural(t.days, "day")} width={180} /> },
    { key: "cost", header: "Estimate", align: "right", mono: true, cell: (t) => <Described title={t.estimatedCost ? inr(t.estimatedCost) : "—"} sub={t.advance ? `Advance ${inr(t.advance)}` : undefined} width={140} /> },
    {
      key: "status",
      header: "Status",
      cell: (t) => (
        <span title={t.decisionNote ?? undefined}>
          <StatusBadge view={tripBadge(t.phase)} />
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (t) => {
        const mayEdit = t.status === "pending" && (t.mine || o.manager);
        const mayCancel = t.canCancel && (t.mine || o.manager);
        const mayClaim = t.mine && (t.phase === "on_trip" || t.phase === "completed");
        if (!mayEdit && !mayCancel && !mayClaim) return null;
        return (
          <span className="bos-row" style={{ gap: 6, justifyContent: "flex-end" }}>
            {mayCancel ? (
              <Button size="sm" variant="ghost" onClick={() => cancel(t)}>
                Cancel
              </Button>
            ) : null}
            {mayEdit ? (
              <Button size="sm" variant="ghost" onClick={() => open({ kind: "trip", trip: t })}>
                Edit
              </Button>
            ) : null}
            {mayClaim ? (
              <Button size="sm" onClick={() => open({ kind: "claim", prefill: { employeeId: o.manager ? t.employeeId : undefined, category: "Travel", description: `${t.requestNo} · ${t.purpose} (${t.fromPlace} → ${t.toPlace})`, spentOn: t.returnOn < o.today ? t.returnOn : o.today } })}>
                Claim expenses
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];
  return (
    <Stack>
      {!o.manager && !o.me ? (
        <Alert tone="amber" title="Your login isn't linked to an employee record">
          Ask HR to link it in HR → Employees, then you can request travel here.
        </Alert>
      ) : null}
      {o.manager && pending.length ? (
        <WidgetCard title="✈ Awaiting approval" dot="rose" note={plural(pending.length, "request")}>
          {pending.map((t) => (
            <ApprovalRow
              key={t.id}
              avatar={<PersonAvatar name={t.employeeName} />}
              name={`${t.employeeName} — ${t.purpose}`}
              meta={`${t.requestNo} · ${t.fromPlace} → ${t.toPlace} · ${tripDates(t)} (${plural(t.days, "day")}) · ${TRAVEL_MODE_LABEL[t.mode]}${t.advance ? ` · advance ${inr(t.advance)}` : ""}`}
              extra={t.estimatedCost ? <span className="bos-widget-value">{inr(t.estimatedCost)}</span> : undefined}
              onDecide={(d) => decide(t, d)}
            />
          ))}
        </WidgetCard>
      ) : null}
      <Segmented<typeof show>
        size="sm"
        aria-label="Show trips"
        options={[
          { value: "current", label: "Pending & upcoming" },
          { value: "past", label: "Past" },
          { value: "all", label: "All" },
        ]}
        value={show}
        onChange={setShow}
      />
      <DataTable caption="Travel requests" columns={columns} rows={shown} rowKey={(t) => t.id} empty={show === "current" ? "No trips pending or coming up." : "No travel requests yet."} />
    </Stack>
  );
}

function ClaimsTab({ o, decide, reimburse, busy }: { o: Overview; decide: (e: BosExpense, d: "approved" | "rejected") => void; reimburse: (e: BosExpense) => void; busy: string | null }) {
  const { navigate } = useBosApp();
  const submitted = o.claims.filter((e) => e.status === "submitted");
  const columns: BosColumn<BosExpense>[] = [
    { key: "spentOn", header: "Date", mono: true, cell: (e) => dateLabel(e.spentOn) },
    ...(o.manager ? [{ key: "claimant", header: "Claimant", cell: (e: BosExpense) => e.claimantName ?? "—" }] : []),
    { key: "category", header: "Category", cell: (e) => e.category },
    { key: "description", header: "Description", cell: (e) => e.description ?? faint() },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (e) => inr(e.amount) },
    { key: "status", header: "Status", cell: (e) => <StatusBadge view={expenseBadge(e.status)} /> },
  ];
  if (o.manager) {
    columns.push({
      key: "act",
      header: "",
      align: "right",
      cell: (e) =>
        e.status === "approved" ? (
          <Button size="sm" variant="success" disabled={busy !== null} onClick={() => reimburse(e)}>
            Reimburse
          </Button>
        ) : null,
    });
  }
  return (
    <Stack>
      {o.manager && submitted.length ? (
        <WidgetCard title="⏳ Claims awaiting approval" dot="rose" note={plural(submitted.length, "claim")}>
          {submitted.map((e) => (
            <ApprovalRow
              key={e.id}
              avatar={<PersonAvatar name={e.claimantName} />}
              name={e.claimantName ?? "Unknown claimant"}
              meta={`${e.category} · ${dateLabel(e.spentOn)}${e.description ? ` · ${e.description}` : ""}`}
              extra={<span className="bos-widget-value">{inr(e.amount)}</span>}
              onDecide={(d) => decide(e, d)}
            />
          ))}
        </WidgetCard>
      ) : null}
      <DataTable caption={o.manager ? "Expense claims" : "Your expense claims"} columns={columns} rows={o.claims} rowKey={(e) => e.id} empty="No expense claims yet." />
      {o.manager ? (
        <p className="bos-text-faint" style={{ margin: 0, fontSize: 12.5 }}>
          The same claims appear in{" "}
          <button type="button" className="bos-link" onClick={() => navigate("finance", "expenses")}>
            Finance → Expenses
          </button>
          , with spend by category.
        </p>
      ) : null}
    </Stack>
  );
}

/* ---------- Dialogs ---------- */

function EmployeeSelect({ o, id, value, onChange, self }: { o: Overview; id: string; value: string; onChange: (id: string) => void; self?: boolean }) {
  return (
    <Select id={id} required={!self} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{self ? "Myself" : "Pick an employee"}</option>
      {o.employees
        .filter((e) => !self || e.id !== o.me?.id)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.designation ? ` — ${e.designation}` : ""}
          </option>
        ))}
    </Select>
  );
}

function AssignDialog({ o, asset, onClose }: { o: Overview; asset: HeldAsset | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const inStore = o.assets.filter((a) => !a.employeeId);
  const f = useFormState(() => ({ assetId: asset?.id ?? "", employeeId: "", date: o.today, note: "" }));
  const v = f.values;
  const picked = asset ?? o.assets.find((a) => a.id === v.assetId) ?? null;
  const person = o.employees.find((e) => e.id === v.employeeId);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={asset ? (asset.employeeId ? `Reassign ${asset.name}` : `Assign ${asset.name}`) : "Assign an asset"}
      description={asset?.employeeId ? `Now with ${asset.employeeName}. The handover is kept in the asset's history.` : "Recorded in the asset's history in Finance → Assets."}
      icon={{ tone: "blue", name: "user" }}
      submitLabel="Assign"
      busy={busy === "assign"}
      onSubmit={async () => {
        if (!picked) return;
        const out = await run("assign", () => bos.assignAsset(picked.id, { employeeId: v.employeeId, date: v.date, note: v.note.trim() || null }), {
          success: "Asset assigned",
          description: `${picked.name} → ${person?.name ?? ""}`,
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        {!asset ? (
          <Field label="Asset" full>
            {({ id }) => (
              <Select id={id} required value={v.assetId} onChange={(e) => f.set("assetId")(e.target.value)}>
                <option value="">Pick an asset in store</option>
                {inStore.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tag} · {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Assign to">
          {({ id }) => (
            <Select id={id} required value={v.employeeId} onChange={(e) => f.set("employeeId")(e.target.value)}>
              <option value="">Pick an employee</option>
              {o.employees
                .filter((e) => e.id !== asset?.employeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Handed over on">{({ id }) => <Input id={id} type="date" required max={o.today} value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        <Field label="Note" full>
          {({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional — condition, accessories…" onChange={(e) => f.set("note")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function ReturnDialog({ o, asset, onClose }: { o: Overview; asset: HeldAsset; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ date: o.today, note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${asset.employeeName ?? "Someone"} returned ${asset.name}`}
      description="The asset goes back in store, ready to assign again."
      icon={{ tone: "emerald", name: "check" }}
      submitLabel="Record return"
      busy={busy === "return"}
      onSubmit={async () => {
        const out = await run("return", () => bos.assignAsset(asset.id, { employeeId: null, date: v.date, note: v.note.trim() || null }), { success: "Return recorded", description: `${asset.tag} · ${asset.name}` });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Returned on">{({ id }) => <Input id={id} type="date" required max={o.today} value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        <Field label="Condition">{({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional — e.g. good, charger missing" onChange={(e) => f.set("note")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

function TripDialog({ o, trip, onClose }: { o: Overview; trip: BosTrip | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    employeeId: "",
    purpose: trip?.purpose ?? "",
    fromPlace: trip?.fromPlace ?? "",
    toPlace: trip?.toPlace ?? "",
    departOn: trip?.departOn ?? o.today,
    returnOn: trip?.returnOn ?? o.today,
    mode: trip?.mode ?? ("train" as TravelMode),
    estimatedCost: trip?.estimatedCost ? String(trip.estimatedCost) : "",
    advance: trip?.advance ? String(trip.advance) : "",
    projectId: trip?.projectId ?? "",
    note: trip?.note ?? "",
  }));
  const v = f.values;
  const forOthers = o.manager && !trip;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={trip ? `Edit ${trip.requestNo}` : "Request travel"}
      description={trip ? `${trip.employeeName} · pending approval` : o.manager ? "Requests you file are ready for approval straight away." : "Your approver is notified. Once the trip is over, claim the actual spend from here."}
      icon={{ tone: "blue", glyph: "✈" }}
      submitLabel={trip ? "Save" : "Submit request"}
      busy={busy === "trip"}
      wide
      onSubmit={async () => {
        const input = {
          purpose: v.purpose.trim(),
          fromPlace: v.fromPlace.trim(),
          toPlace: v.toPlace.trim(),
          departOn: v.departOn,
          returnOn: v.returnOn,
          mode: v.mode,
          estimatedCost: num(v.estimatedCost),
          advance: num(v.advance),
          projectId: v.projectId || null,
          note: v.note.trim() || null,
        };
        const out = await run<unknown>("trip", () => (trip ? bos.updateTravel(trip.id, input) : bos.requestTravel({ ...input, employeeId: v.employeeId || null })), {
          success: trip ? "Travel request updated" : "Travel requested",
          description: `${input.fromPlace} → ${input.toPlace}`,
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        {forOthers ? <Field label="Traveller">{({ id }) => <EmployeeSelect o={o} id={id} value={v.employeeId} onChange={f.set("employeeId")} self={Boolean(o.me)} />}</Field> : null}
        <Field label="Purpose" full={!forOthers}>
          {({ id }) => <Input id={id} required maxLength={200} value={v.purpose} placeholder="e.g. Site survey — 50 kW rooftop" onChange={(e) => f.set("purpose")(e.target.value)} />}
        </Field>
        <Field label="From">{({ id }) => <Input id={id} required maxLength={120} value={v.fromPlace} placeholder="e.g. Bengaluru" onChange={(e) => f.set("fromPlace")(e.target.value)} />}</Field>
        <Field label="To">{({ id }) => <Input id={id} required maxLength={120} value={v.toPlace} placeholder="e.g. Mysuru" onChange={(e) => f.set("toPlace")(e.target.value)} />}</Field>
        <Field label="Departs">{({ id }) => <Input id={id} type="date" required value={v.departOn} onChange={(e) => f.set("departOn")(e.target.value)} />}</Field>
        <Field label="Returns">{({ id }) => <Input id={id} type="date" required min={v.departOn} value={v.returnOn} onChange={(e) => f.set("returnOn")(e.target.value)} />}</Field>
        <Field label="Travel by">
          {({ id }) => (
            <Select id={id} value={v.mode} onChange={(e) => f.set("mode")(e.target.value as TravelMode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {TRAVEL_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Project" hint={o.projects.length ? undefined : "No open projects"}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.projectId} onChange={(e) => f.set("projectId")(e.target.value)}>
              <option value="">None</option>
              {o.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Estimated cost (₹)" hint="Tickets, stay and local travel">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="1" value={v.estimatedCost} onChange={(e) => f.set("estimatedCost")(e.target.value)} />}
        </Field>
        <Field label="Advance needed (₹)" hint="Optional — up to the estimate">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="1" value={v.advance} onChange={(e) => f.set("advance")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Note">{({ id }) => <Textarea id={id} rows={2} maxLength={1000} value={v.note} placeholder="Optional — stay, client meeting, who else is going…" onChange={(e) => f.set("note")(e.target.value)} />}</Field>
    </FormDialog>
  );
}
