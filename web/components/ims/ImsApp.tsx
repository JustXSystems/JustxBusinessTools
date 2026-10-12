"use client";

import "./ims-app.css";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AppShell,
  Avatar,
  BosRoot,
  Brand,
  Button,
  CommandPalette,
  Dialog,
  EmptyState,
  Footnote,
  IconButton,
  Input,
  NavBrand,
  SearchInput,
  Skeleton,
  ThemeToggle,
  TimePill,
  Topbar,
  useBosTheme,
  useCommandHotkey,
  type BosCommand,
} from "@/components/bos";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { ims, ImsApiError, type ImsModuleKey, type ImsNotification, type ImsSearchResult, type ImsSession, type ImsSettings } from "@/lib/ims/api";
import { isAssistantPage } from "@/lib/ims/assistant";
import { initialsOf, timeAgo } from "@/lib/ims/format";
import { rememberModule } from "@/lib/ims/recent";
import { PageAskAi } from "./AskAi";
import { ErrorBlock, ImsAppProvider, LoadingBlock, type ImsAppContextValue, type ImsAppMode } from "./core";
import { MODULE_KEYS, moduleDef, visibleModules } from "./modules";

export const IMS_LOGO = "/icons/justx-bos-mark.png";

type NavState = { module: ImsModuleKey; intent: { module: ImsModuleKey; value: string } | null; seq: number };

/** `?m=receivables&open=<id>` — the same links IMS puts into JBT notifications. */
function navFromUrl(): NavState {
  const base: NavState = { module: "dashboard", intent: null, seq: 0 };
  if (typeof window === "undefined") return base;
  const q = new URLSearchParams(window.location.search);
  const m = q.get("m");
  if (!m || !MODULE_KEYS.has(m)) return base;
  const open = q.get("open");
  return { module: m as ImsModuleKey, intent: open ? { module: m as ImsModuleKey, value: `open:${open}` } : null, seq: 0 };
}

function writeUrl(module: ImsModuleKey) {
  const url = new URL(window.location.href);
  url.searchParams.delete("open");
  if (module === "dashboard") url.searchParams.delete("m");
  else url.searchParams.set("m", module);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
}

const NOTE_DOT: Record<ImsNotification["tone"], string> = { coral: "var(--bos-coral)", amber: "var(--bos-amber)", blue: "var(--bos-blue)", emerald: "var(--bos-emerald)" };

