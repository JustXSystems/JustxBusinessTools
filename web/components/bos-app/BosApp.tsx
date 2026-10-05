"use client";

import "./bos-app.css";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Avatar,
  BosRoot,
  Brand,
  Button,
  CommandPalette,
  Footnote,
  IconButton,
  SearchInput,
  Segmented,
  Skeleton,
  ThemeToggle,
  Topbar,
  useBosTheme,
  useCommandHotkey,
  useToast,
  type BosCommand,
} from "@/components/bos";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { bos, BosApiError, type BosSession, type BosSettings } from "@/lib/bos-app/api";
import { initialsOf } from "@/lib/bos-app/format";
import { BosAppProvider, ErrorBlock, LoadingBlock, WORKSPACES, type BosAppContextValue, type WorkspaceKey } from "./core";
import { HomeWorkspace } from "./home/HomeWorkspace";

const ConnectWorkspace = lazy(() => import("./connect/ConnectWorkspace").then((m) => ({ default: m.ConnectWorkspace })));
const FinanceWorkspace = lazy(() => import("./finance/FinanceWorkspace").then((m) => ({ default: m.FinanceWorkspace })));
const HrWorkspace = lazy(() => import("./hr/HrWorkspace").then((m) => ({ default: m.HrWorkspace })));
const ProjectsWorkspace = lazy(() => import("./projects/ProjectsWorkspace").then((m) => ({ default: m.ProjectsWorkspace })));
const SettingsWorkspace = lazy(() => import("./settings/SettingsWorkspace").then((m) => ({ default: m.SettingsWorkspace })));

export const BOS_LOGO = "/icons/justx-bos-mark.png";
const WS_KEYS = new Set<string>(WORKSPACES.map((w) => w.value));

export type BosAppMode = "tool" | "standalone";

type NavState = {
  ws: WorkspaceKey;
  modules: Partial<Record<WorkspaceKey, string>>;
  intent: { module: string; value: string } | null;
  seq: number;
};

/** `?ws=finance&m=invoices&open=<id>` — the same links BOS puts into JBT notifications. */
function navFromUrl(): NavState {
  const base: NavState = { ws: "home", modules: {}, intent: null, seq: 0 };
  if (typeof window === "undefined") return base;
  const q = new URLSearchParams(window.location.search);
  const ws = q.get("ws");
  if (!ws || !WS_KEYS.has(ws)) return base;
  const m = q.get("m") ?? undefined;
  const open = q.get("open");
  return { ws: ws as WorkspaceKey, modules: m ? { [ws]: m } : {}, intent: m && open ? { module: m, value: `open:${open}` } : null, seq: 0 };
}

function writeUrl(ws: WorkspaceKey, module: string | undefined) {
  const url = new URL(window.location.href);
  url.searchParams.delete("open");
  if (ws === "home" && !module) {
    url.searchParams.delete("ws");
    url.searchParams.delete("m");
  } else {
    url.searchParams.set("ws", ws);
    if (module) url.searchParams.set("m", module);
    else url.searchParams.delete("m");
  }
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
}

