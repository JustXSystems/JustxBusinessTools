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
  const [unreadCount, setUnreadCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
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
      setUnreadCount(data.unreadCount ?? 0);
      setUrgentCount(data.urgentCount ?? 0);
      setRole(data.role ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notifications.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, allowed]);

  useLiveRefresh(load, { intervalMs: 30_000, enabled: allowed });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "all") {
        /* keep */
      } else if (filter === "unread") {
        if (item.read) return false;
      } else if (filter === "urgent") {
        if (!item.urgent) return false;
      } else if (item.category !== filter) {
        return false;
      }
      if (!q) return true;
      const hay = `${item.title} ${item.text} ${item.category} ${item.eventType}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, filter, query]);

  const actionCount = useMemo(
    () => items.filter((i) => !i.read && (i.urgent || Boolean(i.href))).length,
    [items],
  );

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
      setUnreadCount((c) => Math.max(0, c - 1));
      if (item.urgent) setUrgentCount((c) => Math.max(0, c - 1));
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
      <header className="notif-hero">
        <div className="notif-hero-copy">
          <p className="notif-hero-eyebrow">Operations · Command</p>
          <div className="tool-header notif-hero-row">
            <Link href="/" className="back-btn" aria-label="Back">
              ←
            </Link>
            <div className="tool-header-text">
              <div className="tool-header-title">{t("notifications.title")}</div>
              <div className="tool-header-sub">{roleHint}</div>
            </div>
            {unreadCount > 0 ? (
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
        </div>
        <div className="notif-hero-pulse" aria-hidden />
      </header>

      <div className="notif-kpis" aria-label="Alert summary">
        <button
          type="button"
          className={`notif-kpi${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <span className="notif-kpi-val">{items.length}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiTotal")}</span>
        </button>
        <button
          type="button"
          className={`notif-kpi notif-kpi-unread${filter === "unread" ? " is-active" : ""}`}
          onClick={() => setFilter("unread")}
        >
          <span className="notif-kpi-val">{unreadCount}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiUnread")}</span>
        </button>
        <button
          type="button"
          className={`notif-kpi notif-kpi-urgent${filter === "urgent" ? " is-active" : ""}`}
          onClick={() => setFilter("urgent")}
        >
          <span className="notif-kpi-val">{urgentCount}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiUrgent")}</span>
        </button>
        <div className="notif-kpi notif-kpi-action" aria-label="Needs action">
          <span className="notif-kpi-val">{actionCount}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiAction")}</span>
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
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`notif-filter${filter === key ? " active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
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

      {loading ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">{t("common.loading")}</div>
        </div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state notif-empty">
          <div className="notif-empty-orb" aria-hidden />
          <div className="es-title">{t("notifications.allCaughtUp")}</div>
          <div className="es-sub">{t("notifications.allCaughtUpSub")}</div>
        </div>
      ) : (
        <div className="tracker-list notif-list">
          {filtered.map((item) => {
            const tone = SEVERITY_TONE[item.severity] ?? "info";
            const severityLabel = item.urgent
              ? t("notifications.urgent")
              : item.severity === "attention"
                ? t("notifications.attention")
                : t("notifications.upcoming");

            const body = (
              <>
                <div className={`notif-row-rail tone-${tone}`} aria-hidden />
                <div className={`notif-row-icon tone-${tone}`} aria-hidden>
                  {item.icon}
                </div>
                <div className="tracker-row-main notif-row-main">
                  <div className="notif-row-top">
                    <span className="notif-cat">{item.category}</span>
                    <time
                      className="notif-row-time"
                      dateTime={item.createdAt || item.date || undefined}
                      title={item.createdAt || item.date || undefined}
                    >
                      {fmtRelativeTime(item.createdAt || item.date)}
                    </time>
                  </div>
                  <div className="tracker-row-title">{item.title}</div>
                  <div className="tracker-row-sub">{item.text}</div>
                  <div className="notif-row-meta-line">
                    {item.date ? <span>{fmtDate(item.date)}</span> : null}
                    {item.source === "derived" ? (
                      <span>· {t("notifications.liveReminder")}</span>
                    ) : null}
                    {!item.read ? <span className="notif-live-tag">Live</span> : null}
                  </div>
                </div>
                <div className="tracker-row-meta notif-row-aside">
                  <span className={`pill ${SEVERITY_PILL[item.severity] ?? "pill-neutral"}`}>
                    {severityLabel}
                  </span>
                  <div className="notif-row-actions">
                    {item.href ? (
                      <span className="notif-open-hint">{t("notifications.open")}</span>
                    ) : null}
                    {!item.read && item.source === "event" ? (
                      <button
                        type="button"
                        className="btn btn-secondary notif-read-btn"
                        disabled={busy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void onMarkRead(item);
                        }}
                      >
                        {t("notifications.markRead")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`tracker-row notif-row tone-${tone}${item.read ? " is-read" : " is-unread"}`}
                  onClick={() => void onMarkRead(item)}
                >
                  {body}
                </Link>
              );
            }

            return (
              <div
                key={item.id}
                className={`tracker-row notif-row tone-${tone}${item.read ? " is-read" : " is-unread"}`}
              >
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
