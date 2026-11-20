"use client";

import "./bom.css";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterChip,
  SearchInput,
  type BosColumn,
} from "@/components/bos";
import {
  BOM_DC_STATUS_LABEL,
  BOM_DOC_STATUS_LABEL,
  bom,
  type BomDc,
  type BomDcStatus,
  type BomDoc,
} from "@/lib/ims/bom";
import { parseBomDcIntent, type BomDcView } from "@/lib/ims/bom-dc-intent";
import { dateLabel, stampLabel, type BadgeView } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, StatusBadge, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { DeliveryChallanWorkspace, type DcWorkspace } from "./DeliveryChallanPanel";

type StatusFilter = "all" | BomDcStatus | "linked";
type View = BomDcView;
type ModuleTab = "challans" | "returns";

type DcListRow = BomDc & { lineCount?: number; deliveredUnits?: number; returnedUnits?: number; bomStatus?: string };

const PAGE_SIZE = 40;

const DC_STATUS_BADGE: Record<BomDcStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "amber" },
  verified: { text: "VERIFIED", tone: "blue" },
  approved: { text: "APPROVED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "coral" },
};

function stopRowClick(e: MouseEvent) {
  e.stopPropagation();
}

export default function BomDcReturnsScreen() {
  const { takeIntent, navSeq } = useIms();
  const rawIntent = takeIntent("bomDc");
  const [tab, setTab] = useState<ModuleTab>(() => (rawIntent === "returns" ? "returns" : "challans"));
  const [view, setView] = useState<View>(() => parseBomDcIntent(rawIntent) ?? { mode: "list" });

  useEffect(() => {
    const raw = takeIntent("bomDc");
    if (raw === "returns") {
      setTab("returns");
      setView({ mode: "list" });
      return;
    }
    const next = parseBomDcIntent(raw);
    if (next) {
      setTab("challans");
      setView(next);
    }
  }, [navSeq, takeIntent]);

  return (
    <RequirePerm perm="bom" what="delivery challans & returns">
      {view.mode === "list" ? (
        <Stack>
          <SubTabs<ModuleTab>
            value={tab}
            onChange={setTab}
            label="DC & Returns"
            options={[
              { value: "challans", label: "Delivery challans" },
              { value: "returns", label: "Returns" },
            ]}
          />
          {tab === "challans" ? (
            <DcList
              onNew={() => setView({ mode: "pick-bom" })}
              onOpen={(dc) => setView({ mode: "workspace", bomId: dc.bomDocId, workspace: { kind: "manage", dcId: dc.id } })}
            />
          ) : (
            <ReturnsList onOpenDc={(dcId, bomId) => setView({ mode: "workspace", bomId, workspace: { kind: "manage", dcId } })} />
          )}
        </Stack>
      ) : null}
      {view.mode === "pick-bom" ? (
        <PickConfirmedBom
          onBack={() => setView({ mode: "list" })}
          onPick={(bomId) => setView({ mode: "workspace", bomId, workspace: { kind: "create" } })}
        />
      ) : null}
      {view.mode === "workspace" ? (
        <DcWorkspaceHost
          key={
            view.workspace.kind === "manage"
              ? `manage:${view.workspace.dcId}`
              : `create:${view.bomId}`
          }
          bomId={view.bomId}
          workspace={view.workspace}
          onBack={() => setView({ mode: "list" })}
          onCreated={(bomId, dcId) => setView({ mode: "workspace", bomId, workspace: { kind: "manage", dcId } })}
        />
      ) : null}
    </RequirePerm>
  );
}

