export type SidebarDensity = "mini" | "docked" | "normal";
export type SidebarAttachment = "edge" | "floating";

/** Composite mode used by CSS. */
export type SidebarLayoutMode =
  | "mini"
  | "docked"
  | "normal"
  | "floating";

export type SidebarLayoutState = {
  width: number;
  attachment: SidebarAttachment;
  /** Last non-mini width for double-click restore (Finder/Explorer style). */
  restoreWidth: number;
  /** Floating dock position (viewport px). */
  floatX: number;
  floatY: number;
  /** Keep floating dock expanded (Pin). */
  floatPinned: boolean;
};

export const SIDEBAR_SNAPS = {
  mini: 76,
  docked: 200,
  normal: 252,
} as const;

export const SIDEBAR_WIDTH_MIN = SIDEBAR_SNAPS.mini;
export const SIDEBAR_WIDTH_MAX = 320;

export const FLOAT_DOCK_DEFAULT = { x: 18, y: 96 } as const;

export const SIDEBAR_LAYOUT_META: Record<
  SidebarLayoutMode,
  { label: string; hint: string }
> = {
  mini: { label: "Mini", hint: "Icon rail — maximum workspace" },
  docked: { label: "Docked", hint: "Compact labels, flush edge" },
  normal: { label: "Normal", hint: "Full navigation" },
  floating: { label: "Float", hint: "Movable mini dock over content" },
};

export const OPERATOR_SIDEBAR_KEY = "jbt.sidebar-layout-v3";
export const ADMIN_SIDEBAR_KEY = "jbt.admin-sidebar-layout-v3";

export function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

export function densityFromWidth(width: number): SidebarDensity {
  if (width <= (SIDEBAR_SNAPS.mini + SIDEBAR_SNAPS.docked) / 2) return "mini";
  if (width <= (SIDEBAR_SNAPS.docked + SIDEBAR_SNAPS.normal) / 2) return "docked";
  return "normal";
}

export function snapSidebarWidth(width: number): number {
  const w = clampSidebarWidth(width);
  const snaps = [SIDEBAR_SNAPS.mini, SIDEBAR_SNAPS.docked, SIDEBAR_SNAPS.normal];
  let best = snaps[0];
  let bestDist = Math.abs(w - best);
  for (const s of snaps) {
    const d = Math.abs(w - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  if (bestDist <= 28) return best;
  return w;
}

export function resolveLayoutMode(
  width: number,
  attachment: SidebarAttachment,
): SidebarLayoutMode {
  // Float is a distinct chrome — always take over (true floating dock).
  if (attachment === "floating") return "floating";
  return densityFromWidth(width);
}

export function defaultSidebarState(): SidebarLayoutState {
  return {
    width: SIDEBAR_SNAPS.normal,
    attachment: "edge",
    restoreWidth: SIDEBAR_SNAPS.normal,
    floatX: FLOAT_DOCK_DEFAULT.x,
    floatY: FLOAT_DOCK_DEFAULT.y,
    floatPinned: false,
  };
}

function clampFloatPos(x: number, y: number) {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(8, window.innerWidth - 72);
  const maxY = Math.max(8, window.innerHeight - 72);
  return {
    x: Math.min(maxX, Math.max(8, Math.round(x))),
    y: Math.min(maxY, Math.max(8, Math.round(y))),
  };
}

export function readSidebarLayoutState(storageKey: string): SidebarLayoutState {
  if (typeof window === "undefined") return defaultSidebarState();
  const base = defaultSidebarState();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      const legacyKeys = [
        storageKey,
        storageKey.replace("-v3", "-v2"),
        storageKey.includes("admin") ? "jbt.admin-sidebar-layout" : "jbt.sidebar-layout",
      ];
      for (const key of legacyKeys) {
        const legacy = localStorage.getItem(key);
        if (!legacy) continue;
        if (legacy === "mini") {
          return { ...base, width: SIDEBAR_SNAPS.mini };
        }
        if (legacy === "docked") {
          return { ...base, width: SIDEBAR_SNAPS.docked, restoreWidth: SIDEBAR_SNAPS.docked };
        }
        if (legacy === "floating") {
          return { ...base, attachment: "floating" };
        }
        if (legacy === "fixed") {
          // Fixed merged into Edge — same docked rail behavior.
          return { ...base, attachment: "edge" };
        }
        try {
          const parsed = JSON.parse(legacy) as Partial<SidebarLayoutState>;
          if (parsed && typeof parsed === "object") {
            return normalizeState(parsed, base);
          }
        } catch {
          /* continue */
        }
      }
      return base;
    }
    return normalizeState(JSON.parse(raw) as Partial<SidebarLayoutState>, base);
  } catch {
    return base;
  }
}

function normalizeState(
  parsed: Partial<SidebarLayoutState>,
  base: SidebarLayoutState,
): SidebarLayoutState {
  const width = clampSidebarWidth(Number(parsed.width) || base.width);
  const attachment: SidebarAttachment =
    parsed.attachment === "floating" ? "floating" : "edge";
  const restoreWidth = clampSidebarWidth(
    Number(parsed.restoreWidth) || Math.max(width, SIDEBAR_SNAPS.docked),
  );
  const pos = clampFloatPos(
    Number(parsed.floatX) || base.floatX,
    Number(parsed.floatY) || base.floatY,
  );
  return {
    width,
    attachment,
    restoreWidth,
    floatX: pos.x,
    floatY: pos.y,
    floatPinned: Boolean(parsed.floatPinned),
  };
}

export function writeSidebarLayoutState(storageKey: string, state: SidebarLayoutState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clampFloatPosition(x: number, y: number) {
  return clampFloatPos(x, y);
}
