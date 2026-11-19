"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
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
  /** Latest capability summary rows (for roster badges). */
  getSummary: () => CapabilitySummaryTool[];
};

type Props = {
  businessProfileId: number;
  /** Parent-controlled tool selection (master–detail). */
  selectedToolId: string | null;
  onSelectedToolIdChange?: (toolId: string) => void;
  onSummary?: (tools: FabricCapabilityTool[]) => void;
  onRequestGrant?: (toolId: string) => void | Promise<void>;
};

export const ToolCapabilityLattice = forwardRef<ToolCapabilityLatticeHandle, Props>(
  function ToolCapabilityLattice(
    { businessProfileId, selectedToolId, onSelectedToolIdChange, onSummary, onRequestGrant },
    ref,
  ) {
    const [tools, setTools] = useState<CapabilitySummaryTool[]>([]);
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
    const toolsRef = useRef(tools);
    toolsRef.current = tools;

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
        setModuleQuery("");
        setModuleFilter("all");
        return data;
      },
      [businessProfileId],
    );

    const refresh = useCallback(async () => {
      setError("");
      try {
        await reloadSummary();
        if (selectedToolId) await loadDetail(selectedToolId);
        else setDetail(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load capabilities");
      }
    }, [reloadSummary, loadDetail, selectedToolId]);

    useLiveRefresh(() => refresh().catch(() => undefined), {
      intervalMs: 60_000,
      deps: [businessProfileId],
    });

    useEffect(() => {
      if (!selectedToolId) {
        setDetail(null);
        return;
      }
      let cancelled = false;
      setError("");
      void loadDetail(selectedToolId).catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setDetail(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [selectedToolId, loadDetail]);

    useImperativeHandle(
      ref,
      () => ({
        focusTool: (toolId?: string) => {
          const el = document.getElementById("ax-capabilities");
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          if (toolId) onSelectedToolIdChange?.(toolId);
        },
        reload: refresh,
        getSummary: () => toolsRef.current,
      }),
      [refresh, onSelectedToolIdChange],
    );

    const alwaysOn = useMemo(() => new Set(detail?.alwaysOn ?? []), [detail]);

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

    async function persist(nextUnrestricted: boolean, nextEnabled: Set<string>, label: string) {
      if (!selectedToolId || !detail?.hasCeiling) return;
      setBusyKey(selectedToolId);
      setMessage("");
      setError("");
      try {
        const data = await api<CapabilityDetail>(
          `/admin/tool-capabilities/${encodeURIComponent(selectedToolId)}`,
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
        return { section, pct: Math.round((on / optional.length) * 100), optional };
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

    if (!selectedToolId) {
      return (
        <div id="ax-capabilities" className="ax-cap-inspector ax-cap-inspector-empty">
          <p className="muted">Select a tool to tune licenses or module ceilings.</p>
        </div>
      );
    }

    return (
      <div id="ax-capabilities" className="ax-cap-inspector" aria-label="Tool capabilities">
        {error ? <p className="field-error">{error}</p> : null}
        {message ? <p className="muted ax-cap-flash">{message}</p> : null}

        {!detail ? (
          <p className="muted">Loading capabilities…</p>
        ) : !detail.entitled ? (
          <div className="ax-cap-locked">
            <div>
              <strong>Not licensed</strong>
              <p className="muted">Grant a license before module ceilings unlock.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={granting || busy}
              onClick={() => {
                if (!onRequestGrant) return;
                setGranting(true);
                void Promise.resolve(onRequestGrant(detail.toolId)).finally(() => setGranting(false));
              }}
            >
              {granting ? "Granting…" : "Grant license"}
            </button>
          </div>
        ) : !detail.hasCeiling ? (
          <div className="ax-cap-whole">
            <strong>Whole-tool access</strong>
            <p className="muted">
              No module ceiling for <code>{detail.toolId}</code> — license is the unit of access.
            </p>
          </div>
        ) : (
          <div className="ax-cap-detail">
            <div className="ax-cap-mode ax-cap-mode-compact" role="group" aria-label="Capability mode">
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
                Unrestricted
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
                Curated{detail.coveragePct != null && !unrestricted ? ` · ${detail.coveragePct}%` : ""}
              </button>
            </div>

            <div className="ax-cap-section-rail ax-cap-section-rail-compact" aria-label="Section coverage">
              {sectionCoverage.map(({ section, pct, optional }) => {
                const allOn = unrestricted || optional.every((r) => enabled.has(r.key));
                return (
                  <button
                    key={section}
                    type="button"
                    className="ax-cap-section-chip"
                    disabled={busy || unrestricted || optional.length === 0}
                    title={optional.length ? `${section}: ${pct}%` : section}
                    onClick={() => selectSection(section, !allOn)}
                  >
                    <span className="ax-cap-section-meter" aria-hidden>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <strong>{section}</strong>
                    <em>{pct}%</em>
                  </button>
                );
              })}
            </div>

            <div className="ax-cap-scan admin-form-row">
              <input
                value={moduleQuery}
                onChange={(e) => setModuleQuery(e.target.value)}
                placeholder="Filter modules…"
                aria-label="Search modules"
                disabled={unrestricted}
              />
              <div className="admin-tabs ax-lattice-filters" role="tablist" aria-label="Module filter">
                {(
                  [
                    ["all", "All"],
                    ["live", "Live"],
                    ["dim", "Dim"],
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

            <fieldset
              disabled={unrestricted || busy}
              className="ax-cap-module-list"
              style={{ opacity: unrestricted ? 0.5 : 1 }}
            >
              <legend className="sr-only">Modules</legend>
              {visibleModules.map(([section, rows]) => (
                <div key={section} className="ax-cap-module-group">
                  <h5>{section}</h5>
                  <ul>
                    {rows.map((row) => {
                      const locked = alwaysOn.has(row.key);
                      const live = locked || unrestricted || enabled.has(row.key);
                      return (
                        <li key={row.key} data-signal={locked ? "included" : live ? "licensed" : "dim"}>
                          <div>
                            <strong>{row.label}</strong>
                            <span>{locked ? "Always on" : live ? "Live" : "Dimmed"}</span>
                          </div>
                          {locked ? null : (
                            <button
                              type="button"
                              className={`btn btn-sm ${live ? "btn-ghost" : "btn-primary"}`}
                              disabled={busy || unrestricted}
                              onClick={() => toggleModule(row.key, !live)}
                            >
                              {live ? "Dim" : "On"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {visibleModules.length === 0 ? <p className="muted">No modules match.</p> : null}
            </fieldset>
          </div>
        )}
      </div>
    );
  },
);
