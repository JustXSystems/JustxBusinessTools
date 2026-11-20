"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormGrid, Input, Textarea } from "@/components/bos";
import { BOM_DC_STATUS_LABEL, bom, type BomDc, type BomDoc } from "@/lib/ims/bom";
import { isDcReturnBlocked } from "@/lib/ims/bom-dc-intent";
import { todayLocal } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, useIms, useImsAction, useImsData, usePrint } from "../core";
import { BomSplitLayout } from "./BomSplitLayout";
import { DocRefLink } from "./DocRefLink";
import { DcPaper, type DcPaperModel } from "./DcPaper";

type RemainingLine = {
  bomLineId: string;
  description: string;
  makeText: string | null;
  unit: string;
  remainingQty: number;
  issuedQty: number;
  bomQty?: number;
  committedQty?: number;
};

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Client-side BOM→DC qty/date guards (server re-checks on create/patch/verify/approve). */
function validateDcDraft(input: {
  docDate: string;
  lines: Array<{ description: string; unit: string; qty: number; remainingQty: number }>;
}): string | null {
  if (!input.docDate.trim()) return "Choose a challan date.";
  if (input.docDate > todayLocal()) return "Challan date can’t be in the future.";
  const positive = input.lines.filter((l) => l.qty > 0);
  if (!positive.length) return "Enter at least one quantity greater than zero.";
  for (const line of input.lines) {
    if (!(line.qty >= 0) || Number.isNaN(line.qty)) {
      return `Enter a valid quantity for “${line.description}”.`;
    }
    if (line.qty > line.remainingQty + 1e-9) {
      return line.remainingQty <= 0
        ? `No remaining quantity for “${line.description}” — already on a DC or issued. Increase the BOM line qty and reconfirm to deliver more.`
        : `Only ${roundQty(line.remainingQty)} ${line.unit} remaining for “${line.description}” (approved DCs cannot exceed the confirmed BOM qty).`;
    }
  }
  return null;
}

export type DcWorkspace = { kind: "create" } | { kind: "manage"; dcId: string };

/**
 * Compact list of DCs on the BOM compose rail. Create / Open hand off to
 * `DeliveryChallanWorkspace` (Composer + Live Preview + resize divider).
 */
