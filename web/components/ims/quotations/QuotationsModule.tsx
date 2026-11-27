"use client";

import "./quotations.css";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, useToast } from "@/components/bos";
import {
  imsQuotations,
  DEFAULT_IMS_QUOTE_SETTINGS,
  type ImsQuotation,
  type ImsQuoteConfigResponse,
  type ImsQuoteConvertTarget,
  type ImsQuoteStockInfo,
} from "@/lib/ims/quotations";
import {
  buildTerms,
  DEFAULT_COMPANY,
  DEFAULT_SEND_SETTINGS,
  newQuotationDraft,
  uid,
  type ProfileQuoteTerms,
  type QuoteHistoryRow,
  type QuoteNotification,
} from "@/lib/quotation-v1";
import { LoadingBlock, PageHeader, RequirePerm, Stack, SubTabs, useIms, useOpenIntent } from "../core";
import { QuoteActivityPane, QuoteAlertsPane } from "./QuoteActivityAlerts";
import { QuoteComposer } from "./QuoteComposer";
import { QuoteRegister } from "./QuoteRegister";

type Tab = "compose" | "list" | "activity" | "alerts";

function freshDraftFor(
  cfg: ImsQuoteConfigResponse | null,
  actor: { name: string | null; email: string | null },
): ImsQuotation {
  const qs = cfg?.quoteSettings ?? DEFAULT_IMS_QUOTE_SETTINGS;
  const preparedBy = actor.name?.trim() || actor.email?.split("@")[0] || "";
  const draft = newQuotationDraft("solar", undefined, preparedBy, (qs.termsByEngagement ?? {}) as ProfileQuoteTerms) as ImsQuotation;
  draft.preparedBy = preparedBy;
  draft.preparedByEmail = actor.email ?? "";
  draft.showGstColumns = qs.defaultShowGstColumns;
  if (qs.defaultGstNote) draft.gstNote = qs.defaultGstNote;
  if (qs.defaultBuybackLabel) draft.buybackLabel = qs.defaultBuybackLabel;
  if (qs.defaultValidityDays > 0 && draft.date) {
    const d = new Date(`${draft.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + qs.defaultValidityDays);
    draft.validTill = d.toISOString().slice(0, 10);
  }
  draft.notes = buildTerms(draft.category, draft.engagement, (qs.termsByEngagement ?? {}) as ProfileQuoteTerms);
  return draft;
}

export default function QuotationsModule() {
  const { session, navigate } = useIms();
  const openIntent = useOpenIntent("quotations");
  const toast = useToast();

  const [tab, setTab] = useState<Tab>(openIntent ? "compose" : "list");
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<ImsQuoteConfigResponse | null>(null);
  const [quotations, setQuotations] = useState<ImsQuotation[]>([]);
  const [alerts, setAlerts] = useState<QuoteNotification[]>([]);
  const [history, setHistory] = useState<Array<QuoteHistoryRow & { summary?: string }>>([]);
  const [activeQuote, setActiveQuote] = useState<ImsQuotation | null>(null);
  const [stockByItem, setStockByItem] = useState<Record<string, ImsQuoteStockInfo>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importingLegacy, setImportingLegacy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, listRes, alertRes, actRes] = await Promise.all([
        imsQuotations.config(),
        imsQuotations.list(),
        imsQuotations.alerts(),
        imsQuotations.activity(),
      ]);
      setCfg(c);
      setQuotations(listRes.quotations);
      setAlerts(alertRes.notifications);
      setHistory(actRes.history);

      if (openIntent) {
        const found = listRes.quotations.find((x) => x.id === openIntent);
        if (found) {
          const detail = await imsQuotations.get(found.id).catch(() => null);
          setActiveQuote(detail?.quotation ?? found);
          setStockByItem(detail?.stockByItem ?? {});
          setTab("compose");
        } else {
          setActiveQuote(freshDraftFor(c, session.actor));
        }
      } else {
        setActiveQuote((prev) => prev ?? freshDraftFor(c, session.actor));
      }
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Failed to load IMS Quotations" });
    } finally {
      setLoading(false);
    }
  }, [openIntent, session.actor, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openQuote = async (q: ImsQuotation) => {
    setActiveQuote(q);
    setTab("compose");
    try {
      const detail = await imsQuotations.get(q.id);
      setActiveQuote(detail.quotation);
      setStockByItem(detail.stockByItem);
    } catch {
      setStockByItem({});
    }
  };

  const openQuoteById = (id: string) => {
    const found = quotations.find((q) => q.id === id);
    if (found) void openQuote(found);
  };

  const startNew = () => {
    setActiveQuote(freshDraftFor(cfg, session.actor));
    setStockByItem({});
    setTab("compose");
  };

  const handleSaved = (saved: ImsQuotation) => {
    setActiveQuote(saved);
    setQuotations((prev) => {
      const idx = prev.findIndex((x) => x.id === saved.id);
      if (idx >= 0) return prev.map((x, i) => (i === idx ? saved : x));
      return [saved, ...prev];
    });
    void imsQuotations.alerts().then((r) => setAlerts(r.notifications)).catch(() => undefined);
    void imsQuotations.activity().then((r) => setHistory(r.history)).catch(() => undefined);
  };

  const handleDuplicate = (q: ImsQuotation) => {
    const copy: ImsQuotation = {
      ...q,
      id: uid(),
      quoteNo: null,
      status: "draft",
      revision: 1,
      parentQuoteId: null,
      conversions: undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      rejectedAt: undefined,
      rejectedBy: undefined,
      history: [],
    };
    setActiveQuote(copy);
    setTab("compose");
    toast.show({ tone: "blue", title: `Duplicated ${q.quoteNo || "quotation"} as a new draft` });
  };

  const handleRevise = async (q: ImsQuotation) => {
    setBusyId(q.id);
    try {
      const res = await imsQuotations.revise(q.id);
      handleSaved(res.quotation);
      setTab("compose");
      toast.show({ tone: "emerald", title: `Created revision ${res.quotation.quoteNo}` });
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Failed to create revision" });
    } finally {
      setBusyId(null);
    }
  };

  const handleConvert = async (q: ImsQuotation, target: ImsQuoteConvertTarget) => {
    setBusyId(q.id);
    try {
      const res = await imsQuotations.convert(q.id, target);
      toast.show({
        tone: "emerald",
        title: res.alreadyExisted
          ? `Already linked to ${res.docNo} — opening it now.`
          : `Created ${res.docNo} from ${q.quoteNo}`,
      });
      if (target === "sales_order") navigate("salesOrders", `open:${res.id}`);
      else if (target === "bom") navigate("bom", res.id);
      else navigate("sales", `open:${res.id}`);
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Conversion failed" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (q: ImsQuotation) => {
    if (!window.confirm(`Delete quotation ${q.quoteNo || ""}? This cannot be undone.`)) return;
    setBusyId(q.id);
    try {
      await imsQuotations.remove(q.id);
      setQuotations((prev) => prev.filter((x) => x.id !== q.id));
      if (activeQuote?.id === q.id) startNew();
      toast.show({ tone: "emerald", title: `Deleted ${q.quoteNo || "quotation"}` });
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Delete failed" });
    } finally {
      setBusyId(null);
    }
  };

  const handleImportLegacy = async () => {
    setImportingLegacy(true);
    try {
      const res = await imsQuotations.importLegacy();
      toast.show({ tone: "emerald", title: `Imported ${res.imported} Quotation V1 record${res.imported === 1 ? "" : "s"} into IMS` });
      await loadAll();
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Import failed" });
    } finally {
      setImportingLegacy(false);
    }
  };

  const unreadAlerts = alerts.filter((a) => !a.read).length;

  return (
    <RequirePerm perm={["quotations", "sales"]} what="quotations">
      <Stack>
        <PageHeader
          title="Quotations"
          sub="Full Quotation Generator V1 workflow inside IMS — with live catalog stock, customer approval links, PDF/Email/WhatsApp, and 1-click conversion to Sales Orders, Invoices & BOMs."
        />

        {cfg && cfg.legacyCount > 0 ? (
          <Alert tone="blue" title={`${cfg.legacyCount} existing Quotation V1 record${cfg.legacyCount === 1 ? "" : "s"} found for this business`}>
            <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
              <span>
                Bring all existing standalone Quotation V1 quotes into IMS Quotations with the same quote numbers, statuses, and active approval links.
              </span>
              <Button size="sm" variant="primary" disabled={importingLegacy} onClick={() => void handleImportLegacy()}>
                {importingLegacy ? "Importing…" : `Import ${cfg.legacyCount} into IMS`}
              </Button>
            </div>
          </Alert>
        ) : null}

        <SubTabs
          label="Quotations views"
          value={tab}
          onChange={setTab}
          options={[
            { value: "list", label: `Saved Quotations (${quotations.length})` },
            { value: "compose", label: activeQuote?.quoteNo ? `Editing ${activeQuote.quoteNo}` : "New Quotation" },
            { value: "activity", label: "Activity" },
            { value: "alerts", label: unreadAlerts > 0 ? `Alerts (${unreadAlerts})` : "Alerts" },
          ]}
        />

        {loading || !activeQuote ? (
          <LoadingBlock />
        ) : tab === "compose" ? (
          <QuoteComposer
            quote={activeQuote}
            onChange={setActiveQuote}
            company={cfg?.company ?? DEFAULT_COMPANY}
            quoteSettings={cfg?.quoteSettings ?? DEFAULT_IMS_QUOTE_SETTINGS}
            sendSettings={cfg?.sendSettings ?? DEFAULT_SEND_SETTINGS}
            emailWebhookConfigured={Boolean(cfg?.emailWebhookConfigured)}
            whatsappAutoAttach={Boolean(cfg?.whatsappConfig?.canAutoAttach)}
            allQuotations={quotations}
            stockByItem={stockByItem}
            onSaved={handleSaved}
            onNew={startNew}
            onRevise={(q) => void handleRevise(q)}
            onConvert={(q, target) => void handleConvert(q, target)}
          />
        ) : tab === "list" ? (
          <QuoteRegister
            quotations={quotations}
            company={cfg?.company ?? DEFAULT_COMPANY}
            onOpen={(q) => void openQuote(q)}
            onNew={startNew}
            onDuplicate={handleDuplicate}
            onRevise={(q) => void handleRevise(q)}
            onConvert={(q, target) => void handleConvert(q, target)}
            onDelete={(q) => void handleDelete(q)}
            busyId={busyId}
          />
        ) : tab === "activity" ? (
          <QuoteActivityPane history={history} onOpenQuote={openQuoteById} />
        ) : (
          <QuoteAlertsPane
            notifications={alerts}
            onOpenQuote={openQuoteById}
            onMarkRead={(id) => {
              void imsQuotations.markAlertRead(id).then(() => {
                setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
              });
            }}
            onMarkAllRead={() => {
              void imsQuotations.markAllAlertsRead().then(() => {
                setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
              });
            }}
          />
        )}
      </Stack>
    </RequirePerm>
  );
}
