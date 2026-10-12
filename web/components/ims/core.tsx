"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useState, type CSSProperties, type DependencyList, type ReactNode } from "react";
import { Alert, Avatar, Badge, Button, Card, Grid, Segmented, Skeleton, useToast, type BosTone } from "@/components/bos";
import { ImsApiError, errorText, type ImsModuleKey, type ImsNotification, type ImsPermission, type ImsSession, type ImsSettings, type Period } from "@/lib/ims/api";
import { initialsOf, PERIOD_OPTIONS, toneFor, type BadgeView } from "@/lib/ims/format";

export type ImsAppMode = "tool" | "standalone";

export type ImsAppContextValue = {
  session: ImsSession;
  mode: ImsAppMode;
  /** True when the caller's IMS role grants the permission (owners hold all). */
  can: (perm: ImsPermission) => boolean;
  /** Bumps after every mutation so mounted views refetch. */
  version: number;
  invalidate: () => void;
  /** Go to a module; `intent` is e.g. "new", "open:<id>", "in", "out". */
  navigate: (module: ImsModuleKey, intent?: string) => void;
  /** Intent carried by the latest navigate() into this module; null otherwise. */
  takeIntent: (module: ImsModuleKey) => string | null;
  navSeq: number;
  active: ImsModuleKey;
  notifications: ImsNotification[];
  refreshNotifications: () => void;
  setSettings: (settings: ImsSettings) => void;
  openPalette: () => void;
};

const ImsAppContext = createContext<ImsAppContextValue | null>(null);
export const ImsAppProvider = ImsAppContext.Provider;

export function useIms(): ImsAppContextValue {
  const ctx = useContext(ImsAppContext);
  if (!ctx) throw new Error("useIms must be used inside <ImsApp>");
  return ctx;
}

/** The `open:<id>` intent for this module, if any (deep links, notifications, search). */
export function useOpenIntent(module: ImsModuleKey): string | null {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent(module));
  return intent?.startsWith("open:") ? intent.slice(5) : null;
}

/* ---------- Data hooks ---------- */

export type ImsData<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

/** Loads on mount, whenever `deps` change and after any app-wide mutation. Keeps stale data while refetching. */
export function useImsData<T>(loader: () => Promise<T>, deps: DependencyList = []): ImsData<T> {
  const { version } = useIms();
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
export function useImsAction() {
  const { show } = useToast();
  const { invalidate } = useIms();
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

/** Prints only the `.bos-inv-paper` on screen (PO, invoice, closing report); the body class clears after printing. */
export function usePrint() {
  useEffect(() => {
    const clear = () => document.body.classList.remove("bos-printing");
    window.addEventListener("afterprint", clear);
    return () => {
      window.removeEventListener("afterprint", clear);
      clear();
    };
  }, []);
  return () => {
    document.body.classList.add("bos-printing");
    window.print();
  };
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
  if (error instanceof ImsApiError && error.schemaPending) {
    return (
      <Alert tone="amber" title="Justx IMS is being set up">
        The IMS database tables haven&apos;t been created yet. Restart the API once so migration <span className="bos-code">028_ims_core.sql</span> runs, then reload.
      </Alert>
    );
  }
  if (error instanceof ImsApiError && error.notEnabled) {
    return (
      <Alert tone="blue" title="Justx IMS — Dealer isn't enabled yet">
        An administrator can turn it on in Admin → Tools (Justx IMS — Dealer → Visible on home → Live, then Save placement).
      </Alert>
    );
  }
  if (error instanceof ImsApiError && error.status === 403) {
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

/** Renders loading / error / content for a `useImsData` result. */
export function Loaded<T>({ state, children, rows }: { state: ImsData<T>; children: (data: T) => ReactNode; rows?: number }) {
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

/** Explains a screen the caller's IMS role can't use, instead of failing on the API. */
export function NoAccess({ what }: { what: string }) {
  return (
    <Alert tone="blue" title="Not available for your role">
      Your IMS role doesn&apos;t include {what}. An owner can grant it in Settings → Role permissions.
    </Alert>
  );
}

/** Renders children only when the caller holds `perm`; otherwise a role explanation. */
export function RequirePerm({ perm, what, children }: { perm: ImsPermission | ImsPermission[]; what: string; children: ReactNode }) {
  const { can } = useIms();
  const ok = Array.isArray(perm) ? perm.some(can) : can(perm);
  return ok ? <>{children}</> : <NoAccess what={what} />;
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

/** Page intro used at the top of every module: title, description and right-aligned actions. */
export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ims-page-head">
      <div className="ims-page-head-text">
        <h1 className="ims-page-title">{title}</h1>
        {sub ? <p className="ims-page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="ims-page-actions">{actions}</div> : null}
      {children}
    </div>
  );
}

/** Period selector shared by dashboard, history and reports. */
export function PeriodPicker({ value, onChange, size = "sm" }: { value: Period; onChange: (p: Period) => void; size?: "sm" | "md" }) {
  return <Segmented size={size} scroll aria-label="Period" options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={value} onChange={onChange} />;
}

/** Sub-navigation tabs inside a module. */
export function SubTabs<K extends string>({ value, onChange, options, label }: { value: K; onChange: (k: K) => void; options: ReadonlyArray<{ value: K; label: string }>; label: string }) {
  return (
    <div className="bos-subtabs" style={{ paddingTop: 0 }}>
      <Segmented role="tabs" size="sm" scroll aria-label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}
