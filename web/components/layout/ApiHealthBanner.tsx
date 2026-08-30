"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-base";

export function ApiHealthBanner() {
  const [status, setStatus] = useState<"ok" | "down" | "checking">("checking");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(apiUrl("/api/health"), { credentials: "include" });
        if (!cancelled) setStatus(res.ok ? "ok" : "down");
      } catch {
        if (!cancelled) setStatus("down");
      }
    }

    check();
    const id = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (status !== "down") return null;

  return (
    <div className="error-banner api-health-banner no-print" role="alert">
      Storage unavailable — API not reachable. Data will not save until the server and database are
      running. Try <code>npm run db:up</code>, <code>npm run db:setup</code>, then{" "}
      <code>npm run dev</code>.
    </div>
  );
}
