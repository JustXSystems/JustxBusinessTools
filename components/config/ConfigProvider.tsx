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
import {
  DEFAULT_BRANDING,
  DEFAULT_POWERED_BY,
  type PlatformBranding,
} from "@/components/branding/BrandingProvider";
import { applyThemeTokens, type ThemeTokens } from "@/lib/theme";

export type PlatformToolDefinition = {
  id: string;
  toolType: string;
  definition: Record<string, unknown>;
};

export type EffectiveConfig = {
  poweredBy: { text: string; locked: boolean };
  branding: PlatformBranding;
  configVersion: number;
  tools: PlatformToolDefinition[];
  theme?: ThemeTokens | Record<string, string> | null;
};

type ConfigContextValue = {
  config: EffectiveConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
  getToolDefinition: (toolId: string) => PlatformToolDefinition | undefined;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<EffectiveConfig>("/config/effective");
      setConfig({
        ...data,
        branding: data.branding ?? DEFAULT_BRANDING,
      });
    } catch {
      setConfig({
        poweredBy: DEFAULT_POWERED_BY,
        branding: DEFAULT_BRANDING,
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
    applyThemeTokens(config?.theme as ThemeTokens | null | undefined);
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