export function DeliveryChallanPanel({
  doc,
  busy,
  onDone,
  run,
  canApprove,
  manageOnly,
  selectedDcIds,
  onToggleDc,
  invoiceLinkEditable = true,
  onOpenWorkspace,
}: {
  doc: BomDoc;
  busy: boolean;
  onDone: () => void;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  /** After qty-amend reopen — list/open/cancel only until BOM is reconfirmed. */
  manageOnly?: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  /** False when the BOM invoice is already issued (links are frozen). */
  invoiceLinkEditable?: boolean;
  onOpenWorkspace: (workspace: DcWorkspace) => void;
}) {
  const { navigate } = useIms();
  const dcsState = useImsData(() => bom.listDcs(doc.id), [doc.id, doc.updatedAt, doc.stockIssuedAt, doc.stockIssueCount]);
  const remainingState = useImsData(
    () => bom.dcRemaining(doc.id),
    [doc.id, doc.updatedAt, doc.stockIssuedAt, doc.stockIssueCount, dcsState.data?.dcs?.length],
  );
  const remainingLines = remainingState.data?.lines ?? [];
  const openRemaining = remainingLines.filter((l) => l.remainingQty > 0);
  const dcs = dcsState.data?.dcs ?? [];
  const liveDcs = dcs.filter((d) => d.status !== "cancelled");
  /** Amend is only for when live DCs block reopen — never for invoice/legacy full issue without DCs. */
  const canAmendBomForMoreDc = !manageOnly && doc.status === "confirmed" && !doc.invoiceId && liveDcs.length > 0;
  const bomDocNo = dcsState.data?.bomDocNo ?? doc.docNo;
  const deliveredUnits = remainingLines.reduce((s, l) => s + (Number(l.issuedQty) || 0), 0);
  const bomUnits = remainingLines.reduce((s, l) => s + (Number(l.bomQty) || 0), 0);

  return (
    <Card className="ims-bom-action-card">
      <Alert tone="blue" title="Delivery challans (stock out)">
        Create or open a DC in Composer with a live invoice-template preview. Verify records your display name; approve posts stock out. Verified challans also appear in Approvals.{" "}
        <Button size="sm" variant="ghost" onClick={() => navigate("bomDc")}>
          DC & Returns
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("bomDc", "returns")}>
          Returns
        </Button>
      </Alert>
      {doc.stockIssuedAt ? (
        <div style={{ marginBottom: 10 }}>
          <Badge tone="emerald">
            {doc.stockIssueCount > 0
              ? `Stock fully covered · ${doc.stockIssueCount} DC${doc.stockIssueCount === 1 ? "" : "s"} · ${doc.stockIssuedAt}`
              : `Stock issued (invoice/BOM) · ${doc.stockIssuedAt}`}
          </Badge>
        </div>
      ) : deliveredUnits > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <Badge tone="blue">
            {(() => {
              const n = doc.stockIssueCount || dcs.filter((d) => d.status === "approved").length;
              return `Partial delivery · ${deliveredUnits}${bomUnits > 0 ? ` / ${bomUnits}` : ""} units · ${n} DC${n === 1 ? "" : "s"}`;
            })()}
          </Badge>
        </div>
      ) : null}
      {dcsState.loading && !dcsState.data ? (
        <LoadingBlock rows={1} />
      ) : dcs.length ? (
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          {dcs.map((dc: BomDc) => (
            <div
              key={dc.id}
              style={{
                borderTop: "1px solid var(--bos-border, #e2e8f0)",
                paddingTop: 8,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <DocRefLink module="bomDc" intent={`open:${dc.id}`} style={{ fontSize: 13 }}>
                  {dc.docNo}
                </DocRefLink>
                <Badge tone={dc.status === "approved" ? "emerald" : dc.status === "verified" ? "blue" : dc.status === "cancelled" ? "coral" : "amber"}>
                  {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}
                </Badge>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  {(dc.lines ?? []).reduce((s, l) => s + l.qty, 0)} units · {dc.docDate}
                </span>
                <span style={{ fontSize: 12, opacity: 0.75 }}>
                  BOM{" "}
                  <DocRefLink module="bom" intent={`open:${doc.id}`}>
                    {dc.bomDocNo ?? bomDocNo}
                  </DocRefLink>
                </span>
                {dc.verifiedByName ? <span style={{ fontSize: 12, opacity: 0.75 }}>Verified by {dc.verifiedByName}</span> : null}
                {dc.invoiceLinked ? (
                  <Badge tone="amber">
                    Linked{" "}
                    {dc.invoiceId ? (
                      <DocRefLink module="sales" intent={`open:${dc.invoiceId}`}>
                        {dc.invoiceNo || (dc.invoiceStatus === "draft" ? "draft invoice" : "invoice")}
                      </DocRefLink>
                    ) : dc.invoiceNo ? (
                      `· ${dc.invoiceNo}`
                    ) : dc.invoiceStatus === "draft" ? (
                      "· draft invoice"
                    ) : (
                      "· invoice"
                    )}
                  </Badge>
                ) : null}
                {(dc.lines ?? []).some((l) => (l.returnedQty ?? 0) > 0) ? (
                  <Badge tone="amber">
                    Returned {(dc.lines ?? []).reduce((s, l) => s + (l.returnedQty ?? 0), 0)} units
                  </Badge>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Button size="sm" onClick={() => onOpenWorkspace({ kind: "manage", dcId: dc.id })}>
                  Open
                </Button>
                {dc.status === "approved" && dc.stockPosted ? (
                  <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedDcIds.includes(dc.id) || Boolean(dc.invoiceLinked && doc.invoiceId)}
                      disabled={Boolean(busy) || !invoiceLinkEditable}
                      title={!invoiceLinkEditable ? "Invoice already issued — links are frozen" : undefined}
                      onChange={() => onToggleDc(dc.id)}
                    />
                    {!invoiceLinkEditable
                      ? selectedDcIds.includes(dc.id) || dc.invoiceLinked
                        ? "Linked on invoice"
                        : "Not linked"
                      : doc.invoiceId
                        ? "Linked on invoice"
                        : "Link on invoice"}
                  </label>
                ) : null}
                {dc.status === "verified" && canApprove && !manageOnly ? (
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      const out = await run("dc-approve", () => bom.approveDc(dc.id), { success: "DC approved — stock out posted" });
                      if (out) onDone();
                    }}
                  >
                    Approve
                  </Button>
                ) : null}
                {dc.status === "verified" && manageOnly ? (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>Confirm BOM before approve</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>No delivery challans yet.</div>
      )}
      {!canApprove && dcs.some((d) => d.status === "verified") ? (
        <Alert tone="amber" title="Approvals permission needed">
          Verified DCs need Approvals to post stock out.
        </Alert>
      ) : null}
      {manageOnly ? (
        <Alert tone="amber" title="Confirm BOM to continue">
          Create and approve are locked until this BOM is confirmed again. Open a DC to cancel a draft/verified challan if needed.
        </Alert>
      ) : openRemaining.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          <Button size="sm" disabled={Boolean(busy)} onClick={() => onOpenWorkspace({ kind: "create" })}>
            Create delivery challan
          </Button>
          {canAmendBomForMoreDc ? (
            <AmendBomQtyPanel
              doc={doc}
              lines={remainingLines}
              busy={busy}
              run={run}
              onDone={onDone}
              compact
            />
          ) : null}
        </div>
      ) : remainingState.loading && !remainingState.data ? null : remainingLines.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            {doc.stockIssuedAt && !liveDcs.some((d) => d.status === "approved")
              ? "Materials are already fully issued outside delivery challans. Reverse that stock before creating a DC."
              : "All BOM stock quantities are on live delivery challans. Approved DC totals cannot exceed the confirmed BOM line qty."}
          </div>
          {canAmendBomForMoreDc ? (
            <AmendBomQtyPanel doc={doc} lines={remainingLines} busy={busy} run={run} onDone={onDone} />
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75 }}>No stock-linked lines — link catalogue items on the BOM first.</div>
      )}
    </Card>
  );
}

/**
 * Increase a confirmed BOM stock line so further DCs can be raised, then reopen as draft for reconfirm.
 * Example: BOM 100 delivered → bump to 125 → reconfirm → DC2 for the extra 25.
 */
function AmendBomQtyPanel({
  doc,
  lines,
  busy,
  run,
  onDone,
  compact,
}: {
  doc: BomDoc;
  lines: RemainingLine[];
  busy: boolean | string | null;
  run: ReturnType<typeof useImsAction>["run"];
  onDone: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const [lineId, setLineId] = useState(lines[0]?.bomLineId ?? "");
  const selected = lines.find((l) => l.bomLineId === lineId) ?? lines[0];
  const [newQty, setNewQty] = useState(selected ? String(roundQty((selected.bomQty ?? 0) + (selected.remainingQty <= 0 ? 25 : 1))) : "");

  useEffect(() => {
    if (!lines.some((l) => l.bomLineId === lineId) && lines[0]) {
      setLineId(lines[0].bomLineId);
    }
  }, [lines, lineId]);

  useEffect(() => {
    if (!selected) return;
    const floor = selected.bomQty ?? 0;
    setNewQty(String(roundQty(floor + (selected.remainingQty <= 0 ? 25 : Math.max(1, Math.ceil(floor * 0.1) || 1)))));
  }, [selected?.bomLineId, selected?.bomQty, selected?.remainingQty]);

  if (!lines.length) return null;

  if (!open) {
    return (
      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setOpen(true)}>
        Need more qty than BOM allows?
      </Button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, borderTop: compact ? "1px solid var(--bos-border, #e2e8f0)" : undefined, paddingTop: compact ? 8 : 0 }}>
      <Alert tone="amber" title="Increase BOM quantity + reconfirm">
        Delivery challans cannot exceed the confirmed BOM line qty. Raise the estimate, then Confirm again before approving the next DC.
      </Alert>
      <Field label="Stock line">
        {({ id }) => (
          <select
            id={id}
            value={selected?.bomLineId ?? ""}
            onChange={(e) => setLineId(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--bos-border, #cbd5e1)" }}
          >
            {lines.map((l) => (
              <option key={l.bomLineId} value={l.bomLineId}>
                {l.description} · BOM {l.bomQty ?? "—"} · remaining {l.remainingQty} {l.unit}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`New BOM qty${selected ? ` (${selected.unit})` : ""}`}>
        {({ id }) => (
          <Input
            id={id}
            className="ims-bom-dc-qty-input"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            inputMode="decimal"
            style={{ width: 140 }}
          />
        )}
      </Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button
          size="sm"
          variant="primary"
          disabled={Boolean(busy) || !selected}
          onClick={async () => {
            if (!selected) return;
            const qty = Number(newQty);
            const floor = selected.bomQty ?? 0;
            if (!(qty > floor + 1e-9)) {
              window.alert(`Enter a quantity higher than the current BOM qty (${floor}).`);
              return;
            }
            if (
              !window.confirm(
                `Increase “${selected.description}” from ${floor} to ${roundQty(qty)} ${selected.unit}?\n\nThe BOM will reopen as draft — confirm again before approving further delivery challans.`,
              )
            ) {
              return;
            }
            const out = await run(
              "bom-amend-qty",
              () => bom.amendLineQty(doc.id, { lineId: selected.bomLineId, qty }),
              { success: "BOM qty increased — reconfirm required" },
            );
            if (out) onDone();
          }}
        >
          {busy === "bom-amend-qty" ? "Updating…" : "Update BOM qty"}
        </Button>
        {compact ? (
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Full BOM-style Composer + Live Preview workspace for create / manage DC.
 * Save & verify keep the workspace open; create switches into manage; approve/cancel/reverse close.
 */
export function DeliveryChallanWorkspace({
  doc,
  workspace,
  busy,
  run,
  canApprove,
  selectedDcIds,
  onToggleDc,
  onBack,
  onClose,
  onCreated,
  onRefresh,
  backLabel = "Back to BOM",
  allowInvoiceLink = true,
  onOpenReturn,
  onCreateReturn,
}: {
  doc: BomDoc;
  workspace: DcWorkspace;
  busy: string | null;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onBack: () => void;
  /** Terminal actions (approve / cancel / reverse) — leave the workspace. */
  onClose: () => void;
  /** After drafting a DC — open it in manage mode. */
  onCreated: (dcId: string) => void;
  /** Soft refresh BOM after save/verify without leaving. */
  onRefresh: () => void;
  /** Nav label when leaving the workspace (BOM compose vs DC & Returns list). */
  backLabel?: string;
  /**
   * When false (DC & Returns submodule), hide the invoice-link checkbox so it
   * can’t block Return unused / Reverse. Invoice linking stays on the BOM compose rail.
   */
  allowInvoiceLink?: boolean;
  /** Open an RTN document from return history (DC & Returns submodule). */
  onOpenReturn?: (returnId: string) => void;
  /** Open create-return paper workspace for this DC. */
  onCreateReturn?: (dcId: string) => void;
}) {
  const print = usePrint();
  const excludeDcId = workspace.kind === "manage" ? workspace.dcId : undefined;
  const remainingState = useImsData(
    () => bom.dcRemaining(doc.id, excludeDcId),
    [doc.id, doc.updatedAt, doc.stockIssuedAt, doc.stockIssueCount, excludeDcId],
  );
  const remainingLines = remainingState.data?.lines ?? [];
  const openRemaining = remainingLines.filter((l) => l.remainingQty > 0);
  const bomDocNo = doc.docNo;

  if (remainingState.error) return <ErrorBlock error={remainingState.error} onRetry={remainingState.reload} />;

  if (workspace.kind === "create") {
    if (doc.status !== "confirmed") {
      return (
        <Card className="ims-bom-action-card">
          <Alert tone="amber" title="Confirm BOM first">
            Delivery challans can only be created on a confirmed BOM.{" "}
            <Button size="sm" variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
          </Alert>
        </Card>
      );
    }
    if (remainingState.loading && !remainingState.data) return <LoadingBlock rows={2} />;
    if (!openRemaining.length) {
      const hasLiveDcCommit = remainingLines.some((l) => (l.committedQty ?? 0) > 0);
      const canAmendBomForMoreDc = doc.status === "confirmed" && !doc.invoiceId && hasLiveDcCommit;
      return (
        <Card className="ims-bom-action-card">
          <Alert tone="amber" title="Nothing left to deliver">
            {doc.stockIssuedAt && !hasLiveDcCommit
              ? "Materials for this BOM are already fully issued outside delivery challans. Reverse that stock before creating another challan."
              : doc.stockIssuedAt
                ? "Materials for this BOM are fully covered by delivery challans. Return unused stock, or increase the BOM qty and reconfirm before creating another challan."
                : "All BOM stock quantities are already on live delivery challans. Approved DC totals cannot exceed the confirmed BOM line qty."}
          </Alert>
          {canAmendBomForMoreDc ? (
            <AmendBomQtyPanel
              doc={doc}
              lines={remainingLines}
              busy={busy}
              run={run}
              onDone={() => {
                onRefresh();
                onBack();
              }}
            />
          ) : null}
          <Button size="sm" variant="ghost" onClick={onBack}>
            {backLabel}
          </Button>
        </Card>
      );
    }
    return (
      <DcEditorForm
        doc={doc}
        bomDocNo={bomDocNo}
        remaining={openRemaining}
        busy={busy}
        run={run}
        print={print}
        onBack={onBack}
        onCreated={onCreated}
        backLabel={backLabel}
      />
    );
  }

  return (
    <DcManagerLoader
      doc={doc}
      bomDocNo={bomDocNo}
      dcId={workspace.dcId}
      remaining={remainingLines}
      remainingLoading={remainingState.loading && !remainingState.data}
      busy={busy}
      run={run}
      canApprove={canApprove}
      selectedDcIds={selectedDcIds}
      onToggleDc={onToggleDc}
      onBack={onBack}
      onClose={onClose}
      onRefresh={onRefresh}
      print={print}
      backLabel={backLabel}
      allowInvoiceLink={allowInvoiceLink}
      onOpenReturn={onOpenReturn}
      onCreateReturn={onCreateReturn}
    />
  );
}

function DcManagerLoader({
  doc,
  bomDocNo,
  dcId,
  remaining,
  remainingLoading,
  busy,
  run,
  canApprove,
  selectedDcIds,
  onToggleDc,
  onBack,
  onClose,
  onRefresh,
  print,
  backLabel,
  allowInvoiceLink,
  onOpenReturn,
  onCreateReturn,
}: {
  doc: BomDoc;
  bomDocNo: string;
  dcId: string;
  remaining: RemainingLine[];
  remainingLoading: boolean;
  busy: string | null;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  onRefresh: () => void;
  print: () => void;
  backLabel: string;
  allowInvoiceLink: boolean;
  onOpenReturn?: (returnId: string) => void;
  onCreateReturn?: (dcId: string) => void;
}) {
  // Load the DC directly — avoids false "not found" while the BOM DC list is still fetching.
  const dcState = useImsData(() => bom.getDc(dcId), [dcId, doc.updatedAt, doc.stockIssuedAt]);
  if (dcState.error) return <ErrorBlock error={dcState.error} onRetry={dcState.reload} />;
  if (dcState.loading && !dcState.data) return <LoadingBlock rows={2} />;
  const dc = dcState.data?.dc ?? null;
  if (!dc) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Delivery challan not found">
          It may have been removed.{" "}
          <Button size="sm" variant="ghost" onClick={onBack}>
            {backLabel}
          </Button>
        </Alert>
      </Card>
    );
  }
  if (remainingLoading) return <LoadingBlock rows={2} />;

  return (
    <DcManagerForm
      doc={doc}
      bomDocNo={bomDocNo}
      dc={dc}
      remaining={remaining}
      busy={busy}
      run={run}
      canApprove={canApprove}
      selectedDcIds={selectedDcIds}
      onToggleDc={onToggleDc}
      onBack={onBack}
      onClose={onClose}
      onRefresh={() => {
        dcState.reload();
        onRefresh();
      }}
      print={print}
      backLabel={backLabel}
      allowInvoiceLink={allowInvoiceLink}
      onOpenReturn={onOpenReturn}
      onCreateReturn={onCreateReturn}
    />
  );
}

function DcLivePreview({ model }: { model: DcPaperModel }) {
  return (
    <>
      <div className="ims-bom-preview-toolbar" role="group" aria-label="Preview mode">
        <span className="ims-bom-preview-label">Live Preview</span>
        <Badge tag="mint">DELIVERY CHALLAN</Badge>
      </div>
      <DcPaper model={model} />
    </>
  );
}

function DcEditorForm({
  doc,
  bomDocNo,
  remaining,
  busy,
  run,
  print,
  onBack,
  onCreated,
  backLabel,
}: {
  doc: BomDoc;
  bomDocNo: string;
  remaining: RemainingLine[];
  busy: string | null;
  run: ReturnType<typeof useImsAction>["run"];
  print: () => void;
  onBack: () => void;
  onCreated: (dcId: string) => void;
  backLabel: string;
}) {
  const remainingKey = remaining.map((l) => l.bomLineId).join(",");
  const [docDate, setDocDate] = useState(todayLocal());
  const [shipTo, setShipTo] = useState("");
  const [transporter, setTransporter] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");
  const [qtyById, setQtyById] = useState<Record<string, string>>(() =>
    Object.fromEntries(remaining.map((l) => [l.bomLineId, String(l.remainingQty)])),
  );

  useEffect(() => {
    setQtyById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const line of remaining) {
        if (next[line.bomLineId] === undefined) {
          next[line.bomLineId] = String(line.remainingQty);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // remainingKey tracks line identity; remaining values used only to seed missing keys.
  }, [remaining, remainingKey]);

  const paperLines = useMemo(
    () =>
      remaining
        .map((line) => {
          const qty = Math.min(Math.max(0, Number(qtyById[line.bomLineId] ?? line.remainingQty) || 0), line.remainingQty);
          return { description: line.description, makeText: line.makeText, qty, unit: line.unit, remarks: null as string | null };
        })
        .filter((l) => l.qty > 0),
    [remaining, qtyById],
  );

  const model: DcPaperModel = {
    docNo: "DC/…",
    docDate,
    status: "draft",
    bomDocNo,
    quotationRef: doc.quotationRef,
    projectRef: doc.projectRef,
    customerName: doc.customerName,
    location: doc.location,
    shipTo: shipTo.trim() || null,
    transporter: transporter.trim() || null,
    vehicleNo: vehicleNo.trim() || null,
    notes: notes.trim() || null,
    verifiedByName: null,
    lines: paperLines,
  };

  const save = async () => {
    const parsed = remaining.map((line) => {
      const raw = Number(qtyById[line.bomLineId] ?? line.remainingQty);
      const qty = Number.isFinite(raw) ? Math.max(0, raw) : NaN;
      return {
        bomLineId: line.bomLineId,
        description: line.description,
        unit: line.unit,
        qty,
        remainingQty: line.remainingQty,
      };
    });
    const err = validateDcDraft({ docDate, lines: parsed });
    if (err) {
      window.alert(err);
      return;
    }
    const lines = parsed.filter((l) => l.qty > 0).map((l) => ({ bomLineId: l.bomLineId, qty: l.qty }));
    const out = await run(
      "dc-create",
      () =>
        bom.createDc(doc.id, {
          docDate,
          shipTo: shipTo.trim() || null,
          transporter: transporter.trim() || null,
          vehicleNo: vehicleNo.trim() || null,
          notes: notes.trim() || null,
          lines,
        }),
      { success: "Delivery challan drafted" },
    );
    if (out?.dc?.id) onCreated(out.dc.id);
  };

  return (
    <div className="ims-bom-dc-workspace">
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="ims-row" style={{ flexWrap: "wrap" }}>
          <span className="ims-strong" style={{ fontSize: 14 }}>
            New delivery challan
          </span>
          <Button size="sm" icon="printer" onClick={print}>
            Print
          </Button>
          <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={save}>
            {busy === "dc-create" ? "Saving…" : "Save draft DC"}
          </Button>
        </div>
      </div>
      <BomSplitLayout
        compose={
          <div className="ims-bom-dc-compose">
            <Card className="ims-bom-action-card">
              <Alert tone="blue" title="Composer">
                Edit quantities and dispatch details. Live Preview updates on the invoice paper template — BOM reference {bomDocNo} prints on the sheet; Verified by fills when you verify.
              </Alert>
              <FormGrid>
                <Field label="Challan date">
                  {({ id }) => (
                    <Input id={id} type="date" value={docDate} max={todayLocal()} onChange={(e) => setDocDate(e.target.value)} />
                  )}
                </Field>
                <Field label="Ship to / consignee">
                  {({ id }) => <Input id={id} value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder="Delivery address" />}
                </Field>
                <Field label="Transporter">
                  {({ id }) => <Input id={id} value={transporter} onChange={(e) => setTransporter(e.target.value)} />}
                </Field>
                <Field label="Vehicle no.">
                  {({ id }) => <Input id={id} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />}
                </Field>
              </FormGrid>
              <Field label="Notes">
                {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Quantities</div>
              {remaining.map((line) => (
                <div key={line.bomLineId} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    {line.description}{" "}
                    <span style={{ opacity: 0.65 }}>
                      · remaining {line.remainingQty} {line.unit}
                      {line.issuedQty > 0 ? ` (delivered ${line.issuedQty})` : ""}
                    </span>
                  </div>
                  <Input
                    className="ims-bom-dc-qty-input"
                    value={qtyById[line.bomLineId] ?? String(line.remainingQty)}
                    onChange={(e) => setQtyById((prev) => ({ ...prev, [line.bomLineId]: e.target.value }))}
                    placeholder="Qty"
                    style={{ width: 120 }}
                  />
                </div>
              ))}
            </Card>
          </div>
        }
        preview={<DcLivePreview model={model} />}
      />
    </div>
  );
}

function DcManagerForm({
  doc,
  bomDocNo,
  dc,
  remaining,
  busy,
  run,
  canApprove,
  selectedDcIds,
  onToggleDc,
  onBack,
  onClose,
  onRefresh,
  print,
  backLabel,
  allowInvoiceLink,
  onOpenReturn,
  onCreateReturn,
}: {
  doc: BomDoc;
  bomDocNo: string;
  dc: BomDc;
  remaining: RemainingLine[];
  busy: string | null;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  onRefresh: () => void;
  print: () => void;
  backLabel: string;
  allowInvoiceLink: boolean;
  onOpenReturn?: (returnId: string) => void;
  onCreateReturn?: (dcId: string) => void;
}) {
  const { navigate, can } = useIms();
  const isDraft = dc.status === "draft";
  const remById = useMemo(() => new Map(remaining.map((l) => [l.bomLineId, l])), [remaining]);
  /** Always honour server invoiceLinked; Builder also blocks while ticked for “Link on invoice”. */
  const returnBlockedByInvoice = isDcReturnBlocked(dc, { allowInvoiceLink, selectedDcIds });
  const canReturnStock = can("approvals") || can("stockOut");
  const stillOutUnits = (dc.lines ?? []).reduce((s, l) => s + (l.netQty ?? Math.max(0, l.qty - (l.returnedQty ?? 0))), 0);
  const fullyReturned = dc.status === "approved" && dc.stockPosted && stillOutUnits <= 1e-9;
  const [docDate, setDocDate] = useState(dc.docDate);
  const [shipTo, setShipTo] = useState(dc.shipTo ?? "");
  const [transporter, setTransporter] = useState(dc.transporter ?? "");
  const [vehicleNo, setVehicleNo] = useState(dc.vehicleNo ?? "");
  const [notes, setNotes] = useState(dc.notes ?? "");
  const [qtyById, setQtyById] = useState<Record<string, string>>(() =>
    Object.fromEntries((dc.lines ?? []).map((l) => [l.bomLineId, String(l.qty)])),
  );
  const [returnMode, setReturnMode] = useState(false);
  const [returnNotes, setReturnNotes] = useState("");
  const [returnQtyByLineId, setReturnQtyByLineId] = useState<Record<string, string>>({});

  // When server status/revision changes (verify/approve), adopt server fields without remounting mid-edit.
  useEffect(() => {
    setDocDate(dc.docDate);
    setShipTo(dc.shipTo ?? "");
    setTransporter(dc.transporter ?? "");
    setVehicleNo(dc.vehicleNo ?? "");
    setNotes(dc.notes ?? "");
    setQtyById(Object.fromEntries((dc.lines ?? []).map((l) => [l.bomLineId, String(l.qty)])));
    setReturnMode(false);
    setReturnNotes("");
    setReturnQtyByLineId({});
  }, [dc.id, dc.status, dc.updatedAt]); // lines intentionally omitted — tied to updatedAt

  const editableLines = useMemo(() => {
    return (dc.lines ?? []).map((l) => {
      const rem = remById.get(l.bomLineId);
      // remaining API already excludes this DC, so remainingQty is the max this draft may keep/raise to.
      const available = rem ? rem.remainingQty : l.qty;
      return {
        bomLineId: l.bomLineId,
        description: l.description,
        makeText: l.makeText,
        unit: l.unit,
        // Keep current qty editable even if concurrent commits temporarily shrink remaining.
        remainingQty: roundQty(Math.max(available, l.qty)),
        issuedQty: rem?.issuedQty ?? 0,
      };
    });
  }, [dc.lines, remById]);

  const paperLines = useMemo(() => {
    if (!isDraft) {
      return (dc.lines ?? []).map((l) => ({
        description: l.description,
        makeText: l.makeText,
        qty: l.qty,
        unit: l.unit,
        remarks: l.remarks,
      }));
    }
    return editableLines
      .map((line) => {
        const qty = Math.min(Math.max(0, Number(qtyById[line.bomLineId] ?? 0) || 0), line.remainingQty);
        return {
          description: line.description,
          makeText: line.makeText,
          qty,
          unit: line.unit,
          remarks: (dc.lines ?? []).find((l) => l.bomLineId === line.bomLineId)?.remarks ?? null,
        };
      })
      .filter((l) => l.qty > 0);
  }, [isDraft, dc.lines, editableLines, qtyById]);

  const model: DcPaperModel = {
    docNo: dc.docNo,
    docDate: isDraft ? docDate : dc.docDate,
    status: dc.status,
    bomDocNo: dc.bomDocNo ?? bomDocNo,
    quotationRef: dc.quotationRef ?? doc.quotationRef,
    projectRef: doc.projectRef,
    customerName: dc.customerName ?? doc.customerName,
    location: doc.location,
    shipTo: isDraft ? shipTo.trim() || null : dc.shipTo,
    transporter: isDraft ? transporter.trim() || null : dc.transporter,
    vehicleNo: isDraft ? vehicleNo.trim() || null : dc.vehicleNo,
    notes: isDraft ? notes.trim() || null : dc.notes,
    verifiedByName: dc.verifiedByName,
    approvedByName: dc.approvedByName,
    lines: paperLines,
  };

  const persist = () => {
    const parsed = editableLines.map((line) => {
      const raw = Number(qtyById[line.bomLineId] ?? 0);
      const qty = Number.isFinite(raw) ? Math.max(0, raw) : NaN;
      return {
        bomLineId: line.bomLineId,
        description: line.description,
        unit: line.unit,
        qty,
        remainingQty: line.remainingQty,
      };
    });
    const err = validateDcDraft({ docDate, lines: parsed });
    if (err) {
      window.alert(err);
      return null;
    }
    return {
      docDate,
      shipTo: shipTo.trim() || null,
      transporter: transporter.trim() || null,
      vehicleNo: vehicleNo.trim() || null,
      notes: notes.trim() || null,
      lines: parsed.filter((l) => l.qty > 0).map((l) => ({ bomLineId: l.bomLineId, qty: l.qty })),
    };
  };

  const save = async () => {
    const body = persist();
    if (!body) return;
    const out = await run("dc-update", () => bom.updateDc(dc.id, body), { success: "Delivery challan updated" });
    if (out) onRefresh();
  };

  const actions = (
    <>
      {isDraft ? (
        <>
          <Button size="sm" disabled={Boolean(busy)} onClick={save}>
            {busy === "dc-update" ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={Boolean(busy) || doc.status !== "confirmed"}
            title={doc.status !== "confirmed" ? "Confirm the BOM before verifying this delivery challan" : undefined}
            onClick={async () => {
              const body = persist();
              if (!body) return;
              const saved = await run("dc-update", () => bom.updateDc(dc.id, body), { success: "Delivery challan saved" });
              if (!saved) return;
              const out = await run("dc-verify", () => bom.verifyDc(dc.id), { success: "Delivery challan verified" });
              if (out) onRefresh();
            }}
          >
            {busy === "dc-verify" ? "Verifying…" : "Verify"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={async () => {
              if (!window.confirm(`Cancel ${dc.docNo}?`)) return;
              const out = await run("dc-cancel", () => bom.cancelDc(dc.id), { success: "Delivery challan cancelled" });
              if (out) onClose();
            }}
          >
            Cancel DC
          </Button>
        </>
      ) : null}
      {dc.status === "verified" ? (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={Boolean(busy) || !canApprove || doc.status !== "confirmed"}
            title={
              doc.status !== "confirmed"
                ? "Confirm the BOM before approving this delivery challan"
                : !canApprove
                  ? "Approvals permission required"
                  : undefined
            }
            onClick={async () => {
              const out = await run("dc-approve", () => bom.approveDc(dc.id), { success: "DC approved — stock out posted" });
              if (out) onClose();
            }}
          >
            {busy === "dc-approve" ? "Approving…" : "Approve (stock out)"}
          </Button>
          {canApprove ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                if (!window.confirm(`Reject verified ${dc.docNo}? It will return to cancelled without posting stock.`)) return;
                const out = await run("dc-reject", () => bom.rejectDc(dc.id), { success: "Delivery challan rejected" });
                if (out) onClose();
              }}
            >
              Reject
            </Button>
          ) : (
            <span style={{ fontSize: 12, opacity: 0.75 }}>Approvals permission required to reject</span>
          )}
        </>
      ) : null}
      {dc.status === "approved" && dc.stockPosted ? (
        <>
          {allowInvoiceLink ? (
            <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selectedDcIds.includes(dc.id)}
                disabled={Boolean(busy) || dc.invoiceStatus === "issued"}
                title={dc.invoiceStatus === "issued" ? "Issued invoice — unlink only after cancelling the invoice" : undefined}
                onChange={() => onToggleDc(dc.id)}
              />
              {doc.invoiceId ? "Linked on invoice" : "Link on invoice"}
            </label>
          ) : null}
          {returnBlockedByInvoice ? (
            <span style={{ fontSize: 12, opacity: 0.75, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {dc.invoiceLinked
                ? dc.invoiceStatus === "issued"
                  ? `Linked to issued ${dc.invoiceNo || "invoice"} — cancel that invoice before return/reverse`
                  : `Linked to draft invoice${dc.invoiceNo ? ` ${dc.invoiceNo}` : ""} — unlink before return/reverse`
                : "Untick “Link on invoice” before return/reverse"}
              {dc.invoiceId ? (
                <Button size="sm" variant="ghost" onClick={() => navigate("sales", `open:${dc.invoiceId}`)}>
                  Open invoice
                </Button>
              ) : null}
            </span>
          ) : !canReturnStock ? (
            <span style={{ fontSize: 12, opacity: 0.75 }}>Approvals or Stock out permission required to return / reverse</span>
          ) : (
            <>
              {!fullyReturned ? (
                onCreateReturn ? (
                  <Button size="sm" disabled={Boolean(busy)} onClick={() => onCreateReturn(dc.id)}>
                    Return unused
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (!allowInvoiceLink) {
                        navigate("bomDc", `new-return:${dc.id}`);
                        return;
                      }
                      setReturnMode((v) => !v);
                    }}
                  >
                    {returnMode ? "Hide return" : "Return unused"}
                  </Button>
                )
              ) : (
                <Badge tone="amber">Fully returned</Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const msg = fullyReturned
                    ? `Cancel fully returned ${dc.docNo}? It will move to cancelled (no further stock movement).`
                    : `Reverse remaining stock on ${dc.docNo}? Partial returns already recorded stay in history.`;
                  if (!window.confirm(msg)) return;
                  const out = await run("dc-reverse", () => bom.reverseDc(dc.id), {
                    success: fullyReturned ? "Delivery challan cancelled" : "Delivery challan reversed",
                  });
                  if (out) onClose();
                }}
              >
                {fullyReturned ? "Cancel DC" : "Reverse remaining"}
              </Button>
            </>
          )}
        </>
      ) : null}
      {dc.status === "cancelled" ? (
        <span style={{ fontSize: 12, opacity: 0.75 }}>Cancelled — print only. Create a new challan if materials still need to go out.</span>
      ) : null}
    </>
  );

  const submitReturn = async () => {
    const lines = (dc.lines ?? [])
      .map((l) => {
        const qty = Number(returnQtyByLineId[l.id] ?? 0) || 0;
        return { dcLineId: l.id, qty, max: Math.max(0, l.netQty ?? l.qty - (l.returnedQty ?? 0)), description: l.description, unit: l.unit };
      })
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      window.alert("Enter at least one return quantity.");
      return;
    }
    for (const line of lines) {
      if (line.qty > line.max + 1e-9) {
        window.alert(`Only ${line.max} ${line.unit} can still be returned for “${line.description}”.`);
        return;
      }
    }
    const out = await run(
      "dc-return",
      () =>
        bom.returnDc(dc.id, {
          notes: returnNotes.trim() || null,
          lines: lines.map((l) => ({ dcLineId: l.dcLineId, qty: l.qty })),
        }),
      { success: "Unused materials returned to stock", description: "RTN document is under DC & Returns → Returns" },
    );
    if (out) {
      setReturnMode(false);
      setReturnNotes("");
      setReturnQtyByLineId({});
      onRefresh();
      const posted = out.return;
      if (posted?.id && onOpenReturn) {
        if (window.confirm(`Return ${posted.returnNo} posted. Open it now?`)) onOpenReturn(posted.id);
      } else if (posted?.returnNo) {
        window.alert(`Return ${posted.returnNo} posted. Find it under DC & Returns → Returns.`);
      }
    }
  };

  return (
    <div className="ims-bom-dc-workspace">
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="ims-row" style={{ flexWrap: "wrap" }}>
          <span className="ims-strong" style={{ fontSize: 14 }}>
            {dc.docNo}
          </span>
          <Badge tone={dc.status === "approved" ? "emerald" : dc.status === "verified" ? "blue" : dc.status === "cancelled" ? "coral" : "amber"}>
            {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}
          </Badge>
          {dc.invoiceLinked ? (
            <Badge tone="amber">
              Linked {dc.invoiceNo ? `· ${dc.invoiceNo}` : dc.invoiceStatus === "draft" ? "· draft" : ""}
            </Badge>
          ) : null}
          {fullyReturned ? <Badge tone="amber">Fully returned</Badge> : null}
          <Button size="sm" icon="printer" onClick={print}>
            Print
          </Button>
          {actions}
        </div>
      </div>
      <BomSplitLayout
        compose={
          <div className="ims-bom-dc-compose">
            <Card className="ims-bom-action-card">
              <Alert tone="blue" title="Composer">
                BOM reference <b>{dc.bomDocNo ?? bomDocNo}</b>
                {dc.verifiedByName ? (
                  <>
                    {" "}
                    · Verified by <b>{dc.verifiedByName}</b>
                  </>
                ) : (
                  " · Verify records your display name on the sheet"
                )}
                {dc.approvedByName ? (
                  <>
                    {" "}
                    · Approved by <b>{dc.approvedByName}</b>
                  </>
                ) : null}
              </Alert>
              {isDraft ? (
                <>
                  <FormGrid>
                    <Field label="Challan date">
                      {({ id }) => (
                        <Input id={id} type="date" value={docDate} max={todayLocal()} onChange={(e) => setDocDate(e.target.value)} />
                      )}
                    </Field>
                    <Field label="Ship to / consignee">
                      {({ id }) => <Input id={id} value={shipTo} onChange={(e) => setShipTo(e.target.value)} />}
                    </Field>
                    <Field label="Transporter">
                      {({ id }) => <Input id={id} value={transporter} onChange={(e) => setTransporter(e.target.value)} />}
                    </Field>
                    <Field label="Vehicle no.">
                      {({ id }) => <Input id={id} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />}
                    </Field>
                  </FormGrid>
                  <Field label="Notes">
                    {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
                  </Field>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Quantities</div>
                  {editableLines.map((line) => (
                    <div key={line.bomLineId} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        {line.description}{" "}
                        <span style={{ opacity: 0.65 }}>
                          · max {line.remainingQty} {line.unit}
                        </span>
                      </div>
                      <Input
                        className="ims-bom-dc-qty-input"
                        value={qtyById[line.bomLineId] ?? "0"}
                        onChange={(e) => setQtyById((prev) => ({ ...prev, [line.bomLineId]: e.target.value }))}
                        style={{ width: 120 }}
                      />
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    {dc.status === "cancelled"
                      ? "This challan is cancelled. Quantities below are historical; stock was never posted or has already been reversed."
                      : dc.status === "verified"
                        ? "Verified — approve to post stock out, or reject to cancel without moving stock."
                        : fullyReturned
                          ? "All delivered quantities have been returned. You can cancel the challan or print the record."
                          : "Approved — return unused materials still out at site, reverse remaining stock, or print."}
                  </div>
                  {returnBlockedByInvoice && dc.status === "approved" ? (
                    <Alert tone="amber" title={dc.invoiceLinked ? "Linked to an invoice" : "Selected for invoice link"}>
                      {dc.invoiceLinked ? (
                        <>
                          {dc.invoiceStatus === "issued" ? (
                            <>
                              This challan is linked to issued invoice <b>{dc.invoiceNo || "—"}</b>. Cancel that invoice first (stock stays on
                              the DC), then return unused materials or reverse.
                            </>
                          ) : (
                            <>
                              Unlink this delivery challan from the draft invoice
                              {dc.invoiceNo ? (
                                <>
                                  {" "}
                                  <b>{dc.invoiceNo}</b>
                                </>
                              ) : null}{" "}
                              before returning unused stock or reversing.
                            </>
                          )}
                          {dc.invoiceId ? (
                            <>
                              {" "}
                              <Button size="sm" variant="ghost" onClick={() => navigate("sales", `open:${dc.invoiceId}`)}>
                                Open invoice
                              </Button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>Untick “Link on invoice” in the toolbar before returning unused stock or reversing.</>
                      )}
                    </Alert>
                  ) : null}
                  {(dc.lines ?? []).map((line) => (
                    <div key={line.id} style={{ fontSize: 13, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                      {line.description}{" "}
                      <span style={{ opacity: 0.7 }}>
                        · delivered {line.qty} {line.unit}
                        {(line.returnedQty ?? 0) > 0 ? ` · returned ${line.returnedQty} · still out ${line.netQty}` : ""}
                      </span>
                    </div>
                  ))}
                  {returnMode && !returnBlockedByInvoice && !fullyReturned && dc.status === "approved" && dc.stockPosted ? (
                    <Card className="ims-bom-action-card">
                      <Alert tone="amber" title="Return unused to store">
                        Stock is received back against <b>{dc.docNo}</b>. Enter only unused quantities still out at site.
                      </Alert>
                      <Field label="Return notes">
                        {({ id }) => <Textarea id={id} rows={2} value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />}
                      </Field>
                      {(dc.lines ?? [])
                        .filter((l) => (l.netQty ?? l.qty - (l.returnedQty ?? 0)) > 0)
                        .map((line) => {
                          const max = Math.max(0, line.netQty ?? line.qty - (line.returnedQty ?? 0));
                          return (
                            <div key={line.id} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                              <div style={{ fontSize: 13 }}>
                                {line.description}{" "}
                                <span style={{ opacity: 0.65 }}>
                                  · returnable {max} {line.unit}
                                </span>
                              </div>
                              <Input
                                className="ims-bom-dc-qty-input"
                                value={returnQtyByLineId[line.id] ?? ""}
                                onChange={(e) => setReturnQtyByLineId((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                placeholder="0"
                                style={{ width: 120 }}
                              />
                            </div>
                          );
                        })}
                      <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={submitReturn}>
                        {busy === "dc-return" ? "Returning…" : "Post return to stock"}
                      </Button>
                    </Card>
                  ) : null}
                  {(dc.returns ?? []).length ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div className="ims-between" style={{ alignItems: "baseline" }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Return history</div>
                        <Button size="sm" variant="ghost" onClick={() => navigate("bomDc", "returns")}>
                          All returns
                        </Button>
                      </div>
                      {(dc.returns ?? []).map((rtn) => (
                        <div key={rtn.id} style={{ fontSize: 12, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 6 }}>
                          <div className="ims-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <span>
                              <b>{rtn.returnNo}</b> · {rtn.returnDate}
                              {rtn.createdByName ? ` · ${rtn.createdByName}` : ""}
                            </span>
                            {onOpenReturn ? (
                              <Button size="sm" variant="ghost" onClick={() => onOpenReturn(rtn.id)}>
                                Open
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => navigate("bomDc", `return:${rtn.id}`)}>
                                Open
                              </Button>
                            )}
                          </div>
                          <div style={{ opacity: 0.75 }}>
                            {rtn.lines.map((l) => `${l.description}: ${l.qty} ${l.unit}`).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          </div>
        }
        preview={<DcLivePreview model={model} />}
      />
    </div>
  );
}
