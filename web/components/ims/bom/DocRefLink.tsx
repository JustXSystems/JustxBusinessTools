"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ImsModuleKey } from "@/lib/ims/api";
import { useIms } from "../core";

type Props = {
  module: ImsModuleKey;
  intent?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** When false, render plain text (no navigation). */
  enabled?: boolean;
};

/**
 * Corporate document-number chip: click jumps via IMS deep-link intent.
 * Use for BOM / DC / RTN / invoice numbers anywhere in the flow.
 */
export function DocRefLink({ module, intent, children, className, style, title, enabled = true }: Props) {
  const { navigate } = useIms();
  if (!enabled || !intent) {
    return (
      <span className={className} style={style} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`ims-doc-ref${className ? ` ${className}` : ""}`}
      style={style}
      title={title ?? "Open"}
      onClick={(e) => {
        e.stopPropagation();
        navigate(module, intent);
      }}
    >
      {children}
    </button>
  );
}
