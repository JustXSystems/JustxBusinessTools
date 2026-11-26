"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { fetchProfile, greeting } from "@/lib/api";
import { SubscriptionStatusStrip } from "@/components/home/SubscriptionStatusStrip";
import { ToolCard } from "@/components/home/ToolCard";
import { useDebounce } from "@/hooks/useDebounce";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import {
  mergedHomeTools,
  homeToolsByCategory,
  filterHomeToolsBySelection,
  filterHomeToolsByCatalog,
  filterHomeToolsByPersonalAccount,
  applyPersonalUsageOverrides,
  catalogEnabledOptInTools,
} from "@/lib/dynamic-tools";
import type { ToolDefinition } from "@/config/tools.config";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useAuth } from "@/components/auth/AuthProvider";
import { isPersonalAccount } from "@/lib/personal-account";

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
  const { user } = useAuth();
  const { config } = usePlatformConfig();
  const platformTools = config?.tools ?? [];
  const catalog = config?.catalog ?? [];
  const personalUsage = config?.toolPersonalUsage ?? {};
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const [businessName, setBusinessName] = useState("");
  const [profileGstin, setProfileGstin] = useState<string | null>(null);
  const [homeToolIds, setHomeToolIds] = useState<string[] | null>(null);
  const [apiError, setApiError] = useState("");
  const personal = isPersonalAccount(user, profileGstin);

  const loadProfile = useCallback(async () => {
    if (!config) return;
    try {
      const p = await fetchProfile();
      setBusinessName(p.businessName || "");
      setProfileGstin(p.gstin ?? null);
      setHomeToolIds(p.homeToolIds ?? null);
      setApiError("");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load profile");
    }
  }, [config]);

  useLiveRefresh(loadProfile, { intervalMs: 90_000, enabled: Boolean(config), deps: [Boolean(config)] });

  const allTools = useMemo(() => {
    const merged = applyPersonalUsageOverrides(mergedHomeTools(platformTools), personalUsage);
    const byCatalog = filterHomeToolsByCatalog(merged, catalog);
    const selected = [
      ...filterHomeToolsBySelection(byCatalog, homeToolIds),
      ...applyPersonalUsageOverrides(catalogEnabledOptInTools(catalog), personalUsage),
    ];
    return filterHomeToolsByPersonalAccount(selected, personal, personalUsage);
  }, [platformTools, catalog, homeToolIds, personal, personalUsage]);
  const groupTools = config?.toolGrouping?.enabled !== false;
  const filtered = useMemo(() => filterMergedTools(debouncedSearch, allTools), [debouncedSearch, allTools]);
  const categorized = useMemo(
    () => homeToolsByCategory(allTools, { group: groupTools }),
    [allTools, groupTools],
  );
  const isSearching = debouncedSearch.trim().length > 0;

  const toolCount = allTools.length;
  const categoryCount = categorized.length;

  return (
    <div className="home-dashboard">
      {apiError ? (
        <div className="error-banner">
          API unavailable ({apiError}). Start MySQL with <code>npm run db:up</code> and run{" "}
          <code>npm run db:setup</code>, then <code>npm run dev</code>.
        </div>
      ) : null}

      <div className="home-hero home-hero-corp">
        <div className="home-hero-mesh" aria-hidden />
        <div className="home-hero-inner">
          <div className="home-hero-greeting">
            {greeting()}
            {businessName ? ` · ${businessName}` : ""}
          </div>
          <div className="home-hero-title">What do you want to do today?</div>
          <div className="home-hero-sub">
            Corporate-ready quotations, site surveys, invoices, and calculators — pick a tool and
            work from any device.
          </div>
          <div className="search-box">
            <span aria-hidden>🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools — quotation, survey, GST…"
              aria-label="Search tools"
            />
          </div>
          {toolCount > 0 ? (
            <div className="home-hero-stats">
              <div className="home-stat">
                <span className="home-stat-value">{toolCount}</span>
                <span>{toolCount === 1 ? "Tool on home" : "Tools on home"}</span>
              </div>
              {groupTools && categoryCount > 0 ? (
                <div className="home-stat">
                  <span className="home-stat-value">{categoryCount}</span>
                  <span>{categoryCount === 1 ? "Category" : "Categories"}</span>
                </div>
              ) : null}
            </div>
          ) : null}
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
      </div>

      <SubscriptionStatusStrip />

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
