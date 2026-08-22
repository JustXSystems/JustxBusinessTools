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

function labelFor(width: number, attachment: SidebarAttachment) {
  const mode = resolveLayoutMode(width, attachment);
  if (mode === "mini") return "Mini";
  if (mode === "docked") return "Docked";
  if (mode === "floating") return "Float";
  if (mode === "fixed") return "Fixed";
  return "Normal";
}

export function SidebarLayoutProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<SidebarLayoutState>(() => ({
    width: SIDEBAR_SNAPS.normal,
    attachment: "edge",
    restoreWidth: SIDEBAR_SNAPS.normal,
    floatX: 18,
    floatY: 96,
    floatPinned: false,
  }));
  const [dragging, setDragging] = useState(false);
  const [floatDragging, setFloatDragging] = useState(false);
  const [floatHoverOpen, setFloatHoverOpen] = useState(false);
  const [dragOriginX, setDragOriginX] = useState(0);
  const [dragOriginWidth, setDragOriginWidth] = useState(SIDEBAR_SNAPS.normal);
  const [floatOrigin, setFloatOrigin] = useState({ x: 0, y: 0, px: 0, py: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readSidebarLayoutState(storageKey);
    setState(next);
    setFloatHoverOpen(next.floatPinned);
    setReady(true);
  }, [storageKey]);

  const setAttachment = useCallback(
    (attachment: SidebarAttachment) => {
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

  const density = densityFromWidth(state.width);
  const mode = resolveLayoutMode(state.width, state.attachment);
  const previewLabel = dragging ? labelFor(state.width, state.attachment) : null;
  const floatOpen = state.floatPinned || floatHoverOpen;

  const value = useMemo(
    () => ({
      width: state.width,
      attachment: state.attachment,
      density,
      mode,
      dragging: dragging || floatDragging,
      previewLabel,
      floatX: state.floatX,
      floatY: state.floatY,
      floatPinned: state.floatPinned,
      floatOpen,
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
      state.width,
      state.attachment,
      state.floatX,
      state.floatY,
      state.floatPinned,
      density,
      mode,
      dragging,
      floatDragging,
      previewLabel,
      floatOpen,
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
