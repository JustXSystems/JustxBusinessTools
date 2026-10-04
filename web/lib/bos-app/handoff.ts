import type { ConnectorTarget } from "./api";

export const BOS_TOOL_ID = "bos";

/** BOS is enabled for an org once its catalog row is Live (Admin → Tools → Justx BOS). */
export function isBosLive(catalog: ReadonlyArray<{ id: string; available: boolean }> | null | undefined): boolean {
  return Boolean(catalog?.some((c) => c.id === BOS_TOOL_ID && c.available === true));
}

export type HandoffTool = "quotationv1" | "sitesurveyv1";

export type HandoffSpec = {
  /** Admin switch that must be on before the button appears in the source tool. */
  switchKey: string;
  target: ConnectorTarget;
  /** What BOS creates, for button copy and confirmations. */
  creates: string;
  openHref: (id: string) => string;
};

export const HANDOFF: Record<HandoffTool, HandoffSpec> = {
  quotationv1: {
    switchKey: "bos.handoff.quotationv1",
    target: "invoice",
    creates: "draft invoice",
    openHref: (id) => `/tools/bos?ws=finance&m=invoices&open=${encodeURIComponent(id)}`,
  },
  sitesurveyv1: {
    switchKey: "bos.handoff.sitesurveyv1",
    target: "project",
    creates: "project lead",
    openHref: (id) => `/tools/bos?ws=projects&m=board&open=${encodeURIComponent(id)}`,
  },
};

/** Statuses a record must have before BOS accepts it: saved and not a draft or a rejection. */
export function canHandOff(status: string | null | undefined): boolean {
  return Boolean(status) && status !== "draft" && status !== "rejected";
}
