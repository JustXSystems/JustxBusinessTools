"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AuditEvent = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userId: number | null;
  createdAt: string;
  ip: string | null;
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ events: AuditEvent[] }>("/admin/audit?limit=100")
      .then((d) => setEvents(d.events))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading audit log…</p>;

  return (
    <section className="panel admin-card">
      <h2>Audit log</h2>
      <p className="muted">Recent actions across your organization (logins, saves, team changes).</p>
      <div className="tracker-list">
        {events.length === 0 ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="tracker-row">
              <div>
                <strong>{ev.action}</strong>
                <span className="muted">
                  {ev.createdAt.slice(0, 19).replace("T", " ")}
                  {ev.entityType ? ` · ${ev.entityType}` : ""}
                  {ev.entityId ? ` #${ev.entityId}` : ""}
                  {ev.userId ? ` · user ${ev.userId}` : ""}
                  {ev.ip ? ` · ${ev.ip}` : ""}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
