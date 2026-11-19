"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Field, Input, Select, Switch, Textarea } from "@/components/bos";

type FieldShell = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  full?: boolean;
  fieldClassName?: string;
};

/** BOS Field + Input in one call (admin forms). */
export function TextField({
  label,
  hint,
  error,
  full,
  fieldClassName,
  ...input
}: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "id">) {
  return (
    <Field label={label} hint={hint} error={error} full={full} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...input} />
      )}
    </Field>
  );
}

/** BOS Field + Select in one call. */
export function SelectField({
  label,
  hint,
  error,
  full,
  fieldClassName,
  children,
  ...select
}: FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "id">) {
  return (
    <Field label={label} hint={hint} error={error} full={full} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <Select id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...select}>
          {children}
        </Select>
      )}
    </Field>
  );
}

/** BOS Field + Textarea in one call. */
export function TextareaField({
  label,
  hint,
  error,
  full,
  fieldClassName,
  ...area
}: FieldShell & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  return (
    <Field label={label} hint={hint} error={error} full={full} className={fieldClassName}>
      {({ id, describedBy, invalid }) => (
        <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...area} />
      )}
    </Field>
  );
}

/** BOS Field + Switch in one call (boolean settings). */
export function SwitchField({
  label,
  hint,
  error,
  full,
  fieldClassName,
  checked,
  onChange,
  disabled,
}: FieldShell & { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} full={full} className={fieldClassName}>
      {({ id }) => <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />}
    </Field>
  );
}
