"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "ims.bom.split.composePct";
const DEFAULT_COMPOSE_PCT = 50;
const MIN_COMPOSE_PCT = 28;
const MAX_COMPOSE_PCT = 72;

function clampPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_COMPOSE_PCT;
  return Math.min(MAX_COMPOSE_PCT, Math.max(MIN_COMPOSE_PCT, Math.round(n)));
}

function readStoredPct(): number {
  try {
    if (typeof window === "undefined") return DEFAULT_COMPOSE_PCT;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return DEFAULT_COMPOSE_PCT;
    return clampPct(raw);
  } catch {
    return DEFAULT_COMPOSE_PCT;
  }
}

function writeStoredPct(pct: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampPct(pct)));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Compose + PDF preview split. Default 50/50; drag the rail to resize (persisted). */
export function BomSplitLayout({
  compose,
  preview,
  confirm = false,
}: {
  compose: ReactNode;
  preview: ReactNode;
  confirm?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [composePct, setComposePct] = useState(DEFAULT_COMPOSE_PCT);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(false);

  useEffect(() => {
    setComposePct(readStoredPct());
  }, []);

  const applyClientX = useCallback((clientX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width < 80) return;
    const next = clampPct(((clientX - rect.left) / rect.width) * 100);
    setComposePct(next);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      applyClientX(e.clientX);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = false;
      setDragging(false);
      document.body.classList.remove("is-bom-resizing");
      setComposePct((pct) => {
        writeStoredPct(pct);
        return pct;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, applyClientX]);

  const previewPct = 100 - composePct;

  return (
    <div
      ref={rootRef}
      className={`ims-bom-layout${confirm ? " ims-bom-layout--confirm" : ""}${dragging ? " is-resizing" : ""}`}
      style={{ ["--ims-bom-compose-pct" as string]: `${composePct}%` }}
    >
      <div className="ims-bom-compose">{compose}</div>
      <div
        className={`ims-bom-split-handle${dragging ? " is-active" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize compose and preview panels"
        aria-valuemin={MIN_COMPOSE_PCT}
        aria-valuemax={MAX_COMPOSE_PCT}
        aria-valuenow={composePct}
        aria-valuetext={`Compose ${composePct}%, preview ${previewPct}%`}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          dragRef.current = true;
          setDragging(true);
          document.body.classList.add("is-bom-resizing");
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          applyClientX(e.clientX);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          setComposePct(DEFAULT_COMPOSE_PCT);
          writeStoredPct(DEFAULT_COMPOSE_PCT);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setComposePct((p) => {
              const next = clampPct(p - 2);
              writeStoredPct(next);
              return next;
            });
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setComposePct((p) => {
              const next = clampPct(p + 2);
              writeStoredPct(next);
              return next;
            });
          } else if (e.key === "Home" || e.key === "Enter") {
            e.preventDefault();
            setComposePct(DEFAULT_COMPOSE_PCT);
            writeStoredPct(DEFAULT_COMPOSE_PCT);
          }
        }}
      >
        <span className="ims-bom-split-grip" aria-hidden="true" />
      </div>
      <div className="ims-bom-preview-wrap">{preview}</div>
    </div>
  );
}
