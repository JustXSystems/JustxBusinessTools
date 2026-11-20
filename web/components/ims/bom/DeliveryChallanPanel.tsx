"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormGrid, Input, Textarea } from "@/components/bos";
import { BOM_DC_STATUS_LABEL, bom, type BomDc, type BomDoc } from "@/lib/ims/bom";
import { todayLocal } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, useImsAction, useImsData, usePrint } from "../core";
import { BomSplitLayout } from "./BomSplitLayout";
import { DcPaper, type DcPaperModel } from "./DcPaper";

type RemainingLine = {
  bomLineId: string;
  description: string;
  makeText: string | null;
  unit: string;
  remainingQty: number;
  issuedQty: number;
  bomQty?: number;
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
        ? `No remaining quantity for “${line.description}” — already on a DC or issued from the BOM/invoice.`
        : `Only ${roundQty(line.remainingQty)} ${line.unit} remaining for “${line.description}”.`;
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
  selectedDcIds,
  onToggleDc,
  onOpenWorkspace,
}: {
  doc: BomDoc;
  busy: boolean;
  onDone: () => void;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onOpenWorkspace: (workspace: DcWorkspace) => void;
}) {
  const dcsState = useImsData(() => bom.listDcs(doc.id), [doc.id, doc.updatedAt, doc.stockIssuedAt, doc.stockIssueCount]);
  const remainingState = useImsData(
    () => bom.dcRemaining(doc.id),
    [doc.id, doc.updatedAt, doc.stockIssuedAt, doc.stockIssueCount, dcsState.data?.dcs?.length],
  );
  const remainingLines = remainingState.data?.lines ?? [];
  const openRemaining = remainingLines.filter((l) => l.remainingQty > 0);
  const dcs = dcsState.data?.dcs ?? [];
  const bomDocNo = dcsState.data?.bomDocNo ?? doc.docNo;
  const deliveredUnits = remainingLines.reduce((s, l) => s + (Number(l.issuedQty) || 0), 0);
  const bomUnits = remainingLines.reduce((s, l) => s + (Number(l.bomQty) || 0), 0);

  return (
    <Card className="ims-bom-action-card">
      <Alert tone="blue" title="Delivery challans (stock out)">
        Create or open a DC in Composer with a live invoice-template preview. Verify records your display name; approve posts stock out.
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
                <b style={{ fontSize: 13 }}>{dc.docNo}</b>
                <Badge tone={dc.status === "approved" ? "emerald" : dc.status === "verified" ? "blue" : dc.status === "cancelled" ? "neutral" : "amber"}>
                  {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}
                </Badge>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  {(dc.lines ?? []).reduce((s, l) => s + l.qty, 0)} units · {dc.docDate}
                </span>
                <span style={{ fontSize: 12, opacity: 0.75 }}>BOM {dc.bomDocNo ?? bomDocNo}</span>
                {dc.verifiedByName ? <span style={{ fontSize: 12, opacity: 0.75 }}>Verified by {dc.verifiedByName}</span> : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Button size="sm" onClick={() => onOpenWorkspace({ kind: "manage", dcId: dc.id })}>
                  Open
                </Button>
                {dc.status === "approved" && dc.stockPosted && !doc.invoiceId ? (
                  <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={selectedDcIds.includes(dc.id)} onChange={() => onToggleDc(dc.id)} />
                    Link on invoice
                  </label>
                ) : null}
                {dc.status === "verified" && canApprove ? (
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
      {openRemaining.length ? (
        <Button size="sm" disabled={Boolean(busy)} onClick={() => onOpenWorkspace({ kind: "create" })}>
          Create delivery challan
        </Button>
      ) : remainingState.loading && !remainingState.data ? null : remainingLines.length ? (
        <div style={{ fontSize: 13, opacity: 0.75 }}>All BOM stock quantities are on live delivery challans.</div>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75 }}>No stock-linked lines — link catalogue items on the BOM first.</div>
      )}
    </Card>
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
    if (remainingState.loading && !remainingState.data) return <LoadingBlock rows={2} />;
    if (!openRemaining.length) {
      return (
        <Card className="ims-bom-action-card">
          <Alert tone="amber" title="Nothing left to deliver">
            {doc.stockIssuedAt
              ? "Materials for this BOM are already fully issued (delivery challans or invoice). Reverse stock or cancel open DCs before creating another challan."
              : "All BOM stock quantities are already on live delivery challans."}{" "}
            <Button size="sm" variant="ghost" onClick={onBack}>
              Back to BOM
            </Button>
          </Alert>
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
            Back to BOM
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
}: {
  doc: BomDoc;
  bomDocNo: string;
  remaining: RemainingLine[];
  busy: string | null;
  run: ReturnType<typeof useImsAction>["run"];
  print: () => void;
  onBack: () => void;
  onCreated: (dcId: string) => void;
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
          ← Back to BOM
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
}) {
  const isDraft = dc.status === "draft";
  const remById = useMemo(() => new Map(remaining.map((l) => [l.bomLineId, l])), [remaining]);
  const [docDate, setDocDate] = useState(dc.docDate);
  const [shipTo, setShipTo] = useState(dc.shipTo ?? "");
  const [transporter, setTransporter] = useState(dc.transporter ?? "");
  const [vehicleNo, setVehicleNo] = useState(dc.vehicleNo ?? "");
  const [notes, setNotes] = useState(dc.notes ?? "");
  const [qtyById, setQtyById] = useState<Record<string, string>>(() =>
    Object.fromEntries((dc.lines ?? []).map((l) => [l.bomLineId, String(l.qty)])),
  );

  // When server status/revision changes (verify/approve), adopt server fields without remounting mid-edit.
  useEffect(() => {
    setDocDate(dc.docDate);
    setShipTo(dc.shipTo ?? "");
    setTransporter(dc.transporter ?? "");
    setVehicleNo(dc.vehicleNo ?? "");
    setNotes(dc.notes ?? "");
    setQtyById(Object.fromEntries((dc.lines ?? []).map((l) => [l.bomLineId, String(l.qty)])));
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
            disabled={Boolean(busy)}
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
            disabled={Boolean(busy) || !canApprove}
            title={!canApprove ? "Approvals permission required" : undefined}
            onClick={async () => {
              const out = await run("dc-approve", () => bom.approveDc(dc.id), { success: "DC approved — stock out posted" });
              if (out) onClose();
            }}
          >
            {busy === "dc-approve" ? "Approving…" : "Approve (stock out)"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={async () => {
              if (!window.confirm(`Cancel verified ${dc.docNo}?`)) return;
              const out = await run("dc-cancel", () => bom.cancelDc(dc.id), { success: "Delivery challan cancelled" });
              if (out) onClose();
            }}
          >
            Cancel DC
          </Button>
        </>
      ) : null}
      {dc.status === "approved" && dc.stockPosted ? (
        <>
          {!doc.invoiceId ? (
            <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={selectedDcIds.includes(dc.id)} onChange={() => onToggleDc(dc.id)} />
              Link on invoice
            </label>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={async () => {
              if (!window.confirm(`Reverse ${dc.docNo} and return stock?`)) return;
              const out = await run("dc-reverse", () => bom.reverseDc(dc.id), { success: "Delivery challan reversed" });
              if (out) onClose();
            }}
          >
            Reverse stock
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <div className="ims-bom-dc-workspace">
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← Back to BOM
        </button>
        <div className="ims-row" style={{ flexWrap: "wrap" }}>
          <span className="ims-strong" style={{ fontSize: 14 }}>
            {dc.docNo}
          </span>
          <Badge tone={dc.status === "approved" ? "emerald" : dc.status === "verified" ? "blue" : dc.status === "cancelled" ? "neutral" : "amber"}>
            {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}
          </Badge>
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
                        value={qtyById[line.bomLineId] ?? "0"}
                        onChange={(e) => setQtyById((prev) => ({ ...prev, [line.bomLineId]: e.target.value }))}
                        style={{ width: 120 }}
                      />
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  This challan is {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}. Use the toolbar to approve, reverse, or print — Live Preview shows the invoice-template sheet.
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
