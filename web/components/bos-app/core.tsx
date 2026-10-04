"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type CSSProperties,
  type DependencyList,
  type ReactNode,
} from "react";
import {
  Alert,
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  ModuleHeader,
  NavBrand,
  Segmented,
  Skeleton,
  TimePill,
  useToast,
  type BosTone,
} from "@/components/bos";
import { ModuleRenderer } from "@/components/bos-design/modules/ModuleRenderer";
import type { Block, ModuleSpec } from "@/components/bos-design/modules/schema";
import { BosApiError, errorText, type BosSession, type BosSettings } from "@/lib/bos-app/api";
import { initialsOf, toneFor, type BadgeView } from "@/lib/bos-app/format";

export type WorkspaceKey = "home" | "finance" | "hr" | "projects" | "connect" | "settings";

export const WORKSPACES: ReadonlyArray<{ value: WorkspaceKey; label: string }> = [
  { value: "home", label: "Home" },
  { value: "finance", label: "Finance & Accounts" },
  { value: "hr", label: "HR Management" },
  { value: "projects", label: "Projects" },
  { value: "connect", label: "Connected Tools" },
  { value: "settings", label: "Settings & Audit" },
];

export type BosAppContextValue = {
  session: BosSession;
  mode: "tool" | "standalone";
  logoSrc: string;
  canManage: boolean;
  /** Bumps after every mutation so every mounted view refetches. */
  version: number;
  invalidate: () => void;
  navigate: (ws: WorkspaceKey, module?: string, intent?: string) => void;
  /** Intent carried by the latest navigate() into this module ("new", "open:<id>"…); cleared on the next navigation. */
  takeIntent: (module: string) => string | null;
  /** Bumped by intent-carrying navigations. */
  navSeq: number;
  /** Active module per workspace (controlled by BosApp so deep links and the palette can drive it). */
  moduleOf: (ws: WorkspaceKey) => string | undefined;
  selectModule: (ws: WorkspaceKey, module: string) => void;
  setSettings: (settings: BosSettings) => void;
  openPalette: () => void;
};

const BosAppContext = createContext<BosAppContextValue | null>(null);

export const BosAppProvider = BosAppContext.Provider;

export function useBosApp(): BosAppContextValue {
  const ctx = useContext(BosAppContext);
  if (!ctx) throw new Error("useBosApp must be used inside <BosApp>");
  return ctx;
}

/* ---------- Data hooks ---------- */

export type BosData<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

/** Loads on mount, whenever `deps` change and after any app-wide mutation. Keeps stale data while refetching. */
export function useBosData<T>(loader: () => Promise<T>, deps: DependencyList = []): BosData<T> {
  const { version } = useBosApp();
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([version, tick, ...deps]);
  const [state, setState] = useState<{ data: T | null; error: unknown; key: string | null }>({ data: null, error: null, key: null });
  const load = useEffectEvent(() => loader());

  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ data, error: null, key }),
      (error: unknown) => alive && setState((s) => ({ data: s.data, error, key })),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}

/** Runs a mutation with busy state, success toast, error toast and app-wide refresh. */
export function useBosAction() {
  const { show } = useToast();
  const { invalidate } = useBosApp();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, opts: { success?: string; description?: string; tone?: BosTone; refresh?: boolean } = {}): Promise<T | undefined> => {
      setBusy(key);
      try {
        const out = await fn();
        if (opts.success) show({ tone: opts.tone ?? "emerald", title: opts.success, description: opts.description });
        if (opts.refresh !== false) invalidate();
        return out;
      } catch (err) {
        show({ tone: "coral", title: "Couldn't complete that", description: errorText(err) });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [show, invalidate],
  );

  return { run, busy, isBusy: (key: string) => busy === key };
}

/* ---------- States ---------- */

export function LoadingBlock({ rows = 2 }: { rows?: number }) {
  return (
    <div className="bos-stack" style={{ "--bos-gap": "16px" } as CSSProperties} aria-busy="true" aria-label="Loading">
      <Grid cols={4} min={140}>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} interactive={false}>
            <Skeleton width="55%" height={9} />
            <Skeleton width="70%" height={22} style={{ marginTop: 12 }} />
            <Skeleton width="45%" height={9} style={{ marginTop: 12 }} />
          </Card>
        ))}
      </Grid>
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} interactive={false}>
          <Skeleton width="30%" height={10} />
          <Skeleton height={10} style={{ marginTop: 14 }} />
          <Skeleton width="85%" height={10} style={{ marginTop: 10 }} />
          <Skeleton width="65%" height={10} style={{ marginTop: 10 }} />
        </Card>
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof BosApiError && error.schemaPending) {
    return (
      <Alert tone="amber" title="Justx BOS is being set up">
        The BOS database tables haven&apos;t been created yet. Restart the API once so migration <span className="bos-code">010_bos_core.sql</span> runs, then reload.
      </Alert>
    );
  }
  if (error instanceof BosApiError && error.status === 403) {
    return (
      <Alert tone="blue" title="Restricted">
        {error.message}
      </Alert>
    );
  }
  return (
    <Alert
      tone="coral"
      title="Couldn't load this section"
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {errorText(error)}
    </Alert>
  );
}

/** Renders loading / error / content for a `useBosData` result. */
export function Loaded<T>({ state, children, rows }: { state: BosData<T>; children: (data: T) => ReactNode; rows?: number }) {
  if (state.data !== null) {
    return (
      <>
        {state.error ? (
          <div style={{ marginBottom: 16 }}>
            <ErrorBlock error={state.error} onRetry={state.reload} />
          </div>
        ) : null}
        {children(state.data)}
      </>
    );
  }
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  return <LoadingBlock rows={rows} />;
}

