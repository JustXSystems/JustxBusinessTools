"use client";

import "./system.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, Textarea, cx } from "@/components/bos";
import { stampLabel, timeAgo } from "@/lib/ims/format";
import type { ThreadEntry } from "@/lib/ims/system";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ToolHead({ glyph, title, sub, aside }: { glyph: ReactNode; title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="ims-between" style={{ alignItems: "flex-start" }}>
      <div className="ims-sys-head">
        <span className="ims-sys-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="ims-sys-head-text">
          <b>{title}</b>
          {sub ? <small>{sub}</small> : null}
        </span>
      </div>
      {aside}
    </div>
  );
}

export function KeyValues({ rows }: { rows: ReadonlyArray<[ReactNode, ReactNode]> }) {
  return (
    <dl className="ims-sys-kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Thread({ entries, meId, empty = "No messages yet." }: { entries: ReadonlyArray<ThreadEntry>; meId: number | null; empty?: ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);
  if (!entries.length) return <p className="ims-muted" style={{ fontSize: 13, margin: 0 }}>{empty}</p>;
  return (
    <div className="ims-sys-thread" role="log" aria-label="Conversation">
      {entries.map((e) =>
        e.role === "system" ? (
          <div key={e.id} className="ims-sys-msg is-system">
            {e.author} · {e.text} · {timeAgo(e.at)}
          </div>
        ) : (
          <div key={e.id} className={cx("ims-sys-msg", meId !== null && e.authorId === meId && "is-mine")}>
            <span className="ims-sys-msg-meta" title={stampLabel(e.at)}>
              {e.author}
              {e.role ? ` · ${e.role}` : ""} · {timeAgo(e.at)}
            </span>
            {e.text}
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

export function ReplyBox({ onSend, busy, placeholder = "Write a reply…", disabled, label = "Reply" }: { onSend: (text: string) => Promise<boolean>; busy?: boolean; placeholder?: string; disabled?: boolean; label?: string }) {
  const [text, setText] = useState("");
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (await onSend(t)) setText("");
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Textarea
        rows={3}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="ims-between">
        <span className="ims-sys-mini">Ctrl + Enter to send</span>
        <Button size="sm" variant="primary" disabled={disabled || busy || !text.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : label}
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={{ tone: destructive ? "coral" : "blue", name: destructive ? "warning" : "check" }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "primary"} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
