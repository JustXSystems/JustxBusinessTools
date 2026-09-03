"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { fetchProfile, greeting } from "@/lib/api";
import { ToolCard } from "@/components/home/ToolCard";
import { useDebounce } from "@/hooks/useDebounce";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import {
  mergedHomeTools,
  homeToolsByCategory,
  filterHomeToolsBySelection,
  filterHomeToolsByCatalog,
} from "@/lib/dynamic-tools";
import type { ToolDefinition } from "@/config/tools.config";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

function filterMergedTools(query: string, tools: ToolDefinition[]): ToolDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q),
  );
}

export function HomeDashboard() {
  const { config } = usePlatformConfig();
  const platformTools = config?.tools ?? [];
  const catalog = config?.catalog ?? [];
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const [businessName, setBusinessName] = useState("");
  const [homeToolIds, setHomeToolIds] = useState<string[] | null>(null);
  const [apiError, setApiError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!config) return;
    try {
      const p = await fetchProfile();
      setBusinessName(p.businessName || "");
      setHomeToolIds(p.homeToolIds ?? null);
      setApiError("");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load profile");
    }
  }, [config]);

  useLiveRefresh(loadProfile, { intervalMs: 90_000, enabled: Boolean(config), deps: [Boolean(config)] });

  const allTools = useMemo(() => {
    const merged = mergedHomeTools(platformTools);
    const byCatalog = filterHomeToolsByCatalog(merged, catalog);
    return filterHomeToolsBySelection(byCatalog, homeToolIds);
  }, [platformTools, catalog, homeToolIds]);
  const groupTools = config?.toolGrouping?.enabled !== false;
  const filtered = useMemo(() => filterMergedTools(debouncedSearch, allTools), [debouncedSearch, allTools]);
  const categorized = useMemo(
    () => homeToolsByCategory(allTools, { group: groupTools }),
    [allTools, groupTools],
  );
  const isSearching = debouncedSearch.trim().length > 0;

  return (
    <div>
      {apiError ? (
        <div className="error-banner">
          API unavailable ({apiError}). Start MySQL with <code>npm run db:up</code> and run{" "}
          <code>npm run db:setup</code>, then <code>npm run dev</code>.
        </div>
      ) : null}

      <div className="home-hero">
        <div className="home-hero-greeting">
          {greeting()}{businessName ? `, ${businessName}` : ""}
        </div>
        <div className="home-hero-title">What do you want to do today?</div>
        <div className="home-hero-sub">
          Quotations, orders, invoices, stock, projects, and calculators — all in one place.
        </div>
        <div className="search-box">
          <span>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools — e.g. invoice, GST, stock..."
            aria-label="Search tools"
          />
        </div>
        {!businessName ? (
          <div className="quick-row">
            <Link href="/profile" className="quick-chip">
              ✨ Set up your business profile first →
            </Link>
          </div>
        ) : (
          <div className="quick-row">
            <Link href="/sync" className="quick-chip">
              Sync pending files to Download Folder →
            </Link>
          </div>
        )}
        {homeToolIds && homeToolIds.length === 0 ? (
          <div className="quick-row">
            <Link href="/profile" className="quick-chip">
              Choose tools to show on home →
            </Link>
          </div>
        ) : null}
      </div>

      {isSearching ? (
        <>
          <div className="category-head">
            <span className="category-title">Search results</span>
            <span className="category-count">{filtered.length} tools</span>
          </div>
          {filtered.length ? (
            <div className="tool-grid">
              {filtered.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
            </div>
          ) : (
            <div className="empty-state">
              <div className="es-icon">🔍</div>
              <div className="es-title">No tools match &quot;{debouncedSearch}&quot;</div>
              <div className="es-sub">Try a different search term.</div>
            </div>
          )}
        </>
      ) : categorized.length === 0 ? (
        <div className="empty-state">
          <div className="es-icon">🧰</div>
          <div className="es-title">No tools selected for home</div>
          <div className="es-sub">
            Pick tools in <Link href="/profile">Business Profile</Link>. Billing still lists every tool.
          </div>
        </div>
      ) : groupTools ? (
        categorized.map((group) => (
          <section key={group.category} className="category-block">
            <div className="category-head">
              <span className="category-title">{group.category}</span>
              <span className="category-count">{group.tools.length}</span>
            </div>
            <div className="tool-grid">
              {group.tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
            </div>
          </section>
        ))
      ) : (
        <div className="tool-grid">
          {categorized.flatMap((g) => g.tools).map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