function Shell({ session: initial, mode, onSignOut }: { session: BosSession; mode: BosAppMode; onSignOut?: () => void }) {
  const logoSrc = publicAssetUrl(BOS_LOGO);
  const { theme, setTheme, toggleTheme } = useBosTheme();
  const { show } = useToast();
  const [session, setSession] = useState(initial);
  const [nav, setNav] = useState<NavState>(navFromUrl);
  const [version, setVersion] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const synced = useRef(false);

  useCommandHotkey(() => setPaletteOpen(true));

  useEffect(() => {
    writeUrl(nav.ws, nav.modules[nav.ws]);
  }, [nav.ws, nav.modules]);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

  const navigate = useCallback((ws: WorkspaceKey, module?: string, intent?: string) => {
    setNav((n) => ({
      ws,
      modules: module ? { ...n.modules, [ws]: module } : n.modules,
      intent: intent && module ? { module, value: intent } : null,
      seq: intent ? n.seq + 1 : n.seq,
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const selectModule = useCallback((ws: WorkspaceKey, module: string) => {
    setNav((n) => ({ ...n, modules: { ...n.modules, [ws]: module }, intent: null }));
  }, []);

  /* Pull fresh quotations / surveys in once per load (server throttles and honours the auto-sync setting). */
  useEffect(() => {
    if (synced.current || !session.settings.autoSync || !session.connectors.length) return;
    synced.current = true;
    bos
      .sync(false)
      .then((r) => {
        if (!r.imported.length) return;
        show({ tone: "blue", title: `${r.imported.length} new item${r.imported.length === 1 ? "" : "s"} from your tools`, description: r.imported.slice(0, 3).map((i) => i.label).join(" · ") });
        invalidate();
      })
      .catch(() => undefined);
  }, [session.settings.autoSync, session.connectors.length, show, invalidate]);

  const ctx = useMemo<BosAppContextValue>(
    () => ({
      session,
      mode,
      logoSrc,
      canManage: session.actor.canManage,
      version,
      invalidate,
      navigate,
      takeIntent: (module) => (nav.intent?.module === module ? nav.intent.value : null),
      navSeq: nav.seq,
      moduleOf: (ws) => nav.modules[ws],
      selectModule,
      setSettings: (settings: BosSettings) => setSession((s) => ({ ...s, settings })),
      openPalette: () => setPaletteOpen(true),
    }),
    [session, mode, logoSrc, version, invalidate, navigate, nav, selectModule],
  );

  const go = (ws: WorkspaceKey, module?: string, intent?: string) => () => navigate(ws, module, intent);
  const commands: BosCommand[] = [
    ...WORKSPACES.map((w) => ({ id: `ws-${w.value}`, section: "Navigate", label: w.label, icon: "⧉", onSelect: go(w.value) })),
    { id: "inv-new", section: "Finance", label: "Create GST invoice", icon: "＋", keywords: "bill tax invoice new", onSelect: go("finance", "invoices", "new") },
    { id: "inv", section: "Finance", label: "Invoices", icon: "🧾", onSelect: go("finance", "invoices") },
    { id: "ar", section: "Finance", label: "Receivables & collections", icon: "💰", keywords: "payment outstanding aging", onSelect: go("finance", "receivables") },
    { id: "ap", section: "Finance", label: "Vendor bills (payables)", icon: "📤", keywords: "bill vendor approve", onSelect: go("finance", "payables") },
    { id: "exp", section: "Finance", label: "Claim an expense", icon: "💼", keywords: "reimbursement claim", onSelect: go("finance", "expenses", "new") },
    { id: "cust", section: "Finance", label: "Customers & vendors", icon: "👥", keywords: "party client supplier", onSelect: go("finance", "customers") },
    { id: "gst", section: "Finance", label: "GST summary", icon: "📋", keywords: "gstr tax return", onSelect: go("finance", "gsttax") },
    { id: "emp", section: "HR", label: "Employees", icon: "👤", keywords: "staff people directory", onSelect: go("hr", "employees") },
    ...(session.actor.canManage ? [{ id: "emp-new", section: "HR", label: "Onboard new employee", icon: "＋", keywords: "hire add", onSelect: go("hr", "employees", "new") }] : []),
    { id: "leave", section: "HR", label: "Leave requests", icon: "🗓️", keywords: "apply approve", onSelect: go("hr", "leave", "requests") },
    { id: "att", section: "HR", label: "Mark attendance", icon: "✓", keywords: "present roster biometric", onSelect: go("hr", "leave", "biometric") },
    { id: "hol", section: "HR", label: "Holiday calendar", icon: "🎉", onSelect: go("hr", "leave", "holidays") },
    { id: "org", section: "HR", label: "Org chart", icon: "🏢", onSelect: go("hr", "orgchart") },
    { id: "proj", section: "Projects", label: "Project pipeline", icon: "🗂️", keywords: "kanban site", onSelect: go("projects", "board") },
    ...session.connectors.map((c) => ({ id: `con-${c.id}`, section: "Connected tools", label: `${c.label} records`, icon: c.icon, onSelect: go("connect", c.id) })),
    {
      id: "sync",
      section: "Connected tools",
      label: "Sync now",
      icon: "⟳",
      keywords: "import quotation survey",
      onSelect: () =>
        bos
          .sync(true)
          .then((r) => {
            show({ tone: "blue", title: r.imported.length ? `${r.imported.length} new item${r.imported.length === 1 ? "" : "s"} in BOS` : "Already up to date" });
            invalidate();
          })
          .catch(() => show({ tone: "coral", title: "Sync failed" })),
    },
    { id: "audit", section: "Settings", label: "Audit log", icon: "🔍", keywords: "history activity", onSelect: go("settings", "audit") },
    { id: "settings", section: "Settings", label: "Company & GST settings", icon: "⚙", onSelect: go("settings", "company") },
    { id: "theme", section: "Quick actions", label: `Switch to ${theme === "dark" ? "light" : "dark"} mode`, icon: "◐", onSelect: toggleTheme },
    mode === "tool"
      ? { id: "fullscreen", section: "Quick actions", label: "Open BOS as a full-screen app", icon: "⤢", onSelect: () => window.open(withBasePath("/bos"), "_blank", "noopener") }
      : { id: "jbt", section: "Quick actions", label: "Open Justx Business Tools", icon: "⤺", onSelect: () => window.location.assign(withBasePath("/")) },
    ...(onSignOut ? [{ id: "signout", section: "Quick actions", label: "Sign out", icon: "⎋", onSelect: onSignOut }] : []),
  ];

  const actorName = session.actor.name ?? session.actor.email ?? "You";

  return (
    <BosAppProvider value={ctx}>
      <Topbar sticky="desktop">
        <Brand logoSrc={logoSrc} name="Justx BOS" sub={`${session.settings.companyName} · ${mode === "tool" ? "in JBT" : "Business OS"}`} />
        <div className="bos-topbar-actions">
          <SearchInput
            readOnly
            placeholder="Search or jump to…"
            aria-label="Open command palette"
            shortcut="⌘K"
            onClick={() => setPaletteOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setPaletteOpen(true);
            }}
          />
          <ThemeToggle theme={theme} onChange={setTheme} />
          <IconButton icon="bell" aria-label="Activity and notifications" onClick={() => navigate("settings", "audit")} />
          {mode === "tool" ? (
            <Button size="sm" variant="ghost" onClick={() => window.open(withBasePath("/bos"), "_blank", "noopener")} title="Open BOS as a full-screen app">
              Full screen ↗
            </Button>
          ) : onSignOut ? (
            <Button size="sm" variant="ghost" icon="login" onClick={onSignOut}>
              Sign out
            </Button>
          ) : null}
          <Avatar size="md" tone="var(--bos-blue)">
            <span title={actorName}>{initialsOf(actorName)}</span>
          </Avatar>
        </div>
      </Topbar>

      <div className="bos-wrap">
        <nav className="bos-subtabs" style={{ paddingTop: 24 }} aria-label="Workspaces">
          <Segmented role="tabs" scroll aria-label="Workspaces" options={WORKSPACES} value={nav.ws} onChange={(w) => navigate(w)} />
        </nav>

        <div key={nav.ws} className="bos-fade-in">
          <Suspense fallback={<LoadingBlock />}>
            {nav.ws === "home" ? <HomeWorkspace /> : null}
            {nav.ws === "finance" ? <FinanceWorkspace /> : null}
            {nav.ws === "hr" ? <HrWorkspace /> : null}
            {nav.ws === "projects" ? <ProjectsWorkspace /> : null}
            {nav.ws === "connect" ? <ConnectWorkspace /> : null}
            {nav.ws === "settings" ? <SettingsWorkspace /> : null}
          </Suspense>
        </div>

        <Footnote>
          Justx BOS™ (Business Operating System) · Designed &amp; Developed by{" "}
          <a href="https://justxsystems.com/" target="_blank" rel="noopener noreferrer">
            Justx Systems
          </a>{" "}
          · © 2026 Justx Systems. All Rights Reserved.
        </Footnote>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} placeholder="Type a command or search…" />
    </BosAppProvider>
  );
}

function SessionGate({ mode, onSignOut }: { mode: BosAppMode; onSignOut?: () => void }) {
  const [state, setState] = useState<{ session: BosSession | null; error: unknown }>({ session: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    bos
      .session()
      .then((session) => alive && setState({ session, error: null }))
      .catch((error) => alive && setState({ session: null, error }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state.session) return <Shell session={state.session} mode={mode} onSignOut={onSignOut} />;
  return (
    <div className="bos-wrap" style={{ paddingTop: 32, paddingBottom: 32 }}>
      {state.error ? (
        state.error instanceof BosApiError && state.error.status === 401 ? (
          <ErrorBlock error={new BosApiError(401, "Your session has expired — please sign in again.", "UNAUTHENTICATED")} />
        ) : (
          <ErrorBlock error={state.error} onRetry={() => setAttempt((a) => a + 1)} />
        )
      ) : (
        <div aria-busy="true" aria-label="Loading Justx BOS" className="bos-stack" style={{ "--bos-gap": "14px" } as CSSProperties}>
          <Skeleton width="38%" height={14} />
          <Skeleton height={44} />
          <Skeleton height={220} />
        </div>
      )}
    </div>
  );
}

/** Matches the horizontal padding of the JBT `.page-shell` the tool renders in. */
const HOST_GUTTER = { "--bos-bleed": "20px" } as CSSProperties;

/**
 * Justx BOS — one app, two entry points: the JBT tool (`/tools/bos`) and the
 * full-screen standalone app (`/bos`). Same code, same `bos_*` data.
 */
export function BosApp({ mode, onSignOut }: { mode: BosAppMode; onSignOut?: () => void }) {
  return (
    <BosRoot canvas className={mode === "tool" ? "bos-bleed" : "bos-app-standalone"} style={mode === "tool" ? HOST_GUTTER : undefined}>
      <SessionGate mode={mode} onSignOut={onSignOut} />
    </BosRoot>
  );
}
