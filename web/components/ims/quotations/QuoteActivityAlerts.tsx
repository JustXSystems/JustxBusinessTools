"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, FilterChip, SearchInput } from "@/components/bos";
import {
  classifyQuoteAlert,
  money,
  quoteAlertFilterStats,
  quoteAlertMatchesFilter,
  type QuoteAlertFilter,
  type QuoteHistoryRow,
  type QuoteNotification,
} from "@/lib/quotation-v1";
import { fmtRelativeTime } from "@/lib/format";

const ALERT_FILTERS: Array<{ key: QuoteAlertFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "action", label: "Actionable" },
  { key: "approval", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "sent", label: "Sent" },
  { key: "submit", label: "Submitted" },
  { key: "link", label: "Approval Link" },
];

export function QuoteAlertsPane({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onOpenQuote,
}: {
  notifications: QuoteNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenQuote: (quotationId: string) => void;
}) {
  const [filter, setFilter] = useState<QuoteAlertFilter>("all");
  const stats = useMemo(() => quoteAlertFilterStats(notifications), [notifications]);

  const filtered = useMemo(
    () =>
      notifications.filter((n) => {
        const meta = classifyQuoteAlert(n.message);
        return quoteAlertMatchesFilter(filter, { read: n.read, kind: meta.kind, actionable: meta.actionable });
      }),
    [notifications, filter],
  );

  return (
    <Card interactive={false}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALERT_FILTERS.map((f) => (
              <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} ({stats[f.key] ?? 0})
              </FilterChip>
            ))}
          </div>
          {stats.unread > 0 ? (
            <Button size="sm" variant="secondary" onClick={onMarkAllRead}>
              Mark all read ({stats.unread})
            </Button>
          ) : null}
        </div>

        {filtered.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map((n) => {
              const meta = classifyQuoteAlert(n.message);
              const tone =
                meta.tone === "success"
                  ? "emerald"
                  : meta.tone === "danger"
                    ? "coral"
                    : meta.tone === "warning"
                      ? "amber"
                      : meta.tone === "info"
                        ? "blue"
                        : "neutral";
              return (
                <div
                  key={n.id}
                  className="ims-between"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--bos-border, #e2e8f0)",
                    background: n.read ? "transparent" : "var(--bos-surface-2, #f8fafc)",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Badge tone={tone}>
                        {meta.icon} {meta.label}
                      </Badge>
                      <span style={{ fontSize: 13.5, fontWeight: n.read ? 400 : 600 }}>{n.message}</span>
                    </div>
                    <small style={{ color: "var(--bos-muted)" }}>{n.createdAt ? fmtRelativeTime(n.createdAt) : ""}</small>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {n.quotationId ? (
                      <Button size="sm" variant="ghost" onClick={() => onOpenQuote(n.quotationId)}>
                        Open
                      </Button>
                    ) : null}
                    {!n.read ? (
                      <Button size="sm" variant="secondary" onClick={() => onMarkRead(n.id)}>
                        Read
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState glyph="🔔" title="No alerts in this view">
            Customer approvals, rejections, sends and submissions appear here automatically.
          </EmptyState>
        )}
      </div>
    </Card>
  );
}

export function QuoteActivityPane({
  history,
  onOpenQuote,
}: {
  history: Array<QuoteHistoryRow & { summary?: string }>;
  onOpenQuote: (quotationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) =>
      [h.quoteNo, h.customerName, h.status, h.preparedBy, h.action, h.summary]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ")
        .includes(q),
    );
  }, [history, query]);

  return (
    <Card interactive={false}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ maxWidth: 380 }}>
          <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity by quote no, customer, user…" />
        </div>
        {filtered.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {filtered.map((h) => (
              <div
                key={h.id}
                className="ims-between"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--bos-border, #e2e8f0)",
                  gap: 10,
                }}
              >
                <div style={{ display: "grid", gap: 3 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="ims-mono ims-strong">{h.quoteNo || "Quotation"}</span>
                    {h.status ? <Badge tone="neutral">{h.status}</Badge> : null}
                    <span style={{ fontSize: 13 }}>{h.summary || `${h.customerName} · ${h.action || "saved"}`}</span>
                  </div>
                  <small style={{ color: "var(--bos-muted)" }}>
                    {h.preparedBy ? `${h.preparedBy} · ` : ""}
                    {h.grand ? `₹${money(h.grand)} · ` : ""}
                    {h.savedAt ? fmtRelativeTime(h.savedAt) : ""}
                  </small>
                </div>
                {h.quotationId ? (
                  <Button size="sm" variant="ghost" onClick={() => onOpenQuote(h.quotationId)}>
                    Open
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState glyph="🕘" title="No quotation activity yet">
            Every create, update, revision, send and conversion is logged here.
          </EmptyState>
        )}
      </div>
    </Card>
  );
}
