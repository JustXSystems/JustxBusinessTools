"use client";

import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const QUERIES: Array<{ bp: Breakpoint; query: string }> = [
  { bp: "desktop", query: "(min-width: 1024px)" },
  { bp: "tablet", query: "(min-width: 768px)" },
  { bp: "mobile", query: "(max-width: 767px)" },
];

function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(min-width: 1024px)").matches) return "desktop";
  if (window.matchMedia("(min-width: 768px)").matches) return "tablet";
  return "mobile";
}

export function useResponsive(): {
  breakpoint: Breakpoint;
  isMobile: boolean;
  isDesktop: boolean;
} {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const mediaLists = QUERIES.map(({ bp, query }) => ({
      bp,
      mql: window.matchMedia(query),
    }));

    const update = () => setBreakpoint(getBreakpoint());

    for (const { mql } of mediaLists) {
      mql.addEventListener("change", update);
    }
    update();

    return () => {
      for (const { mql } of mediaLists) {
        mql.removeEventListener("change", update);
      }
    };
  }, []);

  return {
    breakpoint,
    isMobile: breakpoint === "mobile",
    isDesktop: breakpoint === "desktop",
  };
}
