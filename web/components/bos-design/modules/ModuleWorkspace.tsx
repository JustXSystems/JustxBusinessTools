"use client";

import { useState, type ReactNode } from "react";
import { AppShell, ModuleHeader, NavBrand, Segmented, TimePill, useToast } from "@/components/bos";
import { ModuleRenderer, type ModuleRendererContext } from "./ModuleRenderer";
import type { ModuleSpec } from "./schema";

export type ModuleWorkspaceApi = {
  /** Switch the sidebar to another module (widget links, "View all"). */
  navigate: (moduleKey: string) => void;
  /** Toast-style acknowledgement for demo-only actions. */
  notify: (title: string, description?: string) => void;
};

type Props = {
  modules: ReadonlyArray<ModuleSpec>;
  brandName: string;
  logoSrc?: string;
  accent?: "blue" | "emerald";
  navLabel?: string;
  onSearch?: () => void;
  initialModule?: string;
  /** Resolves `{ type: "custom" }` blocks — the escape hatch for bespoke UI. */
  renderCustom?: (id: string, api: ModuleWorkspaceApi) => ReactNode;
  /** Fires when the user picks a module in the sidebar (not on programmatic navigation). */
  onModuleChange?: (moduleKey: string) => void;
  "aria-label"?: string;
};

/**
 * A complete BOS admin module: sidebar navigation, module header, optional
 * subtabs and a declarative block body. Each business domain (HR, Finance…)
 * is just a `ModuleSpec[]` plus a few custom blocks.
 */
export function ModuleWorkspace({
  modules,
  brandName,
  logoSrc,
  accent = "blue",
  navLabel,
  onSearch,
  initialModule,
  renderCustom,
  onModuleChange,
  ...aria
}: Props) {
  const [active, setActive] = useState(initialModule ?? modules[0]?.key ?? "");
  const [subtabs, setSubtabs] = useState<Record<string, string>>({});
  const { show } = useToast();

  const current = modules.find((m) => m.key === active) ?? modules[0];
  if (!current) return null;

  const api: ModuleWorkspaceApi = {
    navigate: (key) => {
      if (modules.some((m) => m.key === key)) setActive(key);
    },
    notify: (title, description) => show({ tone: "blue", title, description }),
  };

  const ctx: ModuleRendererContext = {
    onNavigate: api.navigate,
    onAction: (action, label) => {
      if (action.startsWith("approval:")) {
        const approved = action.endsWith("approved");
        show({ tone: approved ? "emerald" : "coral", title: approved ? "Approved" : "Rejected", description: label });
        return;
      }
      show({ tone: "blue", title: label, description: "Sample action — no data was changed." });
    },
    renderCustom: renderCustom ? (id) => renderCustom(id, api) : undefined,
  };

  const subtab = current.subtabs ? (current.subtabs.find((s) => s.key === subtabs[current.key]) ?? current.subtabs[0]) : null;
  const blocks = subtab ? subtab.blocks : (current.blocks ?? []);

  return (
    <AppShell
      brand={<NavBrand name={brandName} logoSrc={logoSrc} />}
      items={modules.map((m) => ({ key: m.key, label: m.label, icon: m.icon }))}
      active={current.key}
      onSelect={(key) => {
        setActive(key);
        onModuleChange?.(key);
      }}
      accent={accent}
      navLabel={navLabel}
      onSearch={onSearch}
      footer={<TimePill />}
      aria-label={aria["aria-label"]}
    >
      <ModuleHeader title={current.title} sub={current.sub} />
      {current.subtabs && subtab ? (
        <div className="bos-subtabs">
          <Segmented
            role="tabs"
            size="sm"
            scroll
            aria-label={`${current.label} sections`}
            options={current.subtabs.map((s) => ({ value: s.key, label: s.label }))}
            value={subtab.key}
            onChange={(key) => setSubtabs((cur) => ({ ...cur, [current.key]: key }))}
          />
        </div>
      ) : null}
      <div key={`${current.key}:${subtab?.key ?? ""}`} className={current.compact ? "bos-compact bos-fade-in" : "bos-fade-in"}>
        <ModuleRenderer blocks={blocks} ctx={ctx} />
      </div>
    </AppShell>
  );
}
