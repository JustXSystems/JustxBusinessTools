"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { canViewNotifications } from "@/lib/auth-access";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { fmtDate, fmtRelativeTime } from "@/lib/format";
import { useLiveRefresh, invalidateLiveData } from "@/hooks/useLiveRefresh";
import type {
  NotificationCategory,
  NotificationItem,
  NotificationSeverity,
} from "@/lib/types/notification";

type FilterKey = "all" | "unread" | "urgent" | NotificationCategory;

const SEVERITY_PILL: Record<NotificationSeverity, string> = {
  info: "pill-neutral",
  attention: "pill-warning",
  urgent: "pill-danger",
  critical: "pill-danger",
};

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  info: "info",
  attention: "warning",
  urgent: "danger",
  critical: "danger",
};

export default function NotificationsPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const allowed = canViewNotifications(user);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: NotificationCategory; label: string; count: number }>
  >([]);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchNotifications();
      setItems(data.items);
      setCategories(data.categories ?? []);
      setRole(data.role ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notifications.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, allowed]);

  useLiveRefresh(load, { intervalMs: 30_000, enabled: allowed });

  /** Single source of truth from loaded items (avoids API/local drift after mark-read). */
  const liveCounts = useMemo(() => {
    let unread = 0;
    let urgent = 0;
    let action = 0;
    const byCat = new Map<NotificationCategory, number>();
    for (const item of items) {
      if (!item.read) unread += 1;
      if (item.urgent && !item.read) urgent += 1;
      if (!item.read && (item.urgent || Boolean(item.href))) action += 1;
      byCat.set(item.category, (byCat.get(item.category) ?? 0) + 1);
    }
    return {
      total: items.length,
      unread,
      urgent,
      action,
      byCat,
    };
  }, [items]);

  const matchesFilter = useCallback((item: NotificationItem, key: FilterKey) => {
    if (key === "all") return true;
    if (key === "unread") return !item.read;
    if (key === "urgent") return item.urgent && !item.read;
    return item.category === key;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!q) return true;
      const hay = `${item.title} ${item.text} ${item.category} ${item.eventType}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, filter, query, matchesFilter]);

  const filterChipCounts = useMemo(() => {
    return {
      all: liveCounts.total,
      unread: liveCounts.unread,
      urgent: liveCounts.urgent,
    } as Record<string, number>;
  }, [liveCounts]);

  if (!allowed) {
    return (
      <div className="page">
        <h1 className="page-title">Notifications</h1>
        <p className="section-note">
          Notifications are available to Business Owners and Staff on this Business Profile.
        </p>
        <Link href="/" className="btn btn-secondary">
          Back to Home
        </Link>
      </div>
    );
  }

  async function onMarkRead(item: NotificationItem) {
    if (item.read || item.source !== "event") return;
    setBusy(true);
    try {
      await markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
      );
      invalidateLiveData("notifications");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  async function onMarkAll() {
    setBusy(true);
    try {
      await markAllNotificationsRead();
      invalidateLiveData("notifications");
      await load();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  function severityLabel(item: NotificationItem) {
    if (item.urgent) return t("notifications.urgent");
    if (item.severity === "attention") return t("notifications.attention");
    return t("notifications.upcoming");
  }

  const roleHint =
    role === "admin"
      ? t("notifications.roleAdmin")
      : role === "owner"
        ? t("notifications.roleOwner")
        : role === "staff"
          ? t("notifications.roleStaff")
          : t("notifications.subtitle");

  return (
    <div className="notif-page">
      <div className="tool-header notif-hero-row">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">{t("notifications.title")}</div>
          <div className="tool-header-sub">{roleHint}</div>
        </div>
        {liveCounts.unread > 0 ? (
          <button
            type="button"
            className="btn btn-secondary notif-mark-all"
            disabled={busy}
            onClick={() => void onMarkAll()}
          >
            {t("notifications.markAllRead")}
          </button>
        ) : null}
      </div>

      <div className="notif-stats" aria-label="Alert summary">
        <button
          type="button"
          className={`notif-stat${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <span className="notif-stat-val">{liveCounts.total}</span>
          <span className="notif-stat-lbl">{t("notifications.kpiTotal")}</span>
        </button>
        <button
          type="button"
          className={`notif-stat is-unread${filter === "unread" ? " is-active" : ""}`}
          onClick={() => setFilter("unread")}
        >
          <span className="notif-stat-val">{liveCounts.unread}</span>
          <span className="notif-stat-lbl">{t("notifications.kpiUnread")}</span>
        </button>
        <button
          type="button"
          className={`notif-stat is-urgent${filter === "urgent" ? " is-active" : ""}`}
          onClick={() => setFilter("urgent")}
        >
          <span className="notif-stat-val">{liveCounts.urgent}</span>
          <span className="notif-stat-lbl">{t("notifications.kpiUrgent")}</span>
        </button>
        <div className="notif-stat is-action">
          <span className="notif-stat-val">{liveCounts.action}</span>
          <span className="notif-stat-lbl">{t("notifications.kpiAction")}</span>
        </div>
      </div>

      <div className="notif-toolbar">
        <div className="notif-filters" role="tablist" aria-label="Notification filters">
          {(
            [
              ["all", t("notifications.filterAll")],
              ["unread", t("notifications.filterUnread")],
              ["urgent", t("notifications.filterUrgent")],
              ...categories.map((c) => [c.id, c.label] as const),
            ] as Array<[FilterKey, string]>
          ).map(([key, label]) => {
            const count =
              key === "all" || key === "unread" || key === "urgent"
                ? filterChipCounts[key]
                : (liveCounts.byCat.get(key as NotificationCategory) ?? 0);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={`notif-filter${filter === key ? " active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="notif-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="notif-search">
          <span className="sr-only">{t("notifications.search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("notifications.searchPlaceholder")}
          />
        </label>
      </div>

      {items.length > 0 ? (
        <div className="notif-meta">
          Showing <b>{filtered.length}</b> of {items.length}
          {filter !== "all" || query.trim() ? (
            <span className="notif-meta-tag">{t("notifications.filtered")}</span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">{t("common.loading")}</div>
        </div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state notif-empty">
          <div className="es-title">{t("notifications.allCaughtUp")}</div>
          <div className="es-sub">{t("notifications.allCaughtUpSub")}</div>
        </div>
      ) : (
        <>
          <div className="notif-cards" aria-label="Alerts">
            {filtered.map((item) => {
              const tone = SEVERITY_TONE[item.severity] ?? "info";
              return (
                <article
                  key={item.id}
                  className={`notif-mcard tone-${tone}${item.read ? " is-read" : " is-unread"}`}
                >
                  <div className="notif-mcard-top">
                    <span className="notif-cat">{item.category}</span>
                    <time
                      dateTime={item.createdAt || item.date || undefined}
                      title={item.createdAt || item.date || undefined}
                    >
                      {fmtRelativeTime(item.createdAt || item.date)}
                    </time>
                  </div>
                  <strong className="notif-mcard-title">{item.title}</strong>
                  <p className="notif-mcard-text">{item.text}</p>
                  <dl className="notif-mcard-grid">
                    <div>
                      <dt>{t("notifications.colSeverity")}</dt>
                      <dd>
                        <span className={`pill ${SEVERITY_PILL[item.severity] ?? "pill-neutral"}`}>
                          {severityLabel(item)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("notifications.colStatus")}</dt>
                      <dd>{item.read ? t("notifications.read") : t("notifications.unread")}</dd>
                    </div>
                    <div>
                      <dt>{t("notifications.colDate")}</dt>
                      <dd>{item.date ? fmtDate(item.date) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("notifications.colSource")}</dt>
                      <dd>
                        {item.source === "derived"
                          ? t("notifications.liveReminder")
                          : t("notifications.event")}
                      </dd>
                    </div>
                  </dl>
                  <div className="notif-mcard-actions">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="btn btn-primary btn-sm"
                        onClick={() => void onMarkRead(item)}
                      >
                        {t("notifications.open")}
                      </Link>
                    ) : null}
                    {!item.read && item.source === "event" ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => void onMarkRead(item)}
                      >
                        {t("notifications.markRead")}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="notif-table-wrap">
            <table className="notif-table">
              <thead>
                <tr>
                  <th>{t("notifications.colWhen")}</th>
                  <th>{t("notifications.colCategory")}</th>
                  <th>{t("notifications.colSeverity")}</th>
                  <th>{t("notifications.colStatus")}</th>
                  <th>{t("notifications.colTitle")}</th>
                  <th>{t("notifications.colDetail")}</th>
                  <th className="actions">{t("notifications.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const tone = SEVERITY_TONE[item.severity] ?? "info";
                  return (
                    <tr
                      key={item.id}
                      className={`tone-${tone}${item.read ? " is-read" : " is-unread"}`}
                    >
                      <td className="nowrap">
                        <time
                          dateTime={item.createdAt || item.date || undefined}
                          title={item.createdAt || item.date || undefined}
                        >
                          {fmtRelativeTime(item.createdAt || item.date)}
                        </time>
                      </td>
                      <td className="notif-td-cat">{item.category}</td>
                      <td>
                        <span className={`pill ${SEVERITY_PILL[item.severity] ?? "pill-neutral"}`}>
                          {severityLabel(item)}
                        </span>
                      </td>
                      <td>
                        {item.read ? (
                          <span className="muted">{t("notifications.read")}</span>
                        ) : (
                          <span className="notif-live-tag">{t("notifications.unread")}</span>
                        )}
                      </td>
                      <td className="notif-td-title" title={item.title}>
                        {item.href ? (
                          <Link href={item.href} onClick={() => void onMarkRead(item)}>
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </td>
                      <td className="notif-td-detail" title={item.text}>
                        {item.text}
                      </td>
                      <td className="actions">
                        <div className="notif-row-actions">
                          {item.href ? (
                            <Link
                              href={item.href}
                              className="btn btn-primary btn-sm"
                              onClick={() => void onMarkRead(item)}
                            >
                              {t("notifications.open")}
                            </Link>
                          ) : null}
                          {!item.read && item.source === "event" ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => void onMarkRead(item)}
                            >
                              {t("notifications.markRead")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
