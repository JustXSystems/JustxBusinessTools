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
};

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
  const dcsState = useImsData(() => bom.listDcs(doc.id), [doc.id, doc.updatedAt, doc.stockIssuedAt]);
  const remainingState = useImsData(() => bom.dcRemaining(doc.id), [doc.id, doc.updatedAt, doc.stockIssuedAt, dcsState.data?.dcs?.length]);
  const remainingLines = remainingState.data?.lines ?? [];
  const openRemaining = remainingLines.filter((l) => l.remainingQty > 0);
  const dcs = dcsState.data?.dcs ?? [];
  const bomDocNo = dcsState.data?.bomDocNo ?? doc.docNo;

  return (
    <Card className="ims-bom-action-card">
      <Alert tone="blue" title="Delivery challans (stock out)">
        Create or open a DC in Composer with a live invoice-template preview. Verify records your display name; approve posts stock out.
      </Alert>
      {doc.stockIssuedAt ? (
        <div style={{ marginBottom: 10 }}>
          <Badge tone="emerald">
            Stock fully covered · {doc.stockIssueCount} DC{doc.stockIssueCount === 1 ? "" : "s"} · {doc.stockIssuedAt}
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
                    disabled={busy}
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
        <Button size="sm" disabled={busy} onClick={() => onOpenWorkspace({ kind: "create" })}>
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

/** Full BOM-style Composer + Live Preview workspace for create / manage DC. */
export function DeliveryChallanWorkspace({
  doc,
  workspace,
  busy,
  run,
  canApprove,
  selectedDcIds,
  onToggleDc,
  onBack,
  onDone,
}: {
  doc: BomDoc;
  workspace: DcWorkspace;
  busy: boolean;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const print = usePrint();
  const excludeDcId = workspace.kind === "manage" ? workspace.dcId : undefined;
  const dcsState = useImsData(() => bom.listDcs(doc.id), [doc.id, doc.updatedAt, doc.stockIssuedAt]);
  const remainingState = useImsData(() => bom.dcRemaining(doc.id, excludeDcId), [doc.id, doc.updatedAt, doc.stockIssuedAt, excludeDcId]);
  const remainingLines = remainingState.data?.lines ?? [];
  const openRemaining = remainingLines.filter((l) => l.remainingQty > 0);
  const bomDocNo = dcsState.data?.bomDocNo ?? doc.docNo;
  const dcs = dcsState.data?.dcs ?? [];

  if (dcsState.error) return <ErrorBlock error={dcsState.error} onRetry={dcsState.reload} />;
  if (remainingState.error) return <ErrorBlock error={remainingState.error} onRetry={remainingState.reload} />;

  if (workspace.kind === "create") {
    if (remainingState.loading && !remainingState.data) return <LoadingBlock rows={2} />;
    if (!openRemaining.length) {
      return (
        <Card className="ims-bom-action-card">
          <Alert tone="amber" title="Nothing left to deliver">
            All BOM stock quantities are already on live delivery challans.{" "}
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
        onSaved={onDone}
      />
    );
  }

  if (dcsState.loading && !dcsState.data) return <LoadingBlock rows={2} />;

  const dc = dcs.find((d) => d.id === workspace.dcId) ?? null;
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

  if (remainingState.loading && !remainingState.data) return <LoadingBlock rows={2} />;

  return (
    <DcManagerForm
      key={`${dc.id}:${dc.updatedAt ?? ""}:${dc.status}`}
      doc={doc}
      bomDocNo={bomDocNo}
      dc={dc}
      remaining={remainingLines}
      busy={busy}
      run={run}
      canApprove={canApprove}
      selectedDcIds={selectedDcIds}
      onToggleDc={onToggleDc}
      onBack={onBack}
      onDone={onDone}
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
  onSaved,
}: {
  doc: BomDoc;
  bomDocNo: string;
  remaining: RemainingLine[];
  busy: boolean;
  run: ReturnType<typeof useImsAction>["run"];
  print: () => void;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [docDate, setDocDate] = useState(todayLocal());
  const [shipTo, setShipTo] = useState("");
  const [transporter, setTransporter] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");
  const [qtyById, setQtyById] = useState<Record<string, string>>(() =>
    Object.fromEntries(remaining.map((l) => [l.bomLineId, String(l.remainingQty)])),
  );

  // Seed qtys if remaining arrives/changes after first paint (or line set grows).
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
  }, [remaining]);

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
    const lines = remaining
      .map((line) => {
        const qty = Number(qtyById[line.bomLineId] ?? line.remainingQty) || 0;
        return { bomLineId: line.bomLineId, qty: Math.min(Math.max(0, qty), line.remainingQty) };
      })
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      window.alert("Enter at least one quantity.");
      return;
    }
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
    if (out) onSaved();
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
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            Save draft DC
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
                  {({ id }) => <Input id={id} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
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
  onDone,
  print,
}: {
  doc: BomDoc;
  bomDocNo: string;
  dc: BomDc;
  remaining: RemainingLine[];
  busy: boolean;
  run: ReturnType<typeof useImsAction>["run"];
  canApprove: boolean;
  selectedDcIds: string[];
  onToggleDc: (id: string) => void;
  onBack: () => void;
  onDone: () => void;
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

  const editableLines = useMemo(() => {
    // remaining fetched with excludeDcId — remainingQty is capacity available to this DC.
    return (dc.lines ?? []).map((l) => {
      const rem = remById.get(l.bomLineId);
      const available = rem ? rem.remainingQty : l.qty;
      return {
        bomLineId: l.bomLineId,
        description: l.description,
        makeText: l.makeText,
        unit: l.unit,
        remainingQty: Math.max(available, l.qty),
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

  const linePayload = () =>
    editableLines
      .map((line) => {
        const qty = Number(qtyById[line.bomLineId] ?? 0) || 0;
        return { bomLineId: line.bomLineId, qty: Math.min(Math.max(0, qty), line.remainingQty) };
      })
      .filter((l) => l.qty > 0);

  const save = async () => {
    const lines = linePayload();
    if (!lines.length) {
      window.alert("Enter at least one quantity.");
      return;
    }
    const out = await run(
      "dc-update",
      () =>
        bom.updateDc(dc.id, {
          docDate,
          shipTo: shipTo.trim() || null,
          transporter: transporter.trim() || null,
          vehicleNo: vehicleNo.trim() || null,
          notes: notes.trim() || null,
          lines,
        }),
      { success: "Delivery challan updated" },
    );
    if (out) onDone();
  };

  const actions = (
    <>
      {isDraft ? (
        <>
          <Button size="sm" disabled={busy} onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              const lines = linePayload();
              if (!lines.length) {
                window.alert("Enter at least one quantity.");
                return;
              }
              const saved = await run(
                "dc-update",
                () =>
                  bom.updateDc(dc.id, {
                    docDate,
                    shipTo: shipTo.trim() || null,
                    transporter: transporter.trim() || null,
                    vehicleNo: vehicleNo.trim() || null,
                    notes: notes.trim() || null,
                    lines,
                  }),
                { success: "Delivery challan saved" },
              );
              if (!saved) return;
              const out = await run("dc-verify", () => bom.verifyDc(dc.id), { success: "Delivery challan verified" });
              if (out) onDone();
            }}
          >
            Verify
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Cancel ${dc.docNo}?`)) return;
              const out = await run("dc-cancel", () => bom.cancelDc(dc.id), { success: "Delivery challan cancelled" });
              if (out) onDone();
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
            disabled={busy || !canApprove}
            title={!canApprove ? "Approvals permission required" : undefined}
            onClick={async () => {
              const out = await run("dc-approve", () => bom.approveDc(dc.id), { success: "DC approved — stock out posted" });
              if (out) onDone();
            }}
          >
            Approve (stock out)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Cancel verified ${dc.docNo}?`)) return;
              const out = await run("dc-cancel", () => bom.cancelDc(dc.id), { success: "Delivery challan cancelled" });
              if (out) onDone();
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
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Reverse ${dc.docNo} and return stock?`)) return;
              const out = await run("dc-reverse", () => bom.reverseDc(dc.id), { success: "Delivery challan reversed" });
              if (out) onDone();
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
                      {({ id }) => <Input id={id} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
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
