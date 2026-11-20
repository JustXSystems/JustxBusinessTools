"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormGrid, Input, Textarea } from "@/components/bos";
import { BOM_DC_STATUS_LABEL, bom, type BomDoc } from "@/lib/ims/bom";
import { isDcReturnBlocked } from "@/lib/ims/bom-dc-intent";
import { todayLocal } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, useIms, useImsAction, useImsData, usePrint } from "../core";
import { BomSplitLayout } from "./BomSplitLayout";
import { DocRefLink } from "./DocRefLink";
import { ReturnPaper, type ReturnPaperModel } from "./ReturnPaper";

type CreateProps = {
  dcId: string;
  onBack: () => void;
  onPosted: (returnId: string) => void;
};

type ManageProps = {
  returnId: string;
  onBack: () => void;
  onOpenDc: (dcId: string, bomId: string) => void;
};

/** Create an unused-material return paper against an approved DC (compose + live preview). */
export function CreateReturnWorkspace({ dcId, onBack, onPosted }: CreateProps) {
  const { can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const canReturn = can("approvals") || can("stockOut");

  const dcState = useImsData(() => bom.getDc(dcId), [dcId]);
  const dc = dcState.data?.dc ?? null;
  const bomId = dc?.bomDocId ?? "";
  const docState = useImsData(() => (bomId ? bom.doc(bomId) : Promise.resolve(null)), [bomId]);
  const doc = docState.data?.doc as BomDoc | undefined;

  const [returnDate, setReturnDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");
  const [qtyByLineId, setQtyByLineId] = useState<Record<string, string>>({});
  const [remarksByLineId, setRemarksByLineId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!dc?.lines) return;
    setQtyByLineId((prev) => {
      const next = { ...prev };
      for (const l of dc.lines ?? []) {
        if (next[l.id] == null) next[l.id] = "";
      }
      return next;
    });
  }, [dc?.id, dc?.updatedAt]);

  if (dcState.error) return <ErrorBlock error={dcState.error} onRetry={dcState.reload} />;
  if (dcState.loading && !dc) return <LoadingBlock rows={4} />;
  if (!dc) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Delivery challan not found">
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </Alert>
      </Card>
    );
  }
  if (docState.loading && !doc) return <LoadingBlock rows={4} />;
  if (!doc) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="BOM not found">
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </Alert>
      </Card>
    );
  }

  const blocked = isDcReturnBlocked(dc, { allowInvoiceLink: false });
  const returnable = (dc.lines ?? []).filter((l) => (l.netQty ?? Math.max(0, l.qty - (l.returnedQty ?? 0))) > 1e-9);
  if (blocked || (dc.status === "approved" && dc.stockPosted && !returnable.length)) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title={blocked ? "Return blocked" : "Nothing left to return"}>
          {blocked
            ? dc.invoiceStatus === "issued"
              ? `Cancel issued invoice ${dc.invoiceNo || ""} before returning stock on this DC.`
              : "Unlink or cancel the live invoice on this BOM/DC before posting a return."
            : "All delivered quantities on this challan have already been returned."}
        </Alert>
        <div className="ims-row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {dc.invoiceId ? (
            <DocRefLink module="sales" intent={`open:${dc.invoiceId}`}>
              {dc.invoiceNo || "Open invoice"}
            </DocRefLink>
          ) : null}
          <DocRefLink module="bomDc" intent={`open:${dc.id}`}>
            {dc.docNo}
          </DocRefLink>
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to returns
          </Button>
        </div>
      </Card>
    );
  }
  const paperLines = returnable
    .map((l) => {
      const qty = Number(qtyByLineId[l.id] ?? 0) || 0;
      if (!(qty > 0)) return null;
      return {
        description: l.description,
        qty,
        unit: l.unit,
        remarks: (remarksByLineId[l.id] ?? "").trim() || null,
      };
    })
    .filter(Boolean) as ReturnPaperModel["lines"][number][];

  const model: ReturnPaperModel = {
    returnNo: "RTN/…",
    returnDate,
    status: "draft",
    dcDocNo: dc.docNo,
    bomDocNo: dc.bomDocNo ?? doc.docNo,
    quotationRef: dc.quotationRef ?? doc.quotationRef,
    customerName: dc.customerName ?? doc.customerName ?? "",
    location: doc.location,
    projectRef: doc.projectRef,
    notes: notes.trim() || null,
    lines: paperLines,
  };

  const post = async () => {
    if (!canReturn) {
      window.alert("Approvals or Stock out permission is required to post a return.");
      return;
    }
    if (blocked) {
      window.alert("Unlink this DC from its invoice (or cancel the invoice) before posting a return.");
      return;
    }
    if (dc.status !== "approved" || !dc.stockPosted) {
      window.alert("Only approved delivery challans with posted stock can record returns.");
      return;
    }
    const lines = returnable
      .map((l) => {
        const qty = Number(qtyByLineId[l.id] ?? 0) || 0;
        const max = Math.max(0, l.netQty ?? l.qty - (l.returnedQty ?? 0));
        return {
          dcLineId: l.id,
          qty,
          max,
          description: l.description,
          unit: l.unit,
          remarks: (remarksByLineId[l.id] ?? "").trim() || null,
        };
      })
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      window.alert("Enter at least one return quantity on the paper.");
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
          returnDate,
          notes: notes.trim() || null,
          lines: lines.map((l) => ({ dcLineId: l.dcLineId, qty: l.qty, remarks: l.remarks })),
        }),
      {
        success: "Material return posted",
        description: "Stock received back · RTN document saved",
      },
    );
    if (out?.return?.id) onPosted(out.return.id);
  };

  return (
    <div className="ims-bom-dc-workspace">
      <div className="ims-flow-crumb" aria-label="Document path">
        <DocRefLink module="bom" intent={`open:${doc.id}`}>
          {doc.docNo}
        </DocRefLink>
        <span className="ims-flow-crumb-sep">›</span>
        <DocRefLink module="bomDc" intent={`open:${dc.id}`}>
          {dc.docNo}
        </DocRefLink>
        <span className="ims-flow-crumb-sep">›</span>
        <span>New return</span>
      </div>
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← Back to returns
        </button>
        <div className="ims-row" style={{ flexWrap: "wrap" }}>
          <span className="ims-strong" style={{ fontSize: 14 }}>
            New material return
          </span>
          <Badge tone="amber">Draft</Badge>
          <Button size="sm" icon="printer" onClick={print}>
            Print preview
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("bomDc", `open:${dc.id}`)}>
            Open DC {dc.docNo}
          </Button>
          <Button size="sm" variant="primary" disabled={Boolean(busy) || !canReturn || blocked || !returnable.length} onClick={post}>
            {busy === "dc-return" ? "Posting…" : "Post return"}
          </Button>
        </div>
      </div>
      <BomSplitLayout
        compose={
          <div className="ims-bom-dc-compose">
            <Card className="ims-bom-action-card">
              <Alert tone="blue" title="Composer">
                Return unused materials from <b>{dc.docNo}</b> (BOM <b>{doc.docNo}</b>). Live preview updates as you enter quantities; posting
                creates the RTN number and receives stock.
              </Alert>
              {blocked ? (
                <Alert tone="amber" title="Linked to an invoice">
                  {dc.invoiceStatus === "issued"
                    ? `Cancel issued invoice ${dc.invoiceNo || ""} before returning.`
                    : "Unlink this DC from the draft invoice before returning."}
                  {dc.invoiceId ? (
                    <DocRefLink module="sales" intent={`open:${dc.invoiceId}`}>
                      {dc.invoiceNo || "Open invoice"}
                    </DocRefLink>
                  ) : null}
                </Alert>
              ) : null}
              {!canReturn ? (
                <Alert tone="amber" title="Permission needed">
                  Approvals or Stock out permission is required to post returns.
                </Alert>
              ) : null}
              {dc.status !== "approved" || !dc.stockPosted ? (
                <Alert tone="amber" title="DC not ready">
                  Only approved delivery challans with stock posted can record returns (status:{" "}
                  {BOM_DC_STATUS_LABEL[dc.status] ?? dc.status}).
                </Alert>
              ) : null}
              {!returnable.length && dc.status === "approved" ? (
                <Alert tone="amber" title="Nothing left to return">
                  All delivered quantities on this DC have already been returned.
                </Alert>
              ) : null}
              <FormGrid>
                <Field label="Return date">
                  {({ id }) => (
                    <Input id={id} type="date" value={returnDate} max={todayLocal()} onChange={(e) => setReturnDate(e.target.value)} />
                  )}
                </Field>
              </FormGrid>
              <Field label="Notes">
                {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Quantities still out</div>
              {returnable.map((line) => {
                const max = Math.max(0, line.netQty ?? line.qty - (line.returnedQty ?? 0));
                return (
                  <div key={line.id} style={{ display: "grid", gap: 6, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                    <div style={{ fontSize: 13 }}>
                      {line.description}{" "}
                      <span style={{ opacity: 0.65 }}>
                        · returnable {max} {line.unit}
                      </span>
                    </div>
                    <Input
                      className="ims-bom-dc-qty-input"
                      value={qtyByLineId[line.id] ?? ""}
                      onChange={(e) => setQtyByLineId((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      placeholder="0"
                      style={{ width: 120 }}
                    />
                    <Input
                      value={remarksByLineId[line.id] ?? ""}
                      onChange={(e) => setRemarksByLineId((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      placeholder="Line remarks (optional)"
                    />
                  </div>
                );
              })}
            </Card>
          </div>
        }
        preview={
          <div className="ims-print-root">
            <div className="ims-bom-preview-toolbar" role="group" aria-label="Preview mode">
              <span className="ims-bom-preview-label">Live Preview</span>
              <Badge tag="mint">MATERIAL RETURN</Badge>
            </div>
            <ReturnPaper model={model} />
          </div>
        }
      />
    </div>
  );
}

/** Maintain a posted RTN paper (date, notes, remarks) with live print preview. */
export function ManageReturnWorkspace({ returnId, onBack, onOpenDc }: ManageProps) {
  const { can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const canEdit = can("approvals") || can("stockOut");
  const state = useImsData(() => bom.getDcReturn(returnId), [returnId]);
  const rtn = state.data?.return;

  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");
  const [remarksByLineId, setRemarksByLineId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!rtn) return;
    setReturnDate(rtn.returnDate);
    setNotes(rtn.notes ?? "");
    setRemarksByLineId(Object.fromEntries((rtn.lines ?? []).map((l) => [l.id, l.remarks ?? ""])));
  }, [rtn?.id, rtn?.returnDate, rtn?.notes, rtn?.createdAt]);

  const dirty = useMemo(() => {
    if (!rtn) return false;
    if ((notes.trim() || null) !== (rtn.notes ?? null)) return true;
    for (const l of rtn.lines ?? []) {
      if ((remarksByLineId[l.id] ?? "").trim() !== (l.remarks ?? "").trim()) return true;
    }
    return false;
  }, [rtn, notes, remarksByLineId]);

  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  if (state.loading && !rtn) return <LoadingBlock rows={4} />;
  if (!rtn) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Return not found">
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to returns
          </Button>
        </Alert>
      </Card>
    );
  }

  const model: ReturnPaperModel = {
    returnNo: rtn.returnNo,
    returnDate: returnDate || rtn.returnDate,
    status: "posted",
    dcDocNo: rtn.dcDocNo ?? "—",
    bomDocNo: rtn.bomDocNo ?? "—",
    quotationRef: rtn.quotationRef,
    customerName: rtn.customerName ?? "",
    location: rtn.location,
    projectRef: rtn.projectRef,
    notes: notes.trim() || null,
    createdByName: rtn.createdByName,
    lines: (rtn.lines ?? []).map((l) => ({
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      remarks: (remarksByLineId[l.id] ?? "").trim() || null,
    })),
  };

  const save = async () => {
    if (!canEdit) {
      window.alert("Approvals or Stock out permission is required to maintain a return.");
      return;
    }
    const out = await run(
      "rtn-update",
      () =>
        bom.updateDcReturn(rtn.id, {
          notes: notes.trim() || null,
          lines: (rtn.lines ?? []).map((l) => ({
            id: l.id,
            remarks: (remarksByLineId[l.id] ?? "").trim() || null,
          })),
        }),
      { success: "Return paper updated", description: rtn.returnNo },
    );
    if (out) state.reload();
  };

  return (
    <div className="ims-bom-dc-workspace">
      <div className="ims-flow-crumb" aria-label="Document path">
        {rtn.bomDocId ? (
          <DocRefLink module="bom" intent={`open:${rtn.bomDocId}`}>
            {rtn.bomDocNo ?? "BOM"}
          </DocRefLink>
        ) : (
          <span>{rtn.bomDocNo ?? "BOM"}</span>
        )}
        <span className="ims-flow-crumb-sep">›</span>
        <DocRefLink module="bomDc" intent={`open:${rtn.dcId}`}>
          {rtn.dcDocNo ?? "DC"}
        </DocRefLink>
        <span className="ims-flow-crumb-sep">›</span>
        <span>{rtn.returnNo}</span>
      </div>
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← All returns
        </button>
        <div className="ims-row" style={{ flexWrap: "wrap" }}>
          <span className="ims-strong" style={{ fontSize: 14 }}>
            {rtn.returnNo}
          </span>
          <Badge tone="emerald">Returned</Badge>
          <Button size="sm" icon="printer" onClick={print}>
            Print
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenDc(rtn.dcId, rtn.bomDocId)}>
            Open DC {rtn.dcDocNo ?? ""}
          </Button>
          {canEdit ? (
            <Button size="sm" variant="primary" disabled={Boolean(busy) || !dirty} onClick={save}>
              {busy === "rtn-update" ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
          ) : null}
        </div>
      </div>
      <BomSplitLayout
        compose={
          <div className="ims-bom-dc-compose">
            <Card className="ims-bom-action-card">
              <Alert tone="blue" title="Composer">
                Maintain return paper <b>{rtn.returnNo}</b>. Quantities are fixed after stock was received; edit date, notes, and line
                remarks. Post another return on the DC for more unused stock.
              </Alert>
              <FormGrid>
                <Field label="Return date">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      value={returnDate}
                      max={todayLocal()}
                      disabled
                      title="Return date is fixed when stock was received"
                    />
                  )}
                </Field>
              </FormGrid>
              <p className="ims-faint" style={{ fontSize: 12, margin: 0 }}>
                Date is fixed after stock RETURN_IN. Edit notes and line remarks only.
              </p>
              <Field label="Notes">
                {({ id }) => (
                  <Textarea id={id} rows={2} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
                )}
              </Field>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
                Lines · {rtn.units ?? (rtn.lines ?? []).reduce((s, l) => s + l.qty, 0)} units
              </div>
              {(rtn.lines ?? []).map((line) => (
                <div key={line.id} style={{ display: "grid", gap: 6, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    {line.description}{" "}
                    <span style={{ opacity: 0.65 }}>
                      · {line.qty} {line.unit}
                    </span>
                  </div>
                  <Input
                    value={remarksByLineId[line.id] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => setRemarksByLineId((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    placeholder="Line remarks"
                  />
                </div>
              ))}
              <div className="ims-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant="ghost" onClick={() => navigate("bomDc", "returns")}>
                  Returns list
                </Button>
              </div>
            </Card>
          </div>
        }
        preview={
          <div className="ims-print-root">
            <div className="ims-bom-preview-toolbar" role="group" aria-label="Preview mode">
              <span className="ims-bom-preview-label">Live Preview</span>
              <Badge tag="mint">MATERIAL RETURN</Badge>
            </div>
            <ReturnPaper model={model} />
          </div>
        }
      />
    </div>
  );
}

/** Pick an approved DC that still has returnable qty. */
export function PickApprovedDcForReturn({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (dcId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(0);
  }, [qDebounced]);
  const state = useImsData(
    () =>
      bom.listAllDcs({
        status: "approved",
        returnable: true,
        q: qDebounced || undefined,
        limit: 40,
        offset,
      }),
    [qDebounced, offset],
  );
  const dcs = state.data?.dcs ?? [];
  const total = state.data?.total ?? 0;

  return (
    <div className="ims-stack" style={{ display: "grid", gap: 12 }}>
      <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="bos-back-link" onClick={onBack}>
          ← Back to returns
        </button>
      </div>
      <Card className="ims-bom-action-card" interactive={false}>
        <Alert tone="blue" title="New material return">
          Pick an approved delivery challan that still has stock out at site. Invoice-linked DCs are hidden until unlinked.
        </Alert>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search DC, BOM, customer…"
          aria-label="Search approved delivery challans"
          style={{ marginTop: 8 }}
        />
        {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
        {state.loading && !state.data ? <LoadingBlock rows={3} /> : null}
        {!state.loading && !dcs.length ? (
          <p className="ims-faint" style={{ marginTop: 12 }}>
            No approved challans with returnable stock. Approve a DC first, or cancel/unlink any live invoice on the BOM.
          </p>
        ) : null}
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {dcs.map((dc) => {
            const stillOut = Math.max(0, (Number(dc.deliveredUnits) || 0) - (Number(dc.returnedUnits) || 0));
            return (
              <button
                key={dc.id}
                type="button"
                className="ims-bom-pick-row"
                onClick={() => onPick(dc.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "1px solid var(--bos-border, #e2e8f0)",
                  borderRadius: 8,
                  background: "var(--bos-surface, #fff)",
                  cursor: "pointer",
                }}
              >
                <div className="ims-strong">
                  {dc.docNo} · {dc.customerName || "No customer"}
                </div>
                <div className="ims-faint" style={{ fontSize: 12 }}>
                  BOM {dc.bomDocNo ?? "—"} · still out {stillOut} units
                </div>
              </button>
            );
          })}
        </div>
        {dcs.length ? (
          <div className="ims-between" style={{ marginTop: 12 }}>
            <span className="ims-faint">
              Showing {offset + 1}–{Math.min(offset + dcs.length, total)} of {total}
            </span>
            <div className="ims-row">
              <Button size="sm" variant="ghost" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - 40))}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={offset + dcs.length >= total} onClick={() => setOffset((o) => o + 40)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
