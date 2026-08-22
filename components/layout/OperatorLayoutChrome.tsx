"use client";

import type { ReactNode } from "react";
import { useSidebarLayout } from "@/components/layout/SidebarLayoutProvider";

/** Applies live sidebar width + mode to the operator grid shell. */
export function OperatorLayoutChrome({ children }: { children: ReactNode }) {
  const { mode, width, dragging } = useSidebarLayout();

  return (
    <div
      className="operator-layout"
      data-sidebar-mode={mode}
      data-sidebar-dragging={dragging ? "1" : "0"}
      style={{ ["--sidebar-rail" as string]: `${width}px` }}
    >
      {children}
    </div>
  );
}