function NotificationsDialog({ open, onClose, notes, onOpen }: { open: boolean; onClose: () => void; notes: ImsNotification[]; onOpen: (n: ImsNotification) => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Notifications" description="Stock alerts, approvals and dues that need you." icon={{ tone: "blue", name: "bell" }}>
      {notes.length ? (
        <div className="ims-notes">
          {notes.map((n) => (
            <button key={n.id} type="button" className="ims-note" onClick={() => onOpen(n)}>
              <span className="ims-note-dot" style={{ background: NOTE_DOT[n.tone] }} aria-hidden="true" />
              <span>
                <div className="ims-note-title">{n.title}</div>
                <div className="ims-note-body">{n.body}</div>
              </span>
              <span className="ims-note-at">{n.at ? timeAgo(n.at) : ""}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState glyph="✓" title="You're all caught up">
          No low stock, pending approvals or overdue dues right now.
        </EmptyState>
      )}
    </Dialog>
  );
}

function SearchDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: ImsSearchResult) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ImsSearchResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      ims
        .search(term)
        .then((r) => alive && setResults(r.results))
        .catch(() => alive && setResults([]));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const close = () => {
    setQ("");
    setResults(null);
    onClose();
  };
  const KIND: Record<ImsSearchResult["kind"], string> = { item: "📦", party: "👤", invoice: "🧾", po: "🛒", bill: "📤" };
  const shown = q.trim().length >= 2 ? results : null;

  return (
    <Dialog open={open} onClose={close} title="Search IMS" description="Items, SKUs, barcodes, parties, invoices, POs and bills." initialFocus={inputRef}>
      <Input ref={inputRef} placeholder="Type at least 2 characters…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div className="ims-pick" style={{ marginTop: 12 }}>
        {shown === null ? null : shown.length ? (
          shown.map((r) => (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              className="ims-pick-row"
              onClick={() => {
                onPick(r);
                close();
              }}
            >
              <span className="ims-cell-stack">
                <span className="ims-strong">
                  {KIND[r.kind]} {r.title}
                </span>
                <small>{r.sub}</small>
              </span>
              <span className="ims-faint">{moduleDef(r.module)?.label}</span>
            </button>
          ))
        ) : (
          <p className="ims-faint">No matches for “{q.trim()}”.</p>
        )}
      </div>
    </Dialog>
  );
}

const MOBILE_NAV: ReadonlyArray<{ key: ImsModuleKey; label: string }> = [
  { key: "dashboard", label: "Home" },
  { key: "stockin", label: "Stock In" },
  { key: "stockout", label: "Stock Out" },
  { key: "stock", label: "Stock" },
  { key: "more", label: "More" },
];

function MobileNav({ available, active, onSelect }: { available: ReadonlySet<ImsModuleKey>; active: ImsModuleKey; onSelect: (key: ImsModuleKey) => void }) {
  const items = MOBILE_NAV.filter((n) => available.has(n.key));
  if (items.length < 2) return null;
  return (
    <nav className="ims-mnav" aria-label="IMS quick navigation">
      {items.map((n) => (
        <button key={n.key} type="button" className={`ims-mnav-btn${n.key === active ? " is-active" : ""}`} aria-current={n.key === active ? "page" : undefined} onClick={() => onSelect(n.key)}>
          <span className="ims-mnav-ic" aria-hidden="true">
            {moduleDef(n.key)?.icon}
          </span>
          <span className="ims-mnav-label">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Shell({ session: initial, mode, onSignOut }: { session: ImsSession; mode: ImsAppMode; onSignOut?: () => void }) {
  const logoSrc = publicAssetUrl(IMS_LOGO);
  const { theme, setTheme, toggleTheme } = useBosTheme();
  const [session, setSession] = useState(initial);
  const [nav, setNav] = useState<NavState>(navFromUrl);
  const [version, setVersion] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [notes, setNotes] = useState<ImsNotification[]>([]);
  const [notesTick, setNotesTick] = useState(0);

  useCommandHotkey(() => setPaletteOpen(true));

  const modules = useMemo(() => visibleModules(session), [session]);
  const current = modules.find((x) => x.key === nav.module) ?? modules[0];
  const moduleKeys = useMemo(() => new Set(modules.map((x) => x.key)), [modules]);
  const perms = useMemo(() => new Set(session.access.perms), [session.access.perms]);

  useEffect(() => {
    writeUrl(current.key);
    rememberModule(current.key);
  }, [current.key]);

  useEffect(() => {
    let alive = true;
    ims
      .notifications()
      .then((r) => alive && setNotes(r.notifications))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [version, notesTick]);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

  const navigate = useCallback((module: ImsModuleKey, intent?: string) => {
    setNav((n) => ({ module, intent: intent ? { module, value: intent } : null, seq: intent ? n.seq + 1 : n.seq }));
    setAskOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const ctx = useMemo<ImsAppContextValue>(
    () => ({
      session,
      mode,
      can: (perm) => perms.has(perm),
      version,
      invalidate,
      navigate,
      takeIntent: (module) => (nav.intent?.module === module ? nav.intent.value : null),
      navSeq: nav.seq,
      active: current.key,
      notifications: notes,
      refreshNotifications: () => setNotesTick((t) => t + 1),
      setSettings: (settings: ImsSettings) => setSession((s) => ({ ...s, settings })),
      openPalette: () => setPaletteOpen(true),
    }),
    [session, mode, perms, version, invalidate, navigate, nav, current.key, notes],
  );

  const askPage = isAssistantPage(current.key) ? current.key : null;
  const navBadges = useMemo(() => {
    const m = new Map<ImsModuleKey, { count: number; tone: "coral" | "amber"; label: string }>();
    for (const n of notes) {
      const prev = m.get(n.module);
      const count = (prev?.count ?? 0) + 1;
      m.set(n.module, { count, tone: prev?.tone === "coral" || n.tone === "coral" ? "coral" : "amber", label: `${count} alert${count === 1 ? "" : "s"}` });
    }
    return m;
  }, [notes]);
  const go = (module: ImsModuleKey, intent?: string) => () => navigate(module, intent);
  const can = (p: Parameters<ImsAppContextValue["can"]>[0]) => perms.has(p);
  const commands: BosCommand[] = [
    ...(can("items") ? [{ id: "q-item", section: "Quick actions", label: "Add a new item", icon: "＋", keywords: "product sku create", onSelect: go("items", "new") }] : []),
    ...(can("stockIn") ? [{ id: "q-in", section: "Quick actions", label: "Stock in (receive goods)", icon: "⬇", keywords: "grn inward", onSelect: go("stockin") }] : []),
    ...(can("stockOut") ? [{ id: "q-out", section: "Quick actions", label: "Stock out (issue goods)", icon: "⬆", keywords: "dispatch outward", onSelect: go("stockout") }] : []),
    ...(can("sales") ? [{ id: "q-inv", section: "Quick actions", label: "Create GST invoice", icon: "🧾", keywords: "bill sale", onSelect: go("sales", "new") }] : []),
    ...(can("po") ? [{ id: "q-po", section: "Quick actions", label: "Create purchase order", icon: "🛒", keywords: "po buy", onSelect: go("purchase", "new") }] : []),
    ...(can("receivables") ? [{ id: "q-pay", section: "Quick actions", label: "Receive a payment", icon: "💰", keywords: "collection receipt", onSelect: go("receivables", "pay") }] : []),
    ...(modules.some((x) => x.key === "scanner") ? [{ id: "q-scan", section: "Quick actions", label: "Scan stock (QR / barcode)", icon: "⌗", onSelect: go("scanner") }] : []),
    { id: "q-search", section: "Quick actions", label: "Search items, parties & documents", icon: "⌕", keywords: "find lookup", onSelect: () => setSearchOpen(true) },
    ...(askPage ? [{ id: "q-ask", section: "Quick actions", label: `Ask AI about ${current.label}`, icon: "✦", keywords: "assistant question gemini help", onSelect: () => setAskOpen(true) }] : []),
    ...modules.map((x) => ({ id: `m-${x.key}`, section: x.section, label: x.label, icon: x.icon, keywords: `${x.desc} ${x.keywords ?? ""}`, onSelect: go(x.key) })),
    { id: "theme", section: "Preferences", label: `Switch to ${theme === "dark" ? "light" : "dark"} mode`, icon: "◐", onSelect: toggleTheme },
    ...(mode === "standalone" ? [{ id: "jbt", section: "Preferences", label: "Open Justx Business Tools", icon: "⤺", onSelect: () => window.location.assign(withBasePath("/")) }] : []),
    ...(onSignOut ? [{ id: "signout", section: "Preferences", label: "Sign out", icon: "⎋", onSelect: onSignOut }] : []),
  ];

  const actorName = session.actor.name ?? session.actor.email ?? "You";
  const businessName = session.settings.businessName || session.brand?.name || "Your business";
  const Module = current.component;

  return (
    <ImsAppProvider value={ctx}>
      <div className="ims-app">
        <Topbar sticky="desktop">
          <Brand logoSrc={logoSrc} name="Justx IMS" sub={`${businessName} · Dealer`} />
          <div className="bos-topbar-actions">
            <SearchInput
              readOnly
              placeholder="Search items, parties, invoices…"
              aria-label="Search IMS"
              shortcut="⌘K"
              onClick={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSearchOpen(true);
              }}
            />
            {askPage ? (
              <Button size="sm" variant="secondary" icon="sparkle" className="ims-ask-btn" onClick={() => setAskOpen(true)} aria-label={`Ask AI about ${current.label}`}>
                <span className="ims-topbar-label">Ask AI</span>
              </Button>
            ) : null}
            <ThemeToggle theme={theme} onChange={setTheme} />
            <span className="ims-bell">
              <IconButton icon="bell" aria-label={`Notifications${notes.length ? ` (${notes.length})` : ""}`} onClick={() => setNotesOpen(true)} />
              {notes.length ? <span className="ims-bell-dot">{notes.length > 9 ? "9+" : notes.length}</span> : null}
            </span>
            <span className="ims-role-pill" title="Your IMS role">
              {session.access.roleLabel}
            </span>
            {onSignOut ? (
              <Button size="sm" variant="ghost" icon="login" onClick={onSignOut} aria-label="Sign out">
                <span className="ims-topbar-label">Sign out</span>
              </Button>
            ) : null}
            <Avatar size="md" tone="var(--bos-blue)">
              <span title={actorName}>{initialsOf(actorName)}</span>
            </Avatar>
          </div>
        </Topbar>

        <div className="bos-wrap" style={{ paddingTop: 20 }}>
          <AppShell
            brand={<NavBrand name="IMS — Dealer" mark="I" />}
            items={modules.map((x) => ({ key: x.key, label: x.label, icon: x.icon, section: x.section, badge: navBadges.get(x.key) }))}
            active={current.key}
            onSelect={(k) => navigate(k)}
            onSearch={() => setPaletteOpen(true)}
            searchLabel="Jump to… ⌘K"
            footer={<TimePill />}
            aria-label="IMS modules"
          >
            <div key={`${current.key}:${nav.seq}`} className="bos-fade-in">
              <Suspense fallback={<LoadingBlock />}>
                <Module />
              </Suspense>
            </div>
          </AppShell>

          <div className="ims-foot">
            <Footnote>
              Justx IMS™ — Dealer · part of{" "}
              <a href={withBasePath("/")} target={mode === "tool" ? undefined : "_blank"} rel="noopener noreferrer">
                Justx Business Tools
              </a>{" "}
              · © 2026 Justx Systems. All Rights Reserved.
            </Footnote>
          </div>
        </div>

        {mode === "standalone" ? <MobileNav available={moduleKeys} active={current.key} onSelect={(k) => navigate(k)} /> : null}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} placeholder="Type a command or module…" />
        {askPage ? <PageAskAi key={askPage} page={askPage} open={askOpen} onClose={() => setAskOpen(false)} /> : null}
        <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onPick={(r) => navigate(r.module, `open:${r.open}`)} />
        <NotificationsDialog
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          notes={notes}
          onOpen={(n) => {
            setNotesOpen(false);
            navigate(n.module, n.open ? `open:${n.open}` : undefined);
          }}
        />
      </div>
    </ImsAppProvider>
  );
}

function SessionGate({ mode, onSignOut }: { mode: ImsAppMode; onSignOut?: () => void }) {
  const [state, setState] = useState<{ session: ImsSession | null; error: unknown }>({ session: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    ims
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
        state.error instanceof ImsApiError && state.error.status === 401 ? (
          <ErrorBlock error={new ImsApiError(401, "Your session has expired — please sign in again.", "UNAUTHENTICATED")} />
        ) : (
          <ErrorBlock error={state.error} onRetry={() => setAttempt((a) => a + 1)} />
        )
      ) : (
        <div aria-busy="true" aria-label="Loading Justx IMS" className="bos-stack" style={{ "--bos-gap": "14px" } as CSSProperties}>
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
 * Justx IMS — Dealer. Always renders with the IMS skin (glass, gradients, Inter),
 * whatever theme pack the org uses, and follows the host's light / dark scheme.
 */
export function ImsApp({ mode, onSignOut }: { mode: ImsAppMode; onSignOut?: () => void }) {
  return (
    <BosRoot skin="ims" canvas className={mode === "tool" ? "bos-bleed" : "ims-standalone"} style={mode === "tool" ? HOST_GUTTER : undefined}>
      <SessionGate mode={mode} onSignOut={onSignOut} />
    </BosRoot>
  );
}