function DcList({ onNew, onOpen }: { onNew: () => void; onOpen: (dc: BomDc) => void }) {
  const { can, session, navigate } = useIms();
  const { run, busy } = useImsAction();
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const canApprove = session.access.role === "owner" || can("approvals");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setOffset(0);
  }, [qDebounced, status]);

  const setFilterStatus = (next: StatusFilter) => {
    setStatus(next);
    setOffset(0);
  };

  const state = useImsData(
    () =>
      bom.listAllDcs({
        q: qDebounced || undefined,
        status: status === "all" || status === "linked" ? undefined : status,
        linked: status === "linked" ? true : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [qDebounced, status, offset],
  );

  const dcs = state.data?.dcs ?? [];
  const counts = state.data?.counts;
  const total = state.data?.total ?? 0;

  const columns: BosColumn<DcListRow>[] = useMemo(
    () => [
      {
        key: "docNo",
        header: "DC",
        cell: (dc) => (
          <span className="ims-cell-stack">
            <span className="ims-strong">{dc.docNo}</span>
            <small className="ims-faint">{dateLabel(dc.docDate)}</small>
          </span>
        ),
      },
      {
        key: "bom",
        header: "BOM",
        cell: (dc) => (
          <span className="ims-cell-stack">
            <span>{dc.bomDocNo ?? "—"}</span>
            <small className="ims-faint">{dc.customerName || "No customer"}</small>
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        cell: (dc) => (
          <span className="ims-cell-stack">
            <StatusBadge view={DC_STATUS_BADGE[dc.status]} />
            {dc.invoiceLinked ? (
              <small className="ims-faint">
                Linked {dc.invoiceNo ? `· ${dc.invoiceNo}` : dc.invoiceStatus === "draft" ? "· draft invoice" : ""}
              </small>
            ) : null}
          </span>
        ),
      },
      {
        key: "qty",
        header: "Qty",
        cell: (dc) => {
          const delivered = Number(dc.deliveredUnits) || 0;
          const returned = Number(dc.returnedUnits) || 0;
          const stillOut = Math.max(0, delivered - returned);
          return (
            <span className="ims-cell-stack">
              <span>{delivered || "—"} units</span>
              {returned > 0 ? <small className="ims-faint">Returned {returned}{dc.status === "approved" && stillOut <= 1e-9 ? " · fully returned" : stillOut > 0 ? ` · still out ${stillOut}` : ""}</small> : null}
            </span>
          );
        },
      },
      {
        key: "updated",
        header: "Updated",
        mono: true,
        cell: (dc) => <span className="ims-faint">{stampLabel(dc.updatedAt ?? dc.createdAt)}</span>,
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: 360,
        cell: (dc) => {
          const bomConfirmed = dc.bomStatus === "confirmed";
          const canReturn =
            dc.status === "approved" &&
            dc.stockPosted &&
            !dc.invoiceLinked &&
            (can("approvals") || can("stockOut"));
          const stillOut =
            Math.max(0, (Number(dc.deliveredUnits) || 0) - (Number(dc.returnedUnits) || 0));
          return (
            <div className="ims-row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }} onClick={stopRowClick} onKeyDown={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => onOpen(dc)}>
                Open
              </Button>
              {dc.status === "draft" ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={Boolean(busy) || !bomConfirmed}
                  title={!bomConfirmed ? "Confirm the BOM before verifying" : undefined}
                  onClick={async () => {
                    const out = await run("dc-verify", () => bom.verifyDc(dc.id), { success: "Delivery challan verified" });
                    if (out) state.reload();
                  }}
                >
                  Verify
                </Button>
              ) : null}
              {dc.status === "verified" && canApprove ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={Boolean(busy) || !bomConfirmed}
                  title={!bomConfirmed ? "Confirm the BOM before approving" : undefined}
                  onClick={async () => {
                    const out = await run("dc-approve", () => bom.approveDc(dc.id), { success: "DC approved — stock out posted" });
                    if (out) state.reload();
                  }}
                >
                  Approve
                </Button>
              ) : null}
              {dc.status === "verified" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!window.confirm(`Reject ${dc.docNo}?`)) return;
                    const out = await run("dc-reject", () => bom.rejectDc(dc.id), { success: "Delivery challan rejected" });
                    if (out) state.reload();
                  }}
                >
                  Reject
                </Button>
              ) : null}
              {dc.status === "draft" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!window.confirm(`Cancel draft ${dc.docNo}?`)) return;
                    const out = await run("dc-cancel", () => bom.cancelDc(dc.id), { success: "Delivery challan cancelled" });
                    if (out) state.reload();
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              {dc.status === "approved" && dc.invoiceLinked ? (
                <Button size="sm" variant="ghost" onClick={() => (dc.invoiceId ? navigate("sales", `open:${dc.invoiceId}`) : onOpen(dc))}>
                  {dc.invoiceStatus === "issued" ? "Linked — cancel inv." : "Linked — unlink"}
                </Button>
              ) : null}
              {canReturn && stillOut > 1e-9 ? (
                <Button size="sm" variant="primary" onClick={() => onOpen(dc)}>
                  Return
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [busy, can, canApprove, navigate, onOpen, run, state],
  );

  return (
    <Stack>
      <PageHeader
        title="DC & Returns"
        sub="Create and maintain delivery challans against confirmed BOMs. Verify, approve (stock out), reject, or return unused materials."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => navigate("bom")}>
              Open BOMs
            </Button>
            <Button size="sm" variant="primary" onClick={onNew}>
              New delivery challan
            </Button>
          </>
        }
      />
      <div className="ims-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <SearchInput
          wrapperClassName="ims-grow"
          placeholder="Search DC, BOM, customer…"
          aria-label="Search delivery challans"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", "draft", "verified", "approved", "cancelled", "linked"] as const).map((s) => {
          const n = s === "all" ? counts?.all : s === "linked" ? counts?.linked : counts?.[s];
          return (
            <FilterChip key={s} active={status === s} onClick={() => setFilterStatus(s)}>
              {s === "all" ? "All" : s === "linked" ? "Invoice-linked" : BOM_DC_STATUS_LABEL[s]}
              {typeof n === "number" ? ` (${n})` : ""}
            </FilterChip>
          );
        })}
      </div>
      {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingBlock rows={4} /> : null}
      {!state.loading && !dcs.length ? (
        <EmptyState
          glyph="◫"
          title="No delivery challans"
          actions={
            <Button size="sm" variant="primary" onClick={onNew}>
              New delivery challan
            </Button>
          }
        >
          Confirm a BOM first, then create a DC here or from the BOM compose rail.
        </EmptyState>
      ) : null}
      {dcs.length ? (
        <>
          <DataTable columns={columns} rows={dcs} rowKey={(r) => r.id} onRowClick={onOpen} />
          <div className="ims-between" style={{ marginTop: 8 }}>
            <span className="ims-faint">
              Showing {offset + 1}–{Math.min(offset + dcs.length, total)} of {total}
            </span>
            <div className="ims-row">
              <Button size="sm" variant="ghost" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={offset + dcs.length >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Stack>
  );
}

function ReturnsList({ onOpenDc }: { onOpenDc: (dcId: string, bomId: string) => void }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setOffset(0);
  }, [qDebounced]);

  const state = useImsData(
    () => bom.listAllDcReturns({ q: qDebounced || undefined, limit: PAGE_SIZE, offset }),
    [qDebounced, offset],
  );
  const rows = state.data?.returns ?? [];
  const total = state.data?.total ?? 0;

  return (
    <Stack>
      <PageHeader
        title="Unused-material returns"
        sub="Returns posted against approved delivery challans. Open a DC to record another return or reverse remaining stock."
      />
      <SearchInput
        wrapperClassName="ims-grow"
        placeholder="Search return no, DC, BOM, customer…"
        aria-label="Search DC returns"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingBlock rows={3} /> : null}
      {!state.loading && !rows.length ? (
        <EmptyState glyph="↺" title="No returns yet">
          Open an approved delivery challan and use Return unused to bring stock back.
        </EmptyState>
      ) : null}
      {rows.length ? (
        <>
          <DataTable
            rowKey={(r) => r.id}
            rows={rows}
            onRowClick={(r) => onOpenDc(r.dcId, r.bomDocId)}
            columns={[
              {
                key: "returnNo",
                header: "Return",
                cell: (r) => (
                  <span className="ims-cell-stack">
                    <span className="ims-strong">{r.returnNo}</span>
                    <small className="ims-faint">{dateLabel(r.returnDate)}</small>
                  </span>
                ),
              },
              {
                key: "dc",
                header: "DC / BOM",
                cell: (r) => (
                  <span className="ims-cell-stack">
                    <span>{r.dcDocNo ?? "—"}</span>
                    <small className="ims-faint">
                      {r.bomDocNo ?? "—"}
                      {r.customerName ? ` · ${r.customerName}` : ""}
                    </small>
                  </span>
                ),
              },
              {
                key: "units",
                header: "Units",
                cell: (r) => <span>{r.units ?? (r.lines ?? []).reduce((s, l) => s + l.qty, 0)}</span>,
              },
              {
                key: "by",
                header: "By",
                cell: (r) => <span className="ims-faint">{r.createdByName || "—"}</span>,
              },
              {
                key: "open",
                header: "",
                align: "right",
                cell: (r) => (
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpenDc(r.dcId, r.bomDocId); }}>
                    Open DC
                  </Button>
                ),
              },
            ]}
          />
          <div className="ims-between" style={{ marginTop: 8 }}>
            <span className="ims-faint">
              Showing {offset + 1}–{Math.min(offset + rows.length, total)} of {total}
            </span>
            <div className="ims-row">
              <Button size="sm" variant="ghost" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={offset + rows.length >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Stack>
  );
}

