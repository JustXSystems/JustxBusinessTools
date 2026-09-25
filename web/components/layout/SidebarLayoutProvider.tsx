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
import {
  clampFloatPosition,
  clampSidebarWidth,
  densityFromWidth,
  matchesCompactLandscape,
  COMPACT_LANDSCAPE_MQ,
  defaultSidebarState,
  readSidebarLayoutState,
  resolveLayoutMode,
  snapSidebarWidth,
  writeSidebarLayoutState,
  SIDEBAR_SNAPS,
  type SidebarAttachment,
  type SidebarDensity,
  type SidebarLayoutMode,
  type SidebarLayoutState,
} from "@/lib/sidebar-layout";

type SidebarLayoutContextValue = {
  width: number;
  attachment: SidebarAttachment;
  density: SidebarDensity;
  mode: SidebarLayoutMode;
  dragging: boolean;
  previewLabel: string | null;
  floatX: number;
  floatY: number;
  floatPinned: boolean;
  floatOpen: boolean;
  /** Short-height landscape: dock lays out horizontally; edge sidebar is suppressed. */
  floatHorizontal: boolean;
  setAttachment: (attachment: SidebarAttachment) => void;
  setFloatPinned: (pinned: boolean) => void;
  setFloatOpen: (open: boolean) => void;
  beginResize: (clientX: number) => void;
  updateResize: (clientX: number) => void;
  endResize: () => void;
  beginFloatDrag: (clientX: number, clientY: number) => void;
  updateFloatDrag: (clientX: number, clientY: number) => void;
  endFloatDrag: () => void;
  toggleMini: () => void;
  stepSnap: (direction: -1 | 1) => void;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

const PHONE_PORTRAIT_MQ = "(max-width: 768px) and (orientation: portrait)";

function labelFor(width: number, attachment: SidebarAttachment) {
  const mode = resolveLayoutMode(width, attachment);
  if (mode === "mini") return "Mini";
  if (mode === "docked") return "Docked";
  if (mode === "floating") return "Float";
  return "Normal";
}

export function SidebarLayoutProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<SidebarLayoutState>(defaultSidebarState);
  const [dragging, setDragging] = useState(false);
  const [floatDragging, setFloatDragging] = useState(false);
  const [floatHoverOpen, setFloatHoverOpen] = useState(false);
  const [floatHorizontal, setFloatHorizontal] = useState(false);
  const [phoneNarrow, setPhoneNarrow] = useState(false);
  const [dragOriginX, setDragOriginX] = useState(0);
  const [dragOriginWidth, setDragOriginWidth] = useState<number>(SIDEBAR_SNAPS.normal);
  const [floatOrigin, setFloatOrigin] = useState({ x: 0, y: 0, px: 0, py: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readSidebarLayoutState(storageKey);
    setState(next);
    setFloatHoverOpen(next.floatPinned);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(COMPACT_LANDSCAPE_MQ);
    let wasCompact = mq.matches;
    setFloatHorizontal(wasCompact);

    const apply = () => {
      const compact = mq.matches;
      setFloatHorizontal(compact);
      if (compact && !wasCompact) {
        // Entering compact landscape: open dock and park it near the top edge.
        setFloatHoverOpen(true);
        setState((prev) => {
          const pos = clampFloatPosition(prev.floatX, Math.min(prev.floatY, 12));
          if (pos.x === prev.floatX && pos.y === prev.floatY) return prev;
          return { ...prev, floatX: pos.x, floatY: pos.y };
        });
      }
      wasCompact = compact;
    };

    // Initial mount in landscape should also open the horizontal dock.
    if (wasCompact) {
      setFloatHoverOpen(true);
      setState((prev) => {
        const pos = clampFloatPosition(prev.floatX, Math.min(prev.floatY, 12));
        if (pos.x === prev.floatX && pos.y === prev.floatY) return prev;
        return { ...prev, floatX: pos.x, floatY: pos.y };
      });
    }

    // No window "resize" listener: mobile browsers fire it continuously while the
    // URL bar collapses during scroll, and the media query already reports changes.
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(PHONE_PORTRAIT_MQ);
    const apply = () => setPhoneNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const setAttachment = useCallback(
    (attachment: SidebarAttachment) => {
      // Compact landscape keeps a horizontal float dock; ignore edge switch.
      if (attachment === "edge" && matchesCompactLandscape()) return;
      setState((prev) => {
        const next = {
          ...prev,
          attachment,
          floatPinned: attachment === "floating" ? prev.floatPinned : false,
        };
        writeSidebarLayoutState(storageKey, next);
        return next;
      });
      if (attachment !== "floating") setFloatHoverOpen(false);
    },
    [storageKey],
  );

  const setFloatPinned = useCallback(
    (pinned: boolean) => {
      setState((prev) => {
        const next = { ...prev, floatPinned: pinned, attachment: "floating" as const };
        writeSidebarLayoutState(storageKey, next);
        return next;
      });
      if (pinned) setFloatHoverOpen(true);
    },
    [storageKey],
  );

  const setFloatOpen = useCallback(
    (open: boolean) => {
      setFloatHoverOpen((prev) => {
        if (state.floatPinned) return true;
        return open;
      });
    },
    [state.floatPinned],
  );

  const beginResize = useCallback(
    (clientX: number) => {
      setDragging(true);
      setDragOriginX(clientX);
      setDragOriginWidth(state.width);
    },
    [state.width],
  );

  const updateResize = useCallback(
    (clientX: number) => {
      const nextWidth = clampSidebarWidth(dragOriginWidth + (clientX - dragOriginX));
      setState((prev) => ({
        ...prev,
        width: nextWidth,
        restoreWidth:
          densityFromWidth(nextWidth) === "mini"
            ? prev.restoreWidth
            : Math.max(nextWidth, SIDEBAR_SNAPS.docked),
      }));
    },
    [dragOriginWidth, dragOriginX],
  );

  const endResize = useCallback(() => {
    setDragging(false);
    setState((prev) => {
      const snapped = snapSidebarWidth(prev.width);
      const next: SidebarLayoutState = {
        ...prev,
        width: snapped,
        restoreWidth:
          densityFromWidth(snapped) === "mini"
            ? prev.restoreWidth || SIDEBAR_SNAPS.normal
            : Math.max(snapped, SIDEBAR_SNAPS.docked),
      };
      writeSidebarLayoutState(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const beginFloatDrag = useCallback(
    (clientX: number, clientY: number) => {
      setFloatDragging(true);
      setFloatOrigin({
        x: clientX,
        y: clientY,
        px: state.floatX,
        py: state.floatY,
      });
    },
    [state.floatX, state.floatY],
  );

  const updateFloatDrag = useCallback(
    (clientX: number, clientY: number) => {
      const pos = clampFloatPosition(
        floatOrigin.px + (clientX - floatOrigin.x),
        floatOrigin.py + (clientY - floatOrigin.y),
      );
      setState((prev) => ({ ...prev, floatX: pos.x, floatY: pos.y }));
    },
    [floatOrigin],
  );

  const endFloatDrag = useCallback(() => {
    setFloatDragging(false);
    setState((prev) => {
      writeSidebarLayoutState(storageKey, prev);
      return prev;
    });
  }, [storageKey]);

  const toggleMini = useCallback(() => {
    setState((prev) => {
      const isMini = densityFromWidth(prev.width) === "mini";
      const next: SidebarLayoutState = isMini
        ? {
            ...prev,
            width: clampSidebarWidth(prev.restoreWidth || SIDEBAR_SNAPS.normal),
          }
        : {
            ...prev,
            restoreWidth: prev.width,
            width: SIDEBAR_SNAPS.mini,
          };
      writeSidebarLayoutState(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const stepSnap = useCallback(
    (direction: -1 | 1) => {
      const snaps = [SIDEBAR_SNAPS.mini, SIDEBAR_SNAPS.docked, SIDEBAR_SNAPS.normal];
      setState((prev) => {
        const current = snapSidebarWidth(prev.width);
        let idx = snaps.findIndex((s) => s === current);
        if (idx < 0) {
          idx =
            densityFromWidth(prev.width) === "mini"
              ? 0
              : densityFromWidth(prev.width) === "docked"
                ? 1
                : 2;
        }
        const nextIdx = Math.min(snaps.length - 1, Math.max(0, idx + direction));
        const width = snaps[nextIdx];
        const next: SidebarLayoutState = {
          ...prev,
          width,
          restoreWidth: width === SIDEBAR_SNAPS.mini ? prev.restoreWidth : width,
        };
        writeSidebarLayoutState(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  // Portrait phone: the saved desktop rail width (e.g. Mini) would hide nav labels
  // in the stacked phone header, so always lay out at the normal width there.
  const effectiveWidth = phoneNarrow ? SIDEBAR_SNAPS.normal : state.width;
  const density = densityFromWidth(effectiveWidth);
  // Landscape phone: force floating so the horizontal dock can reclaim width.
  const effectiveAttachment: SidebarAttachment = floatHorizontal
    ? "floating"
    : state.attachment;
  const mode = resolveLayoutMode(effectiveWidth, effectiveAttachment);
  const previewLabel = dragging ? labelFor(state.width, effectiveAttachment) : null;
  const floatOpen = state.floatPinned || floatHoverOpen;

  const value = useMemo(
    () => ({
      width: effectiveWidth,
      attachment: effectiveAttachment,
      density,
      mode,
      dragging: dragging || floatDragging,
      previewLabel,
      floatX: state.floatX,
      floatY: state.floatY,
      floatPinned: state.floatPinned,
      floatOpen,
      floatHorizontal,
      setAttachment,
      setFloatPinned,
      setFloatOpen,
      beginResize,
      updateResize,
      endResize,
      beginFloatDrag,
      updateFloatDrag,
      endFloatDrag,
      toggleMini,
      stepSnap,
    }),
    [
      effectiveWidth,
      effectiveAttachment,
      state.floatX,
      state.floatY,
      state.floatPinned,
      density,
      mode,
      dragging,
      floatDragging,
      previewLabel,
      floatOpen,
      floatHorizontal,
      setAttachment,
      setFloatPinned,
      setFloatOpen,
      beginResize,
      updateResize,
      endResize,
      beginFloatDrag,
      updateFloatDrag,
      endFloatDrag,
      toggleMini,
      stepSnap,
    ],
  );

  return (
    <SidebarLayoutContext.Provider value={value}>
      <div
        className="sidebar-layout-root"
        data-sidebar-ready={ready ? "1" : "0"}
        data-sidebar-dragging={dragging || floatDragging ? "1" : "0"}
      >
        {children}
      </div>
    </SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout() {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
  return ctx;
}