export function StatusBadge({ view, auto }: { view: BadgeView; auto?: boolean }) {
  return (
    <Badge tone={view.tone} auto={auto}>
      {view.text}
    </Badge>
  );
}

export function PersonAvatar({ name, size = "sm" }: { name: string | null | undefined; size?: "xs" | "sm" | "md" | "lg" | "xl" }) {
  return (
    <Avatar size={size} tone={toneFor(name)}>
      {initialsOf(name)}
    </Avatar>
  );
}

export function Stack({ gap = 20, children }: { gap?: number; children: ReactNode }) {
  return (
    <div className="bos-stack" style={{ "--bos-gap": `${gap}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/* ---------- Module workspace (live) ---------- */

export type LiveModule = {
  key: string;
  label: string;
  icon: string;
  title: string;
  sub?: string;
  compact?: boolean;
  /** Live screen. */
  render?: () => ReactNode;
  /** Design preview shown for modules that are still on the roadmap. */
  preview?: ModuleSpec;
};

/** Reference blocks (sample data) behind a clear "coming next" banner. */
export function PreviewBlocks({ blocks, name, icon, sub }: { blocks: ReadonlyArray<Block>; name: string; icon?: string; sub?: string }) {
  const { show } = useToast();
  const live = blocks.filter((b) => b.type !== "custom");
  const notify = () => show({ tone: "blue", title: "Coming next", description: `${name} goes live in an upcoming BOS release.` });
  return (
    <Stack>
      <Alert tone="blue" title="Coming next — design preview">
        {name} ships in an upcoming release. Figures below are sample data showing the final layout; nothing here is saved.
      </Alert>
      {live.length ? (
        <ModuleRenderer blocks={live} ctx={{ onAction: notify, onNavigate: notify }} />
      ) : (
        <EmptyState glyph={icon ?? "✦"} title={name}>
          {sub}
        </EmptyState>
      )}
    </Stack>
  );
}

function PreviewModule({ spec }: { spec: ModuleSpec }) {
  const [sub, setSub] = useState(spec.subtabs?.[0]?.key ?? "");
  const subtab = spec.subtabs?.find((s) => s.key === sub) ?? spec.subtabs?.[0];
  return (
    <Stack>
      {spec.subtabs && subtab ? (
        <div className="bos-subtabs" style={{ paddingTop: 0 }}>
          <Segmented role="tabs" size="sm" scroll aria-label={`${spec.label} sections`} options={spec.subtabs.map((s) => ({ value: s.key, label: s.label }))} value={subtab.key} onChange={setSub} />
        </div>
      ) : null}
      <PreviewBlocks key={subtab?.key} blocks={subtab ? subtab.blocks : (spec.blocks ?? [])} name={spec.title} icon={spec.icon} sub={spec.sub} />
    </Stack>
  );
}

export function LiveWorkspace({
  modules,
  active,
  onSelect,
  accent = "blue",
  brandName,
  logoSrc,
  onSearch,
  label,
  navSeq = 0,
}: {
  modules: ReadonlyArray<LiveModule>;
  active: string;
  onSelect: (key: string) => void;
  accent?: "blue" | "emerald";
  brandName: string;
  logoSrc?: string;
  onSearch?: () => void;
  label: string;
  /** Changes when a navigation carries an intent, so the target view remounts and reads it. */
  navSeq?: number;
}) {
  const current = modules.find((m) => m.key === active) ?? modules[0];
  return (
    <AppShell
      brand={<NavBrand name={brandName} logoSrc={logoSrc} />}
      items={modules.map((m) => ({ key: m.key, label: m.label, icon: m.icon }))}
      active={current.key}
      onSelect={onSelect}
      accent={accent}
      onSearch={onSearch}
      footer={<TimePill />}
      aria-label={label}
    >
      <ModuleHeader title={current.title} sub={current.sub} brand={current.render ? "Justx BOS" : <Badge tone="blue" auto>COMING NEXT</Badge>} />
      <div key={`${current.key}:${navSeq}`} className={current.compact ? "bos-compact bos-fade-in" : "bos-fade-in"}>
        {current.render ? current.render() : current.preview ? <PreviewModule spec={current.preview} /> : null}
      </div>
    </AppShell>
  );
}

/** Picks a reference (bosdesign) module spec by key for roadmap previews. */
export function previewOf(specs: ReadonlyArray<ModuleSpec>, key: string): Pick<LiveModule, "key" | "label" | "icon" | "title" | "sub" | "compact" | "preview"> {
  const spec = specs.find((s) => s.key === key);
  if (!spec) throw new Error(`Unknown preview module ${key}`);
  return { key: spec.key, label: spec.label, icon: spec.icon, title: spec.title, sub: spec.sub, compact: spec.compact, preview: spec };
}

/** A live module that keeps the reference module's navigation label and icon. */
export function liveOf(specs: ReadonlyArray<ModuleSpec>, key: string, render: () => ReactNode, overrides: Partial<Omit<LiveModule, "key" | "render" | "preview">> = {}): LiveModule {
  const p = previewOf(specs, key);
  return { key: p.key, label: p.label, icon: p.icon, title: p.title, sub: p.sub, compact: p.compact, ...overrides, render };
}

/** Wires a workspace's module navigation to BosApp (deep links, palette, intents). */
export function useWorkspaceModule(ws: WorkspaceKey, fallback: string) {
  const { moduleOf, selectModule, navSeq } = useBosApp();
  return { active: moduleOf(ws) ?? fallback, onSelect: (key: string) => selectModule(ws, key), navSeq };
}
