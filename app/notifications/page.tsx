"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { fmtDate } from "@/lib/format";
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

export default function NotificationsPage() {
  const { t } = useLocale();
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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
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
  }, [t]);

  useLiveRefresh(load, { intervalMs: 30_000 });

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter === "all") return true;
      if (filter === "unread") return !item.read;
      if (filter === "urgent") return item.urgent;
      return item.category === filter;
    });
  }, [items, filter]);

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
      <div className="tool-header">
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
            className="btn-ghost notif-mark-all"
            disabled={busy}
            onClick={() => void onMarkAll()}
          >
            {t("notifications.markAllRead")}
          </button>
        ) : null}
      </div>

      <div className="notif-kpis">
        <div className="notif-kpi">
          <span className="notif-kpi-val">{items.length}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiTotal")}</span>
        </div>
        <div className="notif-kpi">
          <span className="notif-kpi-val">{unreadCount}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiUnread")}</span>
        </div>
        <div className="notif-kpi notif-kpi-urgent">
          <span className="notif-kpi-val">{urgentCount}</span>
          <span className="notif-kpi-lbl">{t("notifications.kpiUrgent")}</span>
        </div>
      </div>

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

      {loading ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">{t("common.loading")}</div>
        </div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="es-icon">🔔</div>
          <div className="es-title">{t("notifications.allCaughtUp")}</div>
          <div className="es-sub">{t("notifications.allCaughtUpSub")}</div>
        </div>
      ) : (
        <div className="tracker-list notif-list">
          {filtered.map((item) => {
            const inner = (
              <>
                <div className="notif-row-icon" aria-hidden>
                  {item.icon}
                </div>
                <div className="tracker-row-main">
                  <div className="tracker-row-title">{item.title}</div>
                  <div className="tracker-row-sub">{item.text}</div>
                  <div className="notif-row-meta-line">
                    <span className="notif-cat">{item.category}</span>
                    {item.date ? <span>· {fmtDate(item.date)}</span> : null}
                    {item.source === "derived" ? (
                      <span>· {t("notifications.liveReminder")}</span>
                    ) : null}
                  </div>
                </div>
                <div className="tracker-row-meta">
                  <span className={`pill ${SEVERITY_PILL[item.severity] ?? "pill-neutral"}`}>
                    {item.urgent
                      ? t("notifications.urgent")
                      : item.severity === "attention"
                        ? t("notifications.attention")
                        : t("notifications.upcoming")}
                  </span>
                  {!item.read && item.source === "event" ? (
                    <button
                      type="button"
                      className="btn-ghost notif-read-btn"
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
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`tracker-row notif-row${item.read ? " is-read" : " is-unread"}`}
                  onClick={() => void onMarkRead(item)}
                >
                  {inner}
                </Link>
              );
            }

            return (
              <div
                key={item.id}
                className={`tracker-row notif-row${item.read ? " is-read" : " is-unread"}`}
              >
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
