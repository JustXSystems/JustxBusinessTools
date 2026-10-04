"use client";

import {
  forwardRef,
  useId,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { BosIcon } from "../icons";
import { cx } from "../cx";

export type BosFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Span the full row inside a `FormGrid`. */
  full?: boolean;
  className?: string;
  /** Receives the generated control id + described-by id. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
};

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, full, className, children }: BosFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = Boolean(error || hint);
  return (
    <div className={cx("bos-field", full && "bos-form-grid-full", className)}>
      <label className="bos-field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: hasNote ? noteId : undefined, invalid: Boolean(error) })}
      {error ? (
        <div className="bos-field-error" id={noteId}>
          {error}
        </div>
      ) : hint ? (
        <div className="bos-field-hint" id={noteId}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function FormGrid({
  children,
  columns,
  className,
}: {
  children: ReactNode;
  /** CSS grid-template-columns override (default two columns, max 640px). */
  columns?: string;
  className?: string;
}) {
  return (
    <div className={cx("bos-form-grid", columns && "bos-form-grid-custom", className)} style={columns ? ({ "--bos-form-cols": columns } as CSSProperties) : undefined}>
      {children}
    </div>
  );
}

type InputSize = { size?: "md" | "sm" };

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & InputSize>(
  function Input({ className, size = "md", ...rest }, ref) {
    return <input ref={ref} className={cx("bos-input", size === "sm" && "bos-input-sm", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & InputSize>(
  function Select({ className, size = "md", ...rest }, ref) {
    return <select ref={ref} className={cx("bos-input", size === "sm" && "bos-input-sm", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx("bos-input", className)} {...rest} />;
  },
);

/** Pill search with leading glyph and optional ⌘K hint. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { shortcut?: string; wrapperClassName?: string }
>(function SearchInput({ shortcut, wrapperClassName, className, ...rest }, ref) {
  return (
    <label className={cx("bos-search", wrapperClassName)}>
      <BosIcon name="search" />
      <input ref={ref} type="search" className={className} {...rest} />
      {shortcut ? <kbd className="bos-kbd">{shortcut}</kbd> : null}
    </label>
  );
});

export type BosToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
};

export function Switch({ checked, onChange, disabled, id, ...aria }: BosToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      className="bos-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  id,
  ...aria
}: BosToggleProps & { indeterminate?: boolean }) {
  const state = indeterminate ? "mixed" : checked;
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      className="bos-checkbox"
      onClick={() => onChange(!checked)}
    >
      {indeterminate ? <span aria-hidden="true">–</span> : checked ? <BosIcon name="check" weight={3} /> : null}
    </button>
  );
}
