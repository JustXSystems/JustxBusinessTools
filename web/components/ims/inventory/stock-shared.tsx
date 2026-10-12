"use client";

import "./inventory-b.css";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Badge, FilterChip } from "@/components/bos";
import { ims, type ImsMovement, type ImsModuleKey } from "@/lib/ims/api";
import { isRestore, RESTORE_REASON } from "@/lib/ims/inventory-b";
import { movementBadge, num, round3, type BadgeView } from "@/lib/ims/format";
import { useImsData } from "../core";

export function useInventoryMeta() {
  return useImsData(() => ims.inventoryMeta(), []);
}

/** A value that settles `ms` after the last change (search boxes that hit the API). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Badge for a ledger row; the saleable half of a quarantine restore reads as "Restored". */
export function movementView(m: Pick<ImsMovement, "type" | "reason" | "refType">): BadgeView {
  if (isRestore(m)) return { text: "RESTORED", tone: "emerald" };
  if (m.type === "RETURN_OUT" && m.refType === "manual" && m.reason === RESTORE_REASON) return { text: "OUT OF QUARANTINE", tone: "neutral" };
  return movementBadge(m.type);
}

export function MovementBadge({ m }: { m: Pick<ImsMovement, "type" | "reason" | "refType"> }) {
  const v = movementView(m);
  return <Badge tone={v.tone}>{v.text}</Badge>;
}

/** Where an activity-log entity opens. */
export const ENTITY_MODULE: Record<string, ImsModuleKey> = {
  item: "items",
  check: "checks",
  return: "returns",
  po: "purchase",
  invoice: "sales",
  bill: "payables",
  party: "parties",
  payment: "receivables",
  closing: "closing",
};

/** − / input / + quantity control; the input keeps the raw text so decimals can be typed. */
export function QtyStepper({
  value,
  onChange,
  label,
  min = 0,
  step = 1,
  invalid,
  id,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** null = no lower bound (signed corrections). */
  min?: number | null;
  step?: number;
  invalid?: boolean;
  id?: string;
  onEnter?: () => void;
}) {
  const n = num(value, 0);
  const bump = (d: number) => {
    const next = round3(n + d);
    onChange(String(min === null ? next : Math.max(min, next)));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      bump(step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      bump(-step);
    } else if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <span className="ims-b-stepper">
      <button type="button" aria-label={`Decrease ${label}`} disabled={min !== null && n <= min} onClick={() => bump(-step)}>
        −
      </button>
      <input
        id={id}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ""))}
        onKeyDown={onKey}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => bump(step)}>
        +
      </button>
    </span>
  );
}

/** Single-choice reason pills. */
export function ReasonChips({ options, value, onChange, label }: { options: ReadonlyArray<string>; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="ims-b-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <FilterChip key={o} active={o === value} onClick={() => onChange(o)}>
          {o}
        </FilterChip>
      ))}
    </div>
  );
}

export const isOther = (reason: string): boolean => /^other\b/i.test(reason.trim());
