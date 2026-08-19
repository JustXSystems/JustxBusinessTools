"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { fetchNotifications } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { NotificationItem } from "@/lib/types/notification";

export default function NotificationsPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchNotifications()
      .then((data) => setItems(data.items))
      .catch((err: Error) => setError(err.message || t("notifications.loadError")))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">🔔 {t("notifications.title")}</div>
          <div className="tool-header-sub">{t("notifications.subtitle")}</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">{t("common.loading")}</div>
        </div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="es-icon">🔔</div>
          <div className="es-title">{t("notifications.allCaughtUp")}</div>
          <div className="es-sub">{t("notifications.allCaughtUpSub")}</div>
        </div>
      ) : (
        <div className="tracker-list">
          {items.map((item) => (
            <div key={item.id} className="tracker-row">
              <div className="tracker-row-main">
                <div className="tracker-row-title">{item.icon} {item.text}</div>
                {item.date ? (
                  <div className="tracker-row-sub">{fmtDate(item.date)}</div>
                ) : null}
              </div>
              <div className="tracker-row-meta">
                <span className={`pill pill-${item.urgent ? "danger" : "neutral"}`}>
                  {item.urgent ? t("notifications.urgent") : t("notifications.upcoming")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

