"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";

export type PlatformToolDefinition = {
  id: string;
  toolType: string;
  definition: Record<string, unknown>;
};

export type EffectiveConfig = {
  poweredBy: { text: string; locked: boolean };
  configVersion: number;
  tools: PlatformToolDefinition[];
  theme?: Record<string, string> | null;
};

type ConfigContextValue = {
  config: EffectiveConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
  getToolDefinition: (toolId: string) => PlatformToolDefinition | undefined;
};

const DEFAULT_POWERED_BY = { text: "Powered by JustX Systems LLP", locked: true };

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<EffectiveConfig>("/config/effective");
      setConfig(data);
    } catch {
      setConfig({
        poweredBy: DEFAULT_POWERED_BY,
        configVersion: 1,
        tools: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const tokens = config?.theme;
    const root = document.documentElement;
    if (!tokens) return;
    if (tokens.accent) root.style.setProperty("--accent", tokens.accent);
    if (tokens.teal) root.style.setProperty("--teal", tokens.teal);
    if (tokens.bg0) root.style.setProperty("--bg-0", tokens.bg0);
    if (tokens.bg1) root.style.setProperty("--bg-1", tokens.bg1);
    if (tokens.bg2) root.style.setProperty("--bg-2", tokens.bg2);
    if (tokens.radius) root.style.setProperty("--radius", tokens.radius);
    if (tokens.font) root.style.setProperty("--font-sans", tokens.font);
  }, [config?.theme]);

  const getToolDefinition = useCallback(
    (toolId: string) => config?.tools.find((t) => t.id === toolId),
    [config],
  );

  const value = useMemo(
    () => ({ config, loading, refresh, getToolDefinition }),
    [config, loading, refresh, getToolDefinition],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function usePlatformConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("usePlatformConfig must be used within ConfigProvider");
  return ctx;
}

export function usePoweredByText(): string {
  const ctx = useContext(ConfigContext);
  return ctx?.config?.poweredBy.text ?? DEFAULT_POWERED_BY.text;
}
