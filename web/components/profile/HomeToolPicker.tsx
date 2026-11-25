"use client";

import { useMemo } from "react";
import type { PlatformToolDefinition } from "@/components/config/ConfigProvider";
import { useOptionalPlatformConfig } from "@/components/config/ConfigProvider";
import {
  applyPersonalUsageOverrides,
  filterHomeToolsByPersonalAccount,
  homeToolsByCategory,
  mergedHomeTools,
} from "@/lib/dynamic-tools";

type Props = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Admin-published tools; omit on public register (builtins only). */
  platformTools?: PlatformToolDefinition[];
  /**
   * When true, only GSTIN-independent (personalUsage) tools are listed —
   * used for individual registration and personal /profile tool selection.
   */
  personalOnly?: boolean;
};

export function HomeToolPicker({
  selectedIds,
  onChange,
  disabled,
  platformTools = [],
  personalOnly = false,
}: Props) {
  const configCtx = useOptionalPlatformConfig();
  const groupTools = configCtx?.config?.toolGrouping?.enabled !== false;
  const personalUsage = configCtx?.config?.toolPersonalUsage ?? {};
  const allTools = useMemo(() => {
    const merged = applyPersonalUsageOverrides(mergedHomeTools(platformTools), personalUsage);
    return filterHomeToolsByPersonalAccount(merged, personalOnly, personalUsage);
  }, [platformTools, personalOnly, personalUsage]);
  const groups = useMemo(
    () => homeToolsByCategory(allTools, { group: groupTools }),
    [allTools, groupTools],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  const chips = (tools: typeof allTools) => (
    <div className="home-tool-picker-grid">
      {tools.map((tool) => {
        const on = selected.has(tool.id);
        return (
          <button
            key={tool.id}
            type="button"
            className={`home-tool-chip ${on ? "is-selected" : ""}`}
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(tool.id)}
          >
            <span className="home-tool-chip-icon">{tool.icon}</span>
            <span className="home-tool-chip-name">{tool.name}</span>
            {on ? <span className="home-tool-chip-check">✓</span> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="home-tool-picker">
      <div className="home-tool-picker-toolbar">
        <span className="home-tool-picker-meta">
          {selectedIds.length} of {allTools.length} tools selected for home
          {personalOnly ? " · personal tools only" : ""}
        </span>
        <button
          type="button"
          className="home-tool-picker-action"
          disabled={disabled}
          onClick={() => onChange(allTools.map((t) => t.id))}
        >
          Select all
        </button>
        <button
          type="button"
          className="home-tool-picker-action"
          disabled={disabled}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      </div>
      {groupTools
        ? groups.map((group) => (
            <div key={group.category} className="home-tool-picker-group">
              <div className="category-head">
                <span className="category-title">{group.category}</span>
                <span className="category-count">{group.tools.length}</span>
              </div>
              {chips(group.tools)}
            </div>
          ))
        : chips(groups.flatMap((g) => g.tools))}
    </div>
  );
}
