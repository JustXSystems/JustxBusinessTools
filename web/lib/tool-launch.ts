/**
 * Tools that ship a full-screen app (no JBT sidebar / header).
 * Home + admin launch settings decide whether these open standalone or stay embedded in `/tools/*`.
 */
export const STANDALONE_APP_BY_TOOL: Readonly<Record<string, string>> = {
  bos: "/bos",
  imsdealer: "/ims",
  gmap2mappls: "/googlemaps2mappls",
};

/** Always launch as an independent app window (admin embed override ignored). */
export const FORCE_STANDALONE_APP_TOOL_IDS: ReadonlySet<string> = new Set(["gmap2mappls"]);

/** Popup chrome for phone-shaped independent app windows. */
export const STANDALONE_APP_WINDOW_FEATURES: Readonly<Record<string, string>> = {
  gmap2mappls: "popup=yes,width=440,height=860,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes",
  bos: "popup=yes,width=1280,height=900,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes",
  imsdealer: "popup=yes,width=1280,height=900,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes",
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
 * For BOS / IMS / GoogleMaps2Mappls, standalone + new window is the default unless admin sets openStandalone=false.
 * GoogleMaps2Mappls always forces standalone (independent app).
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
  if (FORCE_STANDALONE_APP_TOOL_IDS.has(toolId)) {
    return { mode: "standalone", href: appPath, openInNewWindow: true };
  }
  const explicit = catalog?.openStandalone;
  const standalone = explicit == null ? true : Boolean(explicit);
  if (!standalone) {
    return { mode: "embedded", href: embeddedRoute, openInNewWindow: false };
  }
  return { mode: "standalone", href: appPath, openInNewWindow: true };
}

/**
 * Open a standalone tool as an independent app window (named popup).
 * Falls back to same-tab navigation when the popup is blocked.
 */
export function openStandaloneAppWindow(
  href: string,
  toolId: string,
  absoluteHref?: string,
): Window | null {
  if (typeof window === "undefined") return null;
  const url = absoluteHref || href;

  // Phones/tablets: same-tab navigation. Popup features are ignored or create
  // oddly scaled windows on real mobile browsers.
  const isTouchUi =
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    window.matchMedia("(max-width: 900px)").matches;
  if (isTouchUi) {
    window.location.assign(url);
    return window;
  }

  const features = STANDALONE_APP_WINDOW_FEATURES[toolId] || "popup=yes,width=440,height=860,resizable=yes,scrollbars=yes";
  const name = `jbt-app-${toolId}`;
  try {
    const w = window.open(url, name, features);
    if (w) {
      try {
        w.focus();
      } catch {
        /* ignore */
      }
      return w;
    }
  } catch {
    /* popup blocked */
  }
  return null;
}

/** Map a `/tools/bos?…` or `/tools/imsdealer?…` URL onto the standalone app, keeping query. */
export function toStandaloneHref(toolId: string, search = ""): string | null {
  const base = standaloneAppPath(toolId);
  if (!base) return null;
  const qs = search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${base}${qs}`;
}
