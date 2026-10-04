"use client";

import { useState, type CSSProperties } from "react";
import {
  Avatar,
  BosRoot,
  Brand,
  CommandPalette,
  Footnote,
  IconButton,
  SearchInput,
  Segmented,
  ThemeToggle,
  Topbar,
  useBosTheme,
  useCommandHotkey,
  useToast,
  type BosCommand,
} from "@/components/bos";
import { publicAssetUrl } from "@/lib/base-path";
import { SIGNED_IN_USER, WORKSPACES, type WorkspaceKey } from "./data/common";
import { DesignSystemView } from "./views/DesignSystemView";
import { FinanceView } from "./views/FinanceView";
import { HrmView } from "./views/HrmView";
import { InvoiceView } from "./views/InvoiceView";
import { LaunchView } from "./views/LaunchView";

const LOGO = "/icons/justx-bos-mark.png";

function Workbench() {
  const logoSrc = publicAssetUrl(LOGO);
  const { theme, setTheme, toggleTheme } = useBosTheme();
  const { show } = useToast();
  const [workspace, setWorkspace] = useState<WorkspaceKey>("design");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useCommandHotkey(() => setPaletteOpen(true));

  const go = (key: WorkspaceKey) => () => {
    setWorkspace(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openPalette = () => setPaletteOpen(true);

  const commands: BosCommand[] = [
    ...WORKSPACES.map((w) => ({ id: `ws-${w.value}`, section: "Navigate", label: w.label, icon: "⧉", onSelect: go(w.value) })),
    { id: "new-invoice", section: "Quick actions", label: "Create invoice", icon: "＋", keywords: "bill", onSelect: go("invoice") },
    { id: "theme", section: "Quick actions", label: `Switch to ${theme === "dark" ? "light" : "dark"} mode`, icon: "◐", onSelect: toggleTheme },
    {
      id: "ai",
      section: "Quick actions",
      label: "Ask AI Assistant",
      icon: "✦",
      hint: "⌘ J",
      onSelect: () => show({ title: "AI Assistant", description: "Sample command — no assistant is connected in this demo." }),
    },
  ];

  return (
    <>
      <Topbar sticky="desktop">
        <Brand logoSrc={logoSrc} name="Justx BOS" sub="Design System · v1" />
        <div className="bos-topbar-actions">
          <SearchInput
            readOnly
            placeholder="Search or jump to…"
            aria-label="Open command palette"
            shortcut="⌘K"
            onClick={openPalette}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openPalette();
            }}
          />
          <ThemeToggle theme={theme} onChange={setTheme} />
          <IconButton icon="bell" dot aria-label="Notifications" onClick={() => show({ title: "3 new notifications", description: "Payroll processed for July · GST filing due in 4 days" })} />
          <Avatar size="md" tone="var(--bos-blue)">
            {SIGNED_IN_USER.initials}
          </Avatar>
        </div>
      </Topbar>

      <div className="bos-wrap">
        <nav className="bos-subtabs" style={{ paddingTop: 24 }} aria-label="Workspaces">
          <Segmented role="tabs" scroll aria-label="Workspaces" options={WORKSPACES} value={workspace} onChange={(w) => go(w)()} />
        </nav>

        <div key={workspace} className="bos-fade-in">
          {workspace === "design" ? <DesignSystemView logoSrc={logoSrc} onOpenLaunch={go("launch")} /> : null}
          {workspace === "launch" ? <LaunchView logoSrc={logoSrc} onOpenHrm={go("hrm")} /> : null}
          {workspace === "hrm" ? <HrmView logoSrc={logoSrc} onSearch={openPalette} /> : null}
          {workspace === "invoice" ? <InvoiceView /> : null}
          {workspace === "finance" ? <FinanceView onSearch={openPalette} onCreateInvoice={go("invoice")} /> : null}
        </div>

        <Footnote>
          Justx BOS™ (Business Operating System) · Designed &amp; Developed by{" "}
          <a href="https://justxsystems.com/" target="_blank" rel="noopener noreferrer">
            Justx Systems
          </a>{" "}
          · © 2026 Justx Systems. All Rights Reserved.
        </Footnote>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} placeholder="Type a command or search…" />
    </>
  );
}

/** Matches the horizontal padding of the JBT `.page-shell` the tool renders in. */
const HOST_GUTTER = { "--bos-bleed": "20px" } as CSSProperties;

/** "Justx BOS Design" JBT tool: the living reference for the BOS design system. */
export default function BosDesignTool() {
  return (
    <BosRoot canvas className="bos-bleed" style={HOST_GUTTER}>
      <Workbench />
    </BosRoot>
  );
}
