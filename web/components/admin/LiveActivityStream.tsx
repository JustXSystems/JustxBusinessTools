"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Grid,
  KpiCard,
  Select,
  SearchInput,
  type BosBadgeTone,
} from "@/components/bos";
import { AdminEmpty, AdminSection, AdminTabs } from "@/components/admin/ui";
import { uniqueTools } from "@/config/tools.config";
import { adminDeepLink } from "@/lib/admin-deep-links";

export type LiveEvent = {
  id: number;
  at: string;
  eventType: string;
  toolId: string | null;
  device: string | null;
  appVersion?: string | null;
  sessionId?: string | null;
  userId?: number | null;
  actor: string | null;
  actorEmail?: string | null;
  profileName?: string | null;
  organizationName?: string | null;
  properties?: Record<string, unknown> | null;
};

export type LiveStreamStats = {
  lastHour: number;
  last15m: number;
  uniqueActors: number;
  uniqueTools: number;
  blocks: number;
  upgrades: number;
};

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

type Aspect =
  | "all"
  | "opens"
  | "writes"
  | "exports"
  | "blocks"
  | "upgrades"
  | "deletes"
  | "calc";

const ASPECTS: Array<{ id: Aspect; label: string }> = [
  { id: "all", label: "All" },
  { id: "opens", label: "Opens" },
  { id: "writes", label: "Writes" },
  { id: "exports", label: "Exports" },
  { id: "blocks", label: "Blocks" },
  { id: "upgrades", label: "Upgrades" },
  { id: "deletes", label: "Deletes" },
  { id: "calc", label: "Calc" },
];

const EVENT_META: Record<string, { label: string; tone: Tone; aspect: Aspect; hint: string }> = {
  "tool.open": {
    label: "Opened tool",
    tone: "neutral",
    aspect: "opens",
    hint: "Someone entered a tool workspace",
  },
  "record.create": {
    label: "Created record",
    tone: "success",
    aspect: "writes",
    hint: "New business record saved",
  },
  "record.update": {
    label: "Updated record",
    tone: "neutral",
    aspect: "writes",
    hint: "Existing record edited",
  },
  "record.delete": {
    label: "Deleted record",
    tone: "danger",
    aspect: "deletes",
    hint: "Record removed — review if unexpected",
  },
  "record.export": {
    label: "Exported",
    tone: "success",
    aspect: "exports",
    hint: "PDF / file export completed",
  },
  "doc.print": {
    label: "Printed",
    tone: "info",
    aspect: "exports",
    hint: "Print path used",
  },
  "calc.run": {
    label: "Ran calculator",
    tone: "neutral",
    aspect: "calc",
    hint: "Calculator action executed",
  },
  "limit.blocked": {
    label: "Limit blocked",
    tone: "warning",
    aspect: "blocks",
    hint: "Freemium / license limit stopped a save",
  },
  "upgrade.modal": {
    label: "Upgrade prompt",
    tone: "info",
    aspect: "upgrades",
    hint: "User saw an upgrade / paywall prompt",
  },
};

function toolName(id: string | null) {
  if (!id || id === "_app") return "App";
  return uniqueTools().find((t) => t.id === id)?.name ?? id;
}

function metaFor(type: string) {
  return (
    EVENT_META[type] ?? {
      label: type.replace(/\./g, " "),
      tone: "neutral" as Tone,
      aspect: "all" as Aspect,
      hint: type,
    }
  );
}

function badgeTone(tone: Tone): BosBadgeTone {
  if (tone === "success") return "emerald";
  if (tone === "warning") return "amber";
  if (tone === "danger") return "coral";
  if (tone === "info") return "blue";
  return "neutral";
}

function avatarTone(tone: Tone): string | undefined {
  if (tone === "success") return "var(--bos-emerald)";
  if (tone === "warning") return "var(--bos-amber)";
  if (tone === "danger") return "var(--bos-coral)";
  return undefined;
}