function PickConfirmedBom({ onBack, onPick }: { onBack: () => void; onPick: (bomId: string) => void }) {
  const { navigate } = useIms();
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const state = useImsData(
    () => bom.docs({ status: "confirmed", q: qDebounced || undefined, limit: 40, sort: "recent" }),
    [qDebounced],
  );
  const docs = state.data?.docs ?? [];

  return (
    <Stack>
      <PageHeader
        title="New delivery challan"
        sub="Pick a confirmed BOM. If nothing is left to deliver, open the BOM to increase qty and reconfirm."
        actions={
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to list
          </Button>
        }
      />
      <SearchInput
        wrapperClassName="ims-grow"
        placeholder="Search confirmed BOMs…"
        aria-label="Search confirmed BOMs"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingBlock rows={3} /> : null}
      {!state.loading && !docs.length ? (
        <EmptyState
          glyph="☰"
          title="No confirmed BOMs"
          actions={
            <Button size="sm" variant="primary" onClick={() => navigate("bom")}>
              Open Create / Maintain
            </Button>
          }
        >
          Confirm a customer BOM under Create / Maintain before raising a delivery challan.
        </EmptyState>
      ) : null}
      <div className="ims-stack" style={{ gap: 8 }}>
        {docs.map((d) => {
          const fullyIssued = Boolean(d.stockIssuedAt);
          const partial = !fullyIssued && (d.stockIssueCount ?? 0) > 0;
          return (
            <Card key={d.id} className="ims-bom-action-card">
              <div className="ims-between">
                <span className="ims-cell-stack">
                  <span className="ims-strong">
                    {d.docNo} · {d.customerName || "No customer"}
                  </span>
                  <small className="ims-faint">
                    {BOM_DOC_STATUS_LABEL[d.status]} · {dateLabel(d.docDate)}
                    {d.quotationRef ? ` · Quote ${d.quotationRef}` : ""}
                  </small>
                  {fullyIssued ? (
                    <Badge tone="amber">Stock fully covered — returns or amend qty may be needed</Badge>
                  ) : partial ? (
                    <Badge tone="blue">
                      Partial delivery · {d.stockIssueCount} DC{d.stockIssueCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </span>
                <Button size="sm" variant="primary" onClick={() => onPick(d.id)}>
                  Create DC
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </Stack>
  );
}

function DcWorkspaceHost({
  bomId: bomIdProp,
  workspace,
  onBack,
  onCreated,
}: {
  bomId: string;
  workspace: DcWorkspace;
  onBack: () => void;
  onCreated: (bomId: string, dcId: string) => void;
}) {
  const { can, session, navigate } = useIms();
  const { run, busy } = useImsAction();
  const canApprove = session.access.role === "owner" || can("approvals");

  const seedDcId = workspace.kind === "manage" ? workspace.dcId : null;
  const needsSeed = Boolean(seedDcId && !bomIdProp);
  const seedState = useImsData(
    () => (needsSeed && seedDcId ? bom.getDc(seedDcId) : Promise.resolve(null)),
    [needsSeed, seedDcId],
  );

  const bomId = bomIdProp || seedState.data?.dc?.bomDocId || "";
  const docState = useImsData(() => (bomId ? bom.doc(bomId) : Promise.resolve(null)), [bomId]);

  if (needsSeed && seedState.loading && !seedState.data) return <LoadingBlock rows={3} />;
  if (needsSeed && seedState.error) return <ErrorBlock error={seedState.error} onRetry={seedState.reload} />;
  if (needsSeed && seedState.data && !seedState.data.dc) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Delivery challan not found">
          It may have been removed.{" "}
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to list
          </Button>
        </Alert>
      </Card>
    );
  }
  if (!bomId) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Delivery challan not found">
          It may have been removed.{" "}
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to list
          </Button>
        </Alert>
      </Card>
    );
  }
  if (docState.error) return <ErrorBlock error={docState.error} onRetry={docState.reload} />;
  if (docState.loading && !docState.data) return <LoadingBlock rows={3} />;
  const doc = docState.data?.doc as BomDoc | undefined;
  if (!doc) {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="BOM not found">
          The linked BOM may have been deleted.{" "}
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to list
          </Button>
        </Alert>
      </Card>
    );
  }

  if (workspace.kind === "create" && doc.status !== "confirmed") {
    return (
      <Card className="ims-bom-action-card">
        <Alert tone="amber" title="Confirm BOM first">
          Delivery challans can only be created on a confirmed BOM ({doc.docNo} is {BOM_DOC_STATUS_LABEL[doc.status]}).
        </Alert>
        <div className="ims-row" style={{ gap: 8, marginTop: 10 }}>
          <Button size="sm" variant="primary" onClick={() => navigate("bom", `open:${doc.id}`)}>
            Open BOM
          </Button>
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back to list
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <DeliveryChallanWorkspace
      doc={doc}
      workspace={workspace}
      busy={busy}
      run={run}
      canApprove={canApprove}
      selectedDcIds={[]}
      onToggleDc={() => undefined}
      onBack={onBack}
      onClose={onBack}
      onCreated={(dcId) => onCreated(doc.id, dcId)}
      onRefresh={() => docState.reload()}
      backLabel="Back to list"
      allowInvoiceLink={false}
    />
  );
}
