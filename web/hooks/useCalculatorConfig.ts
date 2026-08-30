"use client";

import { usePlatformConfig } from "@/components/config/ConfigProvider";
import {
  resolveCommissionParams,
  resolveEmiParams,
  resolveGstRates,
  resolveLoanParams,
  resolveProfitParams,
  resolveSolarRoiParams,
  resolveTaxParams,
  resolveTdsSections,
} from "@/lib/calculator-config";

export function useGstRates(): number[] {
  const { getToolDefinition } = usePlatformConfig();
  return resolveGstRates(getToolDefinition("gstcalc"));
}

export function useTdsSections() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveTdsSections(getToolDefinition("tdscalc"));
}

export function useTaxParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveTaxParams(getToolDefinition("taxcalc"));
}

export function useProfitParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveProfitParams(getToolDefinition("profitcalc"));
}

export function useEmiParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveEmiParams(getToolDefinition("emicalc"));
}

export function useLoanParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveLoanParams(getToolDefinition("loancalc"));
}

export function useSolarRoiParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveSolarRoiParams(getToolDefinition("solarroi"));
}

export function useCommissionParams() {
  const { getToolDefinition } = usePlatformConfig();
  return resolveCommissionParams(getToolDefinition("dealercommission"));
}
