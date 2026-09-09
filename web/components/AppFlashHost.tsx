"use client";

import { useEffect, useState } from "react";
import {
  dismissAppFlash,
  subscribeAppFlash,
  type AppFlashItem,
} from "@/lib/app-flash";

/**
 * Fixed, high-visibility flash stack for the whole app.
 * Duration is configurable on Business Profile; Close dismisses early.
 */
export function AppFlashHost() {
  const [items, setItems] = useState<AppFlashItem[]>([]);

  useEffect(() => subscribeAppFlash(setItems), []);

  if (!items.length) return null;

  return (
    <div className="app-flash-host no-print" aria-live="assertive" aria-relevant="additions">
      {items.map((item) => (
        <div
          key={item.id}
          className={`app-flash app-flash-${item.kind}`}
          role={item.kind === "ok" ? "status" : "alert"}
        >
          <div className="app-flash-body">
            <span className="app-flash-label">
              {item.kind === "ok" ? "OK" : item.kind === "warn" ? "Warning" : "Error"}
            </span>
            <p className="app-flash-msg">{item.message}</p>
          </div>
          <button
            type="button"
            className="app-flash-dismiss"
            aria-label="Close message"
            title="Close"
            onClick={() => dismissAppFlash(item.id)}
          >
            <span aria-hidden="true">✕</span>
            <span className="app-flash-dismiss-text">Close</span>
          </button>
        </div>
      ))}
    </div>
  );
}
