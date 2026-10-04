"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BosTone } from "../tokens";
import { BosIcon, type BosIconName } from "../icons";
import { BosPortal } from "../theme-context";
import { cx } from "../cx";

export type BosToastInput = {
  tone?: BosTone;
  title: ReactNode;
  description?: ReactNode;
  /** Milliseconds before auto-dismiss; 0 keeps it until clicked. */
  duration?: number;
};

type ToastItem = BosToastInput & { id: number; shown: boolean };

type ToastApi = { show: (toast: BosToastInput) => void };

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<BosTone, BosIconName> = {
  emerald: "check",
  amber: "warning",
  coral: "alert",
  blue: "sparkle",
};

const EXIT_MS = 220;

/** Fire-and-forget confirmations. Use for outcomes, not for errors that need action. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <BosRoot>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<number>());

  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setItems((list) => list.map((t) => (t.id === id ? { ...t, shown: false } : t)));
      later(() => setItems((list) => list.filter((t) => t.id !== id)), EXIT_MS);
    },
    [later],
  );

  const show = useCallback(
    (toast: BosToastInput) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { ...toast, id, shown: false }]);
      later(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, shown: true } : t))), 16);
      const duration = toast.duration ?? 3200;
      if (duration > 0) later(() => dismiss(id), duration);
    },
    [dismiss, later],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {items.length > 0 ? (
        <BosPortal>
          <div className="bos-toast-stack" role="region" aria-label="Notifications" aria-live="polite">
            {items.map((t) => {
              const tone = t.tone ?? "blue";
              return (
                <div key={t.id} className={cx("bos-toast", t.shown && "is-shown")} role="status" onClick={() => dismiss(t.id)}>
                  <div className={cx("bos-toast-icon", `bos-tint-${tone}`)} aria-hidden="true">
                    <BosIcon name={TONE_ICON[tone]} />
                  </div>
                  <div>
                    <div className="bos-toast-title">{t.title}</div>
                    {t.description ? <div className="bos-toast-desc">{t.description}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </BosPortal>
      ) : null}
    </ToastContext.Provider>
  );
}
