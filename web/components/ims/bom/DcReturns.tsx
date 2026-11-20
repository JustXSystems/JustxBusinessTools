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
  type BomDcReturnListRow,
  type BomDcStatus,
  type BomDoc,
} from "@/lib/ims/bom";
import { parseBomDcIntent, type BomDcView } from "@/lib/ims/bom-dc-intent";
import { dateLabel, stampLabel, type BadgeView } from "@/lib/ims/format";
import {
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  RequirePerm,
  Stack,
  StatusBadge,
  SubTabs,
  useIms,
  useImsAction,
  useImsData,
} from "../core";
import { DeliveryChallanWorkspace, type DcWorkspace } from "./DeliveryChallanPanel";
import { DocRefLink } from "./DocRefLink";
import { CreateReturnWorkspace, ManageReturnWorkspace, PickApprovedDcForReturn } from "./ReturnWorkspace";

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

function preferReturnsTab(raw: string | null): boolean {
  if (!raw) return false;
  return (
    raw === "returns" ||
    raw === "return" ||
    raw === "new-return" ||
    raw === "new-rtn" ||
    raw.startsWith("return:") ||
    raw.startsWith("open-return:") ||
    raw.startsWith("new-return:") ||
    raw === "pick-dc-return"
  );
}

export default function BomDcReturnsScreen() {
  const { takeIntent, navSeq } = useIms();
  const rawIntent = takeIntent("bomDc");
  const [tab, setTab] = useState<ModuleTab>(() => (preferReturnsTab(rawIntent) ? "returns" : "challans"));
  const [view, setView] = useState<View>(() => {
    if (rawIntent === "returns" || rawIntent === "return") return { mode: "list" };
    return parseBomDcIntent(rawIntent) ?? { mode: "list" };
  });
  const returnsCount = useImsData(() => bom.listAllDcReturns({ limit: 1, offset: 0 }), [navSeq, view.mode]);

  useEffect(() => {
    const raw = takeIntent("bomDc");
    if (!raw) return;
    if (raw === "returns" || raw === "return") {
      setTab("returns");
      setView({ mode: "list" });
      return;
    }
    const next = parseBomDcIntent(raw);
    if (!next) return;
    if (next.mode === "return" || next.mode === "create-return" || next.mode === "pick-dc-return") {
      setTab("returns");
      setView(next);
      return;
    }
    if (next.mode === "list") {
      setView(next);
      return;
    }
    setTab("challans");
    setView(next);
  }, [navSeq, takeIntent]);

  const openReturn = (returnId: string) => setView({ mode: "return", returnId });
  const createReturn = (dcId: string) => setView({ mode: "create-return", dcId });
  const openDc = (dcId: string, bomId: string) =>
    setView({ mode: "workspace", bomId, workspace: { kind: "manage", dcId } });
  const backToReturns = () => {
    setTab("returns");
    setView({ mode: "list" });
  };

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
              {
                value: "returns",
                label:
                  typeof returnsCount.data?.total === "number"
                    ? `Returns · ${returnsCount.data.total}`
                    : "Returns",
              },
            ]}
          />
          {tab === "challans" ? (
            <DcList
              onNew={() => setView({ mode: "pick-bom" })}
              onOpen={(dc) => openDc(dc.id, dc.bomDocId)}
              onCreateReturn={createReturn}
              onViewReturns={() => setTab("returns")}
              returnsTotal={returnsCount.data?.total}
            />
          ) : (
            <ReturnsList
              onOpenReturn={openReturn}
              onOpenDc={openDc}
              onBrowseChallans={() => setTab("challans")}
              onNewReturn={() => setView({ mode: "pick-dc-return" })}
              onNewDc={() => setView({ mode: "pick-bom" })}
            />
          )}
        </Stack>
      ) : null}
      {view.mode === "pick-bom" ? (
        <PickConfirmedBom
          onBack={() => setView({ mode: "list" })}
          onPick={(bomId) => setView({ mode: "workspace", bomId, workspace: { kind: "create" } })}
        />
      ) : null}
      {view.mode === "pick-dc-return" ? (
        <PickApprovedDcForReturn onBack={backToReturns} onPick={createReturn} />
      ) : null}
      {view.mode === "create-return" ? (
        <CreateReturnWorkspace
          key={`create-rtn:${view.dcId}`}
          dcId={view.dcId}
          onBack={backToReturns}
          onPosted={(returnId) => openReturn(returnId)}
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
          onBack={() => {
            setTab("challans");
            setView({ mode: "list" });
          }}
          onCreated={(bomId, dcId) => setView({ mode: "workspace", bomId, workspace: { kind: "manage", dcId } })}
          onOpenReturn={openReturn}
          onCreateReturn={createReturn}
        />
      ) : null}
      {view.mode === "return" ? (
        <ManageReturnWorkspace
          key={view.returnId}
          returnId={view.returnId}
          onBack={backToReturns}
          onOpenDc={(dcId, bomId) => openDc(dcId, bomId)}
        />
      ) : null}
    </RequirePerm>
  );
}

