"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { FabricCapabilityTool } from "@/lib/access-fabric";

export type CapabilitySummaryTool = FabricCapabilityTool & {
  enabledCount: number | null;
  catalogCount: number | null;
  alwaysOnCount: number | null;
};

type CatalogRow = { key: string; label: string; section: string; required?: boolean };

type CapabilityDetail = {
  toolId: string;
  name: string;
  entitled: boolean;
  hasCeiling: boolean;
  unrestricted: boolean;
  enabled: string[];
  alwaysOn: string[];
  catalog: CatalogRow[];
  coveragePct: number | null;
};

export type ToolCapabilityLatticeHandle = {
  focusTool: (toolId?: string) => void;
  reload: () => Promise<void>;
};

type Props = {
  businessProfileId: number;
  initialToolId?: string | null;
  onSummary?: (tools: FabricCapabilityTool[]) => void;
  onRequestGrant?: (toolId: string) => void | Promise<void>;
};

export const ToolCapabilityLattice = forwardRef<ToolCapabilityLatticeHandle, Props>(
  function ToolCapabilityLattice({ businessProfileId, initialToolId, onSummary, onRequestGrant }, ref) {
    const [tools, setTools] = useState<CapabilitySummaryTool[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CapabilityDetail | null>(null);
    const [unrestricted, setUnrestricted] = useState(true);
    const [enabled, setEnabled] = useState<Set<string>>(new Set());
    const [moduleQuery, setModuleQuery] = useState("");
    const [moduleFilter, setModuleFilter] = useState<"all" | "live" | "dim">("all");
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [granting, setGranting] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const onSummaryRef = useRef(onSummary);
    onSummaryRef.current = onSummary;
    const initialToolRef = useRef(initialToolId);
    initialToolRef.current = initialToolId;
    const selectedIdRef = useRef<string | null>(null);
    selectedIdRef.current = selectedId;
    const bootedProfileRef = useRef<number | null>(null);

    const reloadSummary = useCallback(async () => {
      const data = await api<{ tools: CapabilitySummaryTool[] }>(
        `/admin/tool-capabilities?businessProfileId=${businessProfileId}`,
      );
      setTools(data.tools);
      onSummaryRef.current?.(
        data.tools.map((t) => ({
          toolId: t.toolId,
          name: t.name,
          entitled: t.entitled,
          hasCeiling: t.hasCeiling,
          unrestricted: t.unrestricted,
          coveragePct: t.coveragePct,
        })),
      );
      return data.tools;
    }, [businessProfileId]);

    const loadDetail = useCallback(
      async (toolId: string) => {
        const data = await api<CapabilityDetail>(
          `/admin/tool-capabilities/${encodeURIComponent(toolId)}?businessProfileId=${businessProfileId}`,
        );
        setDetail(data);
        setUnrestricted(data.unrestricted);
        setEnabled(new Set(data.enabled));
        return data;
      },
      [businessProfileId],
    );

    const refresh = useCallback(async () => {
      setError("");
      const profileChanged = bootedProfileRef.current !== businessProfileId;
      try {
        const list = await reloadSummary();
        const current = selectedIdRef.current;
        const keepSelection =
          !profileChanged && current != null && list.some((t) => t.toolId === current);

        if (keepSelection && current) {
          bootedProfileRef.current = businessProfileId;
          await loadDetail(current);
          return;
        }

        const preferId = initialToolRef.current;
        const prefer =
          (preferId && list.some((t) => t.toolId === preferId) && preferId) ||
          list.find((t) => t.hasCeiling && t.entitled)?.toolId ||
          list.find((t) => t.entitled)?.toolId ||
          list[0]?.toolId ||
          null;
        bootedProfileRef.current = businessProfileId;
        setSelectedId(prefer);
        if (prefer) await loadDetail(prefer);
        else setDetail(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load capabilities");
        if (profileChanged) {
          setTools([]);
          setDetail(null);
        }
      }
    }, [businessProfileId, reloadSummary, loadDetail]);

    useLiveRefresh(() => refresh().catch(() => undefined), {
      intervalMs: 60_000,
      deps: [businessProfileId],
    });

    useImperativeHandle(
      ref,
      () => ({
        focusTool: (toolId?: string) => {
          const el = document.getElementById("ax-capabilities");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
          if (toolId) {
            setSelectedId(toolId);
            void loadDetail(toolId).catch((e: Error) => setError(e.message));
          }
        },
        reload: refresh,
      }),
      [refresh, loadDetail],
    );

    const alwaysOn = useMemo(
      () => new Set(detail?.alwaysOn ?? []),
      [detail],
    );

    const sections = useMemo(() => {
      const catalog = detail?.catalog ?? [];
      const map = new Map<string, CatalogRow[]>();
      for (const row of catalog) {
        const list = map.get(row.section) ?? [];
        list.push(row);
        map.set(row.section, list);
      }
      return [...map.entries()];
    }, [detail]);

    async function selectTool(toolId: string) {
      setSelectedId(toolId);
      setMessage("");
      setError("");
      setModuleQuery("");
      setModuleFilter("all");
      try {
        await loadDetail(toolId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tool");
        setDetail(null);
      }
    }

    async function persist(nextUnrestricted: boolean, nextEnabled: Set<string>, label: string) {
      if (!selectedId || !detail?.hasCeiling) return;
      setBusyKey(selectedId);
      setMessage("");
      setError("");
      try {
        const data = await api<CapabilityDetail>(
          `/admin/tool-capabilities/${encodeURIComponent(selectedId)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              businessProfileId,
              unrestricted: nextUnrestricted,
              enabled: nextUnrestricted ? undefined : [...nextEnabled],
            }),
          },
        );
        setDetail(data);
        setUnrestricted(data.unrestricted);
        setEnabled(new Set(data.enabled));
        setMessage(label);
        await reloadSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setBusyKey(null);
      }
    }

    function toggleModule(key: string, on: boolean) {
      if (alwaysOn.has(key) || unrestricted || !detail) return;
      const next = new Set(enabled);
      if (on) next.add(key);
      else next.delete(key);
      for (const k of alwaysOn) next.add(k);
      setEnabled(next);
      void persist(false, next, on ? `Enabled ${key}.` : `Dimmed ${key}.`);
    }

    function selectSection(section: string, on: boolean) {
      if (unrestricted || !detail) return;
      const rows = sections.find(([s]) => s === section)?.[1] ?? [];
      const next = new Set(enabled);
      for (const row of rows) {
        if (alwaysOn.has(row.key)) continue;
        if (on) next.add(row.key);
        else next.delete(row.key);
      }
      for (const k of alwaysOn) next.add(k);
      setEnabled(next);
      void persist(false, next, on ? `Enabled ${section}.` : `Cleared ${section}.`);
    }

    const sectionCoverage = useMemo(() => {
      return sections.map(([section, rows]) => {
        const optional = rows.filter((r) => !alwaysOn.has(r.key));
        if (unrestricted || optional.length === 0) {
          return { section, pct: 100, optional };
        }
        const on = optional.filter((r) => enabled.has(r.key)).length;
        return {
          section,
          pct: Math.round((on / optional.length) * 100),
          optional,
        };
      });
    }, [sections, alwaysOn, enabled, unrestricted]);

    const visibleModules = useMemo(() => {
      const q = moduleQuery.trim().toLowerCase();
      return sections
        .map(([section, rows]) => {
          const filtered = rows.filter((row) => {
            if (q && !`${row.label} ${row.key} ${section}`.toLowerCase().includes(q)) return false;
            const live = unrestricted || alwaysOn.has(row.key) || enabled.has(row.key);
            if (moduleFilter === "live") return live;
            if (moduleFilter === "dim") return !live;
            return true;
          });
          return [section, filtered] as const;
        })
        .filter(([, rows]) => rows.length > 0);
    }, [sections, moduleQuery, moduleFilter, unrestricted, alwaysOn, enabled]);

    const busy = busyKey != null;

    return (
      <section id="ax-capabilities" className="ax-capabilities" aria-label="Tool capabilities">
        <div className="ax-section-head">
          <h4>Tool capabilities</h4>
          <p className="muted">
            Profile-first control: pick an assigned tool, then tune its module ceiling. Tools without a
            registered ceiling use whole-tool access (grant / revoke on the lattice below).
          </p>
        </div>

        {error ? <p className="field-error">{error}</p> : null}
        {message ? <p className="muted">{message}</p> : null}

        {tools.length === 0 ? (
          <p className="muted">
            No tools assigned yet. Grant licenses on the Tool lattice, then return here to tune
            capabilities.
          </p>
        ) : (
          <div className="ax-cap-rail" role="tablist" aria-label="Assigned tools">
            {tools.map((tool) => {
              const active = tool.toolId === selectedId;
              const signal = !tool.entitled
                ? "locked"
                : !tool.hasCeiling
                  ? "included"
                  : tool.unrestricted
                    ? "licensed"
                    : "dim";
              return (
                <button
                  key={tool.toolId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`ax-cap-chip${active ? " is-active" : ""}`}
                  data-signal={signal}
                  onClick={() => void selectTool(tool.toolId)}
                >
                  <strong>{tool.name}</strong>
                  <span>
                    {!tool.entitled
                      ? "Unassigned"
                      : !tool.hasCeiling
                        ? "Whole-tool"
                        : tool.unrestricted
                          ? "Full signal"
                          : `${tool.coveragePct ?? 0}% modules`}
                  </span>
                  {tool.hasCeiling && tool.coveragePct != null ? (
                    <span
                      className="ax-cap-chip-ring"
                      style={{ "--pct": tool.coveragePct } as CSSProperties}
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {detail && !detail.entitled ? (
          <div className="ax-cap-locked">
            <div>
              <strong>{detail.name} is not assigned</strong>
              <p className="muted">
                License this tool on the profile first. Module ceilings unlock after entitlement.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={granting || busyKey != null}
              onClick={() => {
                if (!onRequestGrant) return;
                setGranting(true);
                void Promise.resolve(onRequestGrant(detail.toolId)).finally(() => setGranting(false));
              }}
            >
              {granting ? "Granting…" : "Grant license"}
            </button>
          </div>
        ) : null}

        {detail && detail.entitled && !detail.hasCeiling ? (
          <div className="ax-cap-whole">
            <strong>{detail.name}</strong>
            <p className="muted">
              Whole-tool access — operators get the full product once licensed. No left-nav module
              ceiling is registered for <code>{detail.toolId}</code> yet.
            </p>
          </div>
        ) : null}

        {detail && detail.entitled && detail.hasCeiling ? (
          <div className="ax-cap-detail">
            <div className="ax-cap-mode" role="group" aria-label="Capability mode">
              <button
                type="button"
                className={`ax-cap-mode-btn${unrestricted ? " is-active" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (unrestricted) return;
                  setUnrestricted(true);
                  void persist(true, enabled, `Unrestricted modules for ${detail.name}.`);
                }}
              >
                <strong>Unrestricted</strong>
                <span>Every left-nav module stays live (roles may still narrow).</span>
              </button>
              <button
                type="button"
                className={`ax-cap-mode-btn${!unrestricted ? " is-active" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (!unrestricted) return;
                  const next = new Set(detail.enabled);
                  setUnrestricted(false);
                  setEnabled(next);
                  void persist(false, next, `Curated ceiling for ${detail.name}.`);
                }}
              >
                <strong>Curated</strong>
                <span>Pick which modules this Business Profile may open.</span>
              </button>
            </div>

            <div className="ax-cap-section-rail" aria-label="Section coverage">
              {sectionCoverage.map(({ section, pct, optional }) => {
                const allOn = unrestricted || optional.every((r) => enabled.has(r.key));
                return (
                  <article key={section} className="ax-cap-section-card">
                    <div
                      className="ax-pack-ring"
                      style={{ "--pct": pct } as CSSProperties}
                      aria-label={`${section} ${pct}%`}
                    >
                      <span>{pct}%</span>
                    </div>
                    <div>
                      <strong>{section}</strong>
                      <p className="muted">
                        {optional.length} optional · {alwaysOn.size ? "core always on" : "no core"}
                      </p>
                    </div>
                    {optional.length ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy || unrestricted}
                        onClick={() => selectSection(section, !allOn)}
                      >
                        {allOn ? "Clear" : "Enable"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <div className="admin-form-row ax-cap-scan">
              <input
                value={moduleQuery}
                onChange={(e) => setModuleQuery(e.target.value)}
                placeholder="Scan modules…"
                aria-label="Search modules"
                disabled={unrestricted}
              />
              <div className="admin-tabs ax-lattice-filters" role="tablist" aria-label="Module filter">
                {(
                  [
                    ["all", "All"],
                    ["live", "Live"],
                    ["dim", "Dimmed"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={moduleFilter === id ? "active" : ""}
                    disabled={unrestricted && id !== "all"}
                    onClick={() => setModuleFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ax-legend">
              <span data-signal="included">Always on</span>
              <span data-signal="licensed">Live</span>
              <span data-signal="dim">Dimmed</span>
            </div>

            <fieldset
              disabled={unrestricted || busy}
              className="ax-cap-modules"
              style={{ opacity: unrestricted ? 0.55 : 1 }}
            >
              <legend className="sr-only">Module selection</legend>
              {visibleModules.map(([section, rows]) => (
                <div key={section} className="ax-cat">
                  <h5>{section}</h5>
                  <div className="ax-nodes">
                    {rows.map((row) => {
                      const locked = alwaysOn.has(row.key);
                      const live = locked || unrestricted || enabled.has(row.key);
                      const signal = locked ? "included" : live ? "licensed" : "dim";
                      return (
                        <article key={row.key} className="ax-node" data-signal={signal}>
                          <div className="ax-node-head">
                            <strong>{row.label}</strong>
                            <span className="ax-node-signal">
                              {locked ? "Always on" : live ? "Live" : "Dimmed"}
                            </span>
                          </div>
                          <p className="muted">
                            <code>{row.key}</code>
                          </p>
                          <div className="ax-node-actions">
                            {locked ? null : (
                              <button
                                type="button"
                                className={`btn btn-sm ${live ? "btn-ghost" : "btn-primary"}`}
                                disabled={busy || unrestricted}
                                onClick={() => toggleModule(row.key, !live)}
                              >
                                {live ? "Dim" : "Enable"}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
              {visibleModules.length === 0 ? (
                <p className="muted">No modules match this scan.</p>
              ) : null}
            </fieldset>
          </div>
        ) : null}
      </section>
    );
  },
);
