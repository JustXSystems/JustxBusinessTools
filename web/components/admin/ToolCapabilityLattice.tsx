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
import { Alert, Button, Input, Segmented, Skeleton, Switch, type BosSegmentOption } from "@/components/bos";
import { AdminEmpty } from "@/components/admin/ui";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { FabricCapabilityTool } from "@/lib/access-fabric";

type CapMode = "unrestricted" | "curated";

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
        <div id="ax-capabilities" className="admin-cc-cap" aria-label="Tool capabilities">
          <AdminEmpty title="No tool selected" icon="search">
            Select a tool to tune licenses or module ceilings.
          </AdminEmpty>
        </div>
      );
    }

    const modeOptions: ReadonlyArray<BosSegmentOption<CapMode>> = [
      { value: "unrestricted", label: "Unrestricted" },
      {
        value: "curated",
        label: `Curated${detail?.coveragePct != null && !unrestricted ? ` · ${detail.coveragePct}%` : ""}`,
      },
    ];

    function onModeChange(next: CapMode) {
      if (!detail || busy) return;
      if (next === "unrestricted") {
        if (unrestricted) return;
        setUnrestricted(true);
        void persist(true, enabled, `Unrestricted modules for ${detail.name}.`);
        return;
      }
      if (!unrestricted) return;
      const nextEnabled = new Set(detail.enabled);
      setUnrestricted(false);
      setEnabled(nextEnabled);
      void persist(false, nextEnabled, `Curated ceiling for ${detail.name}.`);
    }

    const filterOptions: ReadonlyArray<BosSegmentOption<"all" | "live" | "dim">> = [
      { value: "all", label: "All" },
      { value: "live", label: "Live" },
      { value: "dim", label: "Dim" },
    ];

    return (
      <div id="ax-capabilities" className="admin-cc-cap" aria-label="Tool capabilities" aria-busy={busy || undefined}>
        {error ? <Alert tone="coral" title="Capabilities error">{error}</Alert> : null}
        {message ? <Alert tone="emerald" title={message} /> : null}

        {!detail ? (
          error ? null : (
            <div aria-busy="true" aria-label="Loading capabilities" style={{ display: "grid", gap: 8 }}>
              <Skeleton width="40%" height={14} radius={6} />
              <Skeleton width="100%" height={44} radius={10} />
              <Skeleton width="100%" height={44} radius={10} />
              <Skeleton width="100%" height={44} radius={10} />
            </div>
          )
        ) : !detail.entitled ? (
          <Alert
            tone="amber"
            title="Not licensed"
            actions={
              <Button
                variant="primary"
                size="sm"
                disabled={granting || busy}
                onClick={() => {
                  if (!onRequestGrant) return;
                  setGranting(true);
                  void Promise.resolve(onRequestGrant(detail.toolId)).finally(() => setGranting(false));
                }}
              >
                {granting ? "Granting…" : "Grant license"}
              </Button>
            }
          >
            Grant a license before module ceilings unlock.
          </Alert>
        ) : !detail.hasCeiling ? (
          <Alert tone="blue" title="Whole-tool access">
            No module ceiling for <code className="admin-cc-code">{detail.toolId}</code> — license is the unit of
            access.
          </Alert>
        ) : (
          <div className="admin-cc-cap">
            <Segmented<CapMode>
              role="radio"
              size="sm"
              aria-label="Capability mode"
              options={modeOptions}
              value={unrestricted ? "unrestricted" : "curated"}
              onChange={onModeChange}
            />

            <div className="admin-cc-cap-chips" role="group" aria-label="Section coverage">
              {sectionCoverage.map(({ section, pct, optional }) => {
                const allOn = unrestricted || optional.every((r) => enabled.has(r.key));
                return (
                  <button
                    key={section}
                    type="button"
                    className="admin-cc-cap-chip"
                    disabled={busy || unrestricted || optional.length === 0}
                    title={optional.length ? `${section}: ${pct}%` : section}
                    onClick={() => selectSection(section, !allOn)}
                  >
                    <strong>{section}</strong>
                    <em>{pct}%</em>
                    <span className="admin-cc-cap-meter" aria-hidden>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="admin-cc-cap-scan">
              <Input
                size="sm"
                value={moduleQuery}
                onChange={(e) => setModuleQuery(e.target.value)}
                placeholder="Filter modules…"
                aria-label="Search modules"
                disabled={unrestricted}
              />
              <Segmented<"all" | "live" | "dim">
                role="radio"
                size="sm"
                aria-label="Module filter"
                options={filterOptions}
                value={unrestricted ? "all" : moduleFilter}
                onChange={(next) => {
                  if (!unrestricted) setModuleFilter(next);
                }}
              />
            </div>

            <fieldset
              disabled={unrestricted || busy}
              className="admin-cc-cap-modules"
              style={{ opacity: unrestricted ? 0.5 : 1 }}
            >
              <legend className="bos-sr-only">Modules</legend>
              {visibleModules.map(([section, rows]) => (
                <div key={section} className="admin-cc-cap-group">
                  <div className="admin-cc-subhead" style={{ margin: 0 }}>
                    {section}
                  </div>
                  <ul className="admin-cc-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 6 }}>
                    {rows.map((row) => {
                      const locked = alwaysOn.has(row.key);
                      const live = locked || unrestricted || enabled.has(row.key);
                      return (
                        <li
                          key={row.key}
                          className="admin-cc-row"
                          style={{ cursor: "default", alignItems: "center" }}
                          data-signal={locked ? "included" : live ? "licensed" : "dim"}
                        >
                          <div className="admin-cc-row-main">
                            <div className="admin-cc-cell-title">{row.label}</div>
                            <div className="admin-cc-cell-sub">{locked ? "Always on" : live ? "Live" : "Dimmed"}</div>
                          </div>
                          {locked ? null : (
                            <Switch
                              checked={live}
                              disabled={busy || unrestricted}
                              onChange={(next) => toggleModule(row.key, next)}
                              aria-label={`${row.label} (${live ? "live" : "dimmed"})`}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {visibleModules.length === 0 ? (
                <AdminEmpty title="No modules match" icon="search">
                  Adjust the search or filter.
                </AdminEmpty>
              ) : null}
            </fieldset>
          </div>
        )}
      </div>
    );
  },
);
