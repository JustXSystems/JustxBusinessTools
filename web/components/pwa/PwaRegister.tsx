"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const swUrl = withBasePath("/sw.js");
    const root = withBasePath("/");
    const scope = root.endsWith("/") ? root : `${root}/`;
    navigator.serviceWorker.register(swUrl, { scope }).catch(() => {
      /* SW optional — ignore registration errors in dev */
    });
  }, []);

  return null;
}
