"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import {
  liveFirstFetch,
  readContingencyJson,
  writeContingencyJson,
} from "@/lib/live-first";

export type PlatformToolDefinition = {
  id: string;
  toolType: string;
  definition: Record<string, unknown>;
};

export type PlatformCatalogTool = {
  id: string;
  groupName: string;
  sortOrder: number;
  available: boolean;
};

export type EffectiveConfig = {
  poweredBy: { text: string; locked: boolean };
  branding: PlatformBranding;
  configVersion: number;
  tools: PlatformToolDefinition[];
  catalog?: PlatformCatalogTool[];
  theme?: ThemeTokens | Record<string, string> | null;
};

type ConfigContextValue = {
  config: EffectiveConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
  getToolDefinition: (toolId: string) => PlatformToolDefinition | undefined;
};

const CONFIG_CONTINGENCY_KEY = "jbt.config.effective.contingency.v1";

const ConfigContext = createContext<ConfigContextValue | null>(null);

const DEFAULT_CONFIG: EffectiveConfig = {
  poweredBy: DEFAULT_POWERED_BY,
  branding: DEFAULT_BRANDING,
  configVersion: 1,
  tools: [],
  catalog: [],
};

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const liveConfirmedRef = useRef(false);

  const refresh = useCallback(async () => {
    const result = await liveFirstFetch({
      fetchLive: async () => {
        const data = await api<EffectiveConfig>("/config/effective");
        return {
          ...data,
          branding: data.branding ?? DEFAULT_BRANDING,
        };
      },
      readContingency: () => readContingencyJson<EffectiveConfig>(CONFIG_CONTINGENCY_KEY),
      defaults: DEFAULT_CONFIG,
      timeoutMs: 10_000,
    });

    if (result.source === "live") {
      liveConfirmedRef.current = true;
      writeContingencyJson(CONFIG_CONTINGENCY_KEY, result.data);
      setConfig(result.data);
    } else if (!liveConfirmedRef.current) {
      setConfig(result.data);
    }
    setLoading(false);
  }, []);

  useLiveRefresh(refresh, { intervalMs: 45_000 });

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
