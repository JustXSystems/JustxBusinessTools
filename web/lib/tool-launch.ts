/**
 * Tools that ship a full-screen app (no JBT sidebar / header).
 * Home + admin launch settings decide whether these open standalone or stay embedded in `/tools/*`.
 */
export const STANDALONE_APP_BY_TOOL: Readonly<Record<string, string>> = {
  bos: "/bos",
  imsdealer: "/ims",
};

export type ToolLaunchMode = "standalone" | "embedded";

export type ToolLaunch = {
  mode: ToolLaunchMode;
  /** Path to open (with optional query preserved by callers). */
  href: string;
  /** Prefer a new browser window / tab (standalone only). */
  openInNewWindow: boolean;
};

export function supportsStandaloneApp(toolId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STANDALONE_APP_BY_TOOL, toolId);
}

export function standaloneAppPath(toolId: string): string | null {
  return STANDALONE_APP_BY_TOOL[toolId] ?? null;
}

/**
 * Resolve how a tool should open.
 * For BOS / IMS, standalone + new window is the default unless admin sets openStandalone=false.
 */
export function resolveToolLaunch(
  toolId: string,
  catalog?: { id?: string; openStandalone?: boolean | null } | null,
  embeddedRoute = `/tools/${toolId}`,
): ToolLaunch {
  const appPath = standaloneAppPath(toolId);
  if (!appPath) {
    return { mode: "embedded", href: embeddedRoute, openInNewWindow: false };
  }
  const explicit = catalog?.openStandalone;
  const standalone = explicit == null ? true : Boolean(explicit);
  if (!standalone) {
    return { mode: "embedded", href: embeddedRoute, openInNewWindow: false };
  }
  return { mode: "standalone", href: appPath, openInNewWindow: true };
}

/** Map a `/tools/bos?…` or `/tools/imsdealer?…` URL onto the standalone app, keeping query. */
export function toStandaloneHref(toolId: string, search = ""): string | null {
  const base = standaloneAppPath(toolId);
  if (!base) return null;
  const qs = search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${base}${qs}`;
}