function initials(name: string | null | undefined) {
  const s = (name || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 45) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function absoluteTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function deviceLabel(device: string | null) {
  if (!device) return "Unknown device";
  const d = device.toLowerCase();
  if (d.includes("mobile") || d.includes("android") || d.includes("iphone")) return "Mobile";
  if (d.includes("tablet") || d.includes("ipad")) return "Tablet";
  if (d.includes("desktop") || d.includes("windows") || d.includes("mac")) return "Desktop";
  return device;
}

function propertyPreview(props: Record<string, unknown> | null | undefined) {
  if (!props) return null;
  const keys = Object.keys(props).slice(0, 4);
  if (!keys.length) return null;
  return keys
    .map((k) => {
      const v = props[k];
      if (v == null) return `${k}=—`;
      if (typeof v === "object") return `${k}={…}`;
      return `${k}=${String(v).slice(0, 40)}`;
    })
    .join(" · ");
}

function matchesAspect(ev: LiveEvent, aspect: Aspect) {
  if (aspect === "all") return true;
  const meta = metaFor(ev.eventType);
  if (aspect === "writes") return meta.aspect === "writes";
  return meta.aspect === aspect;
}

export function LiveActivityStream({
  events,
  stream,
}: {
  events: LiveEvent[];
  stream?: LiveStreamStats | null;
}) {
  const [aspect, setAspect] = useState<Aspect>("all");
  const [query, setQuery] = useState("");
  const [toolFilter, setToolFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const tools = useMemo(() => {
    const set = new Map<string, string>();
    for (const ev of events) {
      if (ev.toolId) set.set(ev.toolId, toolName(ev.toolId));
    }
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const devices = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) if (ev.device) set.add(ev.device);
    return [...set].sort();
  }, [events]);

  const actors = useMemo(() => {
    const set = new Map<string, string>();
    for (const ev of events) {
      const key = ev.actorEmail || ev.actor || "anonymous";
      set.set(key, ev.actor || ev.actorEmail || "Anonymous");
    }
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((ev) => {
      if (!matchesAspect(ev, aspect)) return false;
      if (toolFilter !== "all" && ev.toolId !== toolFilter) return false;
      if (deviceFilter !== "all" && (ev.device || "") !== deviceFilter) return false;
      if (actorFilter !== "all") {
        const key = ev.actorEmail || ev.actor || "anonymous";
        if (key !== actorFilter) return false;
      }
      if (!q) return true;
      const hay = [
        ev.eventType,
        metaFor(ev.eventType).label,
        ev.toolId,
        toolName(ev.toolId),
        ev.actor,
        ev.actorEmail,
        ev.device,
        ev.profileName,
        ev.organizationName,
        propertyPreview(ev.properties),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, aspect, query, toolFilter, deviceFilter, actorFilter]);

  const aspectCounts = useMemo(() => {
    const counts: Record<Aspect, number> = {
      all: events.length,
      opens: 0,
      writes: 0,
      exports: 0,
      blocks: 0,
      upgrades: 0,
      deletes: 0,
      calc: 0,
    };
    for (const ev of events) {
      const a = metaFor(ev.eventType).aspect;
      if (a !== "all") counts[a] += 1;
    }
    return counts;
  }, [events]);

  const groups = useMemo(() => {
    const map = new Map<string, LiveEvent[]>();
    for (const ev of filtered) {
      const key = dayKey(ev.at);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const stats = stream ?? {
    lastHour: 0,
    last15m: 0,
    uniqueActors: 0,
    uniqueTools: 0,
    blocks: 0,
    upgrades: 0,
  };

  function exportFiltered() {
    const lines = [
      "at,event,label,tool,actor,email,device,profile,organization,session",
      ...filtered.map((ev) =>
        [
          ev.at,
          ev.eventType,
          metaFor(ev.eventType).label,
          ev.toolId ?? "",
          ev.actor ?? "",
          ev.actorEmail ?? "",
          ev.device ?? "",
          ev.profileName ?? "",
          ev.organizationName ?? "",
          ev.sessionId ?? "",
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jbt-live-activity-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  const aspectOptions = ASPECTS.map((a) => ({
    value: a.id,
    label: `${a.label}${aspectCounts[a.id] ? ` (${aspectCounts[a.id]})` : ""}`,
  }));

  return (
    <AdminSection
      title="Live activity"
      description="Real operator usage across tools, people, devices, and conversion friction — filter by dimension."
      actions={
        <Button variant="secondary" size="sm" icon="download" onClick={exportFiltered} disabled={!filtered.length}>
          Export filtered
        </Button>
      }
    >
      <div className="admin-cc-stack">
        <Grid cols={5} min={140} gap={12}>
          <KpiCard label="Last 15 min" value={stats.last15m} delta="events" deltaTone="muted" interactive={false} />
          <KpiCard
            label="Last hour"
            value={stats.lastHour}
            delta={`${stats.uniqueActors} people · ${stats.uniqueTools} tools`}
            deltaTone="muted"
            interactive={false}
          />
          <KpiCard
            label="Blocks (1h)"
            value={stats.blocks}
            delta={stats.blocks ? "Freemium friction" : "No limit hits"}
            deltaTone={stats.blocks ? "warn" : "muted"}
            interactive={false}
          />
          <KpiCard
            label="Upgrade prompts (1h)"
            value={stats.upgrades}
            delta="paywall visibility"
            deltaTone="muted"
            interactive={false}
          />
          <KpiCard
            label="In view"
            value={filtered.length}
            delta={`of ${events.length} recent`}
            deltaTone="muted"
            interactive={false}
          />
        </Grid>

        <div className="admin-cc-filters" role="toolbar" aria-label="Live activity filters">
          <AdminTabs options={aspectOptions} value={aspect} onChange={setAspect} aria-label="Activity aspect" />
        </div>
        <div className="admin-cc-filters">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor, tool, event, branch…"
            aria-label="Search live activity"
          />
          <Select size="sm" value={toolFilter} onChange={(e) => setToolFilter(e.target.value)} aria-label="Filter by tool">
            <option value="all">All tools</option>
            {tools.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Select size="sm" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} aria-label="Filter by device">
            <option value="all">All devices</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {deviceLabel(d)}
              </option>
            ))}
          </Select>
          <Select size="sm" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} aria-label="Filter by person">
            <option value="all">All people</option>
            {actors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        {filtered.length === 0 ? (
          <AdminEmpty title="No matching events" icon="search">
            No events match these filters for the selected range.
          </AdminEmpty>
        ) : (
          <div>
            {groups.map(([day, rows]) => (
              <div key={day}>
                <h4 className="admin-cc-live-day-label">
                  <span>{day}</span>
                  <span>{rows.length} events</span>
                </h4>
                <ol className="admin-cc-live-list">
                  {rows.map((ev) => {
                    const meta = metaFor(ev.eventType);
                    const open = expanded === ev.id;
                    const propsText = propertyPreview(ev.properties);
                    return (
                      <li
                        key={ev.id || `${ev.at}-${ev.eventType}-${ev.actor}`}
                        className={`admin-cc-live-event${open ? " is-open" : ""}`}
                      >
                        <button
                          type="button"
                          className="admin-cc-live-main"
                          onClick={() => setExpanded(open ? null : ev.id)}
                          aria-expanded={open}
                        >
                          <Avatar size="sm" tone={avatarTone(meta.tone)}>
                            {initials(ev.actor)}
                          </Avatar>
                          <span className="admin-cc-live-body">
                            <span className="admin-cc-live-summary">
                              <strong>{meta.label}</strong>
                              <Badge auto tone={badgeTone(meta.tone)}>
                                {ev.eventType}
                              </Badge>
                            </span>
                            <span className="admin-cc-live-sub">
                              <span>{ev.actor || "Anonymous"}</span>
                              <span>·</span>
                              <span>{toolName(ev.toolId)}</span>
                              {ev.toolId ? (
                                <>
                                  <span>·</span>
                                  <span className="bos-mono">{ev.toolId}</span>
                                </>
                              ) : null}
                              <span>·</span>
                              <span>{deviceLabel(ev.device)}</span>
                              {ev.profileName ? (
                                <>
                                  <span>·</span>
                                  <span>{ev.profileName}</span>
                                </>
                              ) : null}
                            </span>
                          </span>
                          <span className="admin-cc-live-when" title={absoluteTime(ev.at)}>
                            {relativeTime(ev.at)}
                          </span>
                        </button>
                        {open ? (
                          <div className="admin-cc-live-detail">
                            <p className="admin-cc-note">{meta.hint}</p>
                            <ul className="admin-cc-kv">
                              <li>
                                <span>When</span>
                                <strong>{absoluteTime(ev.at)}</strong>
                              </li>
                              <li>
                                <span>Person</span>
                                <strong>
                                  {ev.actor || "Anonymous"}
                                  {ev.actorEmail ? ` · ${ev.actorEmail}` : ""}
                                </strong>
                              </li>
                              <li>
                                <span>Tool</span>
                                <strong>
                                  {toolName(ev.toolId)}
                                  {ev.toolId ? ` (${ev.toolId})` : ""}
                                </strong>
                              </li>
                              <li>
                                <span>Device</span>
                                <strong>
                                  {deviceLabel(ev.device)}
                                  {ev.appVersion ? ` · app ${ev.appVersion}` : ""}
                                </strong>
                              </li>
                              {ev.organizationName ? (
                                <li>
                                  <span>Organization</span>
                                  <strong>{ev.organizationName}</strong>
                                </li>
                              ) : null}
                              {ev.profileName ? (
                                <li>
                                  <span>Branch</span>
                                  <strong>{ev.profileName}</strong>
                                </li>
                              ) : null}
                              {ev.sessionId ? (
                                <li>
                                  <span>Session</span>
                                  <strong className="bos-mono">{ev.sessionId}</strong>
                                </li>
                              ) : null}
                              {propsText ? (
                                <li>
                                  <span>Properties</span>
                                  <strong className="bos-mono">{propsText}</strong>
                                </li>
                              ) : null}
                            </ul>
                            <div className="admin-cc-link-row">
                              {ev.toolId ? (
                                <Link href={adminDeepLink.analyticsTool(ev.toolId)}>
                                  <Button variant="ghost" size="sm">
                                    Tool deep dive
                                  </Button>
                                </Link>
                              ) : null}
                              {meta.aspect === "blocks" || meta.aspect === "upgrades" ? (
                                <Link href={adminDeepLink.profileAccess(undefined, "fabric")}>
                                  <Button variant="secondary" size="sm">
                                    Open Access Fabric
                                  </Button>
                                </Link>
                              ) : null}
                              {ev.userId ? (
                                <Link href={adminDeepLink.users(ev.userId)}>
                                  <Button variant="ghost" size="sm">
                                    Open user
                                  </Button>
                                </Link>
                              ) : ev.actorEmail ? (
                                <Link href={adminDeepLink.users()}>
                                  <Button variant="ghost" size="sm">
                                    Team directory
                                  </Button>
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminSection>
  );
}
