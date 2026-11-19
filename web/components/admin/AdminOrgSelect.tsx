"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SelectField } from "@/components/admin/ui/AdminFields";

export type AdminOrgOption = { id: number; name: string };

/** Explicit organization picker for Admin Console (never uses operator session org). */
export function AdminOrgSelect({
  value,
  onChange,
  required = true,
  label = "Organization",
  allowEmpty = true,
  emptyLabel = "Select organization…",
  full,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  required?: boolean;
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Span the full row inside a BOS `FormGrid`. */
  full?: boolean;
}) {
  const [orgs, setOrgs] = useState<AdminOrgOption[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ organizations: AdminOrgOption[] }>("/admin/organizations")
      .then((data) => {
        if (!alive) return;
        setOrgs(data.organizations);
        setError("");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setOrgs([]);
        setError(err instanceof Error ? err.message : "Failed to load organizations");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SelectField
      label={label}
      full={full}
      error={error || undefined}
      value={value ?? ""}
      required={required}
      onChange={(e) => {
        const v = Number(e.target.value);
        onChange(Number.isInteger(v) && v > 0 ? v : null);
      }}
    >
      {allowEmpty ? (
        <option value="">{orgs.length === 0 ? "No organizations" : emptyLabel}</option>
      ) : null}
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </SelectField>
  );
}