function DcList({
  onNew,
  onOpen,
  onCreateReturn,
  onViewReturns,
  returnsTotal,
}: {
  onNew: () => void;
  onOpen: (dc: BomDc) => void;
  onCreateReturn: (dcId: string) => void;
  onViewReturns: () => void;
  returnsTotal?: number;
}) {
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
            <DocRefLink module="bomDc" intent={`open:${dc.id}`} className="ims-strong">
              {dc.docNo}
            </DocRefLink>
            <small className="ims-faint">{dateLabel(dc.docDate)}</small>
          </span>
        ),
      },
      {
        key: "bom",
        header: "BOM",
        cell: (dc) => (
          <span className="ims-cell-stack">
            {dc.bomDocId ? (
              <DocRefLink module="bom" intent={`open:${dc.bomDocId}`}>
                {dc.bomDocNo ?? "—"}
              </DocRefLink>
            ) : (
              <span>{dc.bomDocNo ?? "—"}</span>
            )}
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
                Linked{" "}
                {dc.invoiceId ? (
                  <DocRefLink module="sales" intent={`open:${dc.invoiceId}`}>
                    {dc.invoiceNo || (dc.invoiceStatus === "draft" ? "draft" : "invoice")}
                  </DocRefLink>
                ) : (
                  <>{dc.invoiceNo ? `· ${dc.invoiceNo}` : dc.invoiceStatus === "draft" ? "· draft invoice" : ""}</>
                )}
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
              {dc.status === "verified" && canApprove ? (
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
                <Button size="sm" variant="primary" onClick={() => onCreateReturn(dc.id)}>
                  Return
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [busy, can, canApprove, navigate, onCreateReturn, onOpen, run, state],
  );

  return (
    <Stack>
      <PageHeader
        title="Delivery challans"
        sub="Create and maintain DCs against confirmed BOMs. Unused-material returns (RTN docs like ZIG-RTN-…) live under the Returns tab."
        actions={
          <>
            {typeof returnsTotal === "number" && returnsTotal > 0 ? (
              <Button size="sm" variant="ghost" onClick={onViewReturns}>
                Returns · {returnsTotal}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onViewReturns}>
                View returns
              </Button>
            )}
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

function ReturnsList({
  onOpenReturn,
  onOpenDc,
  onBrowseChallans,
  onNewReturn,
  onNewDc,
}: {
  onOpenReturn: (returnId: string) => void;
  onOpenDc: (dcId: string, bomId: string) => void;
  onBrowseChallans: () => void;
  onNewReturn: () => void;
  onNewDc: () => void;
}) {
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

  const columns: BosColumn<BomDcReturnListRow>[] = useMemo(
    () => [
              {
                key: "returnNo",
                header: "Return no.",
                cell: (r) => (
                  <span className="ims-cell-stack">
                    <DocRefLink module="bomDc" intent={`return:${r.id}`} className="ims-strong">
                      {r.returnNo}
                    </DocRefLink>
                    <small className="ims-faint">{dateLabel(r.returnDate)}</small>
                  </span>
                ),
              },
              {
                key: "party",
                header: "Customer / BOM",
                cell: (r) => (
                  <span className="ims-cell-stack">
                    <span>{r.customerName || "No customer"}</span>
                    <small className="ims-faint">
                      {r.bomDocId ? (
                        <DocRefLink module="bom" intent={`open:${r.bomDocId}`}>
                          {r.bomDocNo ?? "—"}
                        </DocRefLink>
                      ) : (
                        r.bomDocNo ?? "—"
                      )}
                    </small>
                  </span>
                ),
              },
              {
                key: "dc",
                header: "Against DC",
                cell: (r) => (
                  <span className="ims-cell-stack">
                    <DocRefLink module="bomDc" intent={`open:${r.dcId}`}>
                      {r.dcDocNo ?? "—"}
                    </DocRefLink>
                    {r.dcStatus ? (
                      <small className="ims-faint">{BOM_DC_STATUS_LABEL[r.dcStatus as BomDcStatus] ?? r.dcStatus}</small>
                    ) : null}
                  </span>
                ),
              },
      {
        key: "lines",
        header: "Returned",
        cell: (r) => {
          const units = r.units ?? (r.lines ?? []).reduce((s, l) => s + l.qty, 0);
          const n = r.lineCount ?? (r.lines ?? []).length;
          const preview = (r.lines ?? [])
            .slice(0, 2)
            .map((l) => `${l.description}: ${l.qty} ${l.unit}`)
            .join(" · ");
          return (
            <span className="ims-cell-stack">
              <span>
                {units} units · {n} line{n === 1 ? "" : "s"}
              </span>
              {preview ? <small className="ims-faint">{preview}{(r.lines?.length ?? 0) > 2 ? "…" : ""}</small> : null}
            </span>
          );
        },
      },
      {
        key: "by",
        header: "Posted by",
        cell: (r) => (
          <span className="ims-cell-stack">
            <span className="ims-faint">{r.createdByName || "—"}</span>
            {r.notes ? <small className="ims-faint">{r.notes}</small> : null}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: 220,
        cell: (r) => (
          <div className="ims-row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }} onClick={stopRowClick} onKeyDown={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => onOpenDc(r.dcId, r.bomDocId)}>
              Open DC
            </Button>
            <Button size="sm" variant="primary" onClick={() => onOpenReturn(r.id)}>
              Open return
            </Button>
          </div>
        ),
      },
    ],
    [onOpenDc, onOpenReturn],
  );

  return (
    <Stack>
      <PageHeader
        title="Material returns"
        sub="Create and maintain RTN papers (e.g. ZIG-RTN-2026/11-0001) — compose + live preview, same pattern as delivery challans."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onNewDc}>
              New delivery challan
            </Button>
            <Button size="sm" variant="primary" onClick={onNewReturn}>
              New return
            </Button>
          </>
        }
      />
      <Alert tone="blue" title="Create & maintain">
        <b>New return</b> opens a return paper against an approved DC. Open a row to maintain notes/date and print. Quantities are fixed after
        stock is received — post another return for more unused materials.
      </Alert>
      <SearchInput
        wrapperClassName="ims-grow"
        placeholder="Search return no (RTN), DC, BOM, customer, notes…"
        aria-label="Search unused-material returns"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingBlock rows={3} /> : null}
      {!state.loading && !rows.length ? (
        <EmptyState
          glyph="↺"
          title={qDebounced ? "No matching returns" : "No returns yet"}
          actions={
            <>
              <Button size="sm" variant="primary" onClick={onNewReturn}>
                New return
              </Button>
              <Button size="sm" variant="ghost" onClick={onBrowseChallans}>
                Delivery challans
              </Button>
            </>
          }
        >
          {qDebounced
            ? "Try a shorter search, or clear the box to see all RTN documents."
            : "Create a return paper against an approved DC — post to get an RTN number like ZIG-RTN-…"}
        </EmptyState>
      ) : null}
      {rows.length ? (
        <>
          <DataTable rowKey={(r) => r.id} rows={rows} onRowClick={(r) => onOpenReturn(r.id)} columns={columns} />
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
  onOpenReturn,
  onCreateReturn,
}: {
  bomId: string;
  workspace: DcWorkspace;
  onBack: () => void;
  onCreated: (bomId: string, dcId: string) => void;
  onOpenReturn?: (returnId: string) => void;
  onCreateReturn?: (dcId: string) => void;
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
      onOpenReturn={onOpenReturn}
      onCreateReturn={onCreateReturn}
    />
  );
}
