"use client";

import { useState, type ReactNode } from "react";
import { Badge, Button, Dialog, Field, Textarea } from "@/components/bos";
import type { PartyKind } from "@/lib/ims/api";
import { stampLabel } from "@/lib/ims/format";
import { PARTY_KIND_TAG, poBadge, purchase, type PoStatus } from "@/lib/ims/purchase";
import { Loaded, StatusBadge, useImsData } from "../core";

export function KindBadge({ kind }: { kind: PartyKind }) {
  const t = PARTY_KIND_TAG[kind] ?? PARTY_KIND_TAG.customer;
  return <Badge tag={t.tag}>{t.text}</Badge>;
}

export function PoStatusBadge({ status }: { status: PoStatus }) {
  return <StatusBadge view={poBadge(status)} />;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/** Asks for a reason (reject, hold, cancel). `minLength` 0 makes it optional. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label = "Reason",
  placeholder,
  confirmLabel,
  destructive,
  busy,
  minLength = 3,
  suggestions,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  minLength?: number;
  suggestions?: ReadonlyArray<string>;
  onConfirm: (reason: string) => void;
}) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const short = text.trim().length < minLength;
  const close = () => {
    setText("");
    setTouched(false);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (short) return;
              onConfirm(text.trim());
              setText("");
              setTouched(false);
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {suggestions?.length ? (
        <div className="ims-quickadd" style={{ marginBottom: 10 }} role="group" aria-label="Common reasons">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <Field label={minLength > 0 ? `${label} *` : `${label} (optional)`} error={touched && short ? (minLength > 0 ? `Please write at least ${minLength} characters` : undefined) : undefined}>
        {({ id, describedBy, invalid }) => (
          <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} maxLength={500} />
        )}
      </Field>
    </Dialog>
  );
}

const TONE_FOR = (type: string): string => {
  if (/approved|received|created|restored|sent/.test(type)) return "is-good";
  if (/rejected|cancelled|deleted|archived|held|hold/.test(type)) return "is-bad";
  if (/submitted|approval_requested|updated/.test(type)) return "is-warn";
  return "";
};

/** Activity history for one record (from the IMS event log). */
export function Timeline({ entityType, entityId, empty = "No activity yet." }: { entityType: string; entityId: string; empty?: string }) {
  const state = useImsData(() => purchase.events(entityType, entityId).then((r) => r.events), [entityType, entityId]);
  return (
    <Loaded state={state} rows={1}>
      {(events) =>
        events.length ? (
          <ol className="ims-timeline" aria-label="Activity">
            {events.map((e) => (
              <li key={e.id} className={TONE_FOR(e.type)}>
                {e.summary}
                <small>
                  {e.actorName ?? "System"} · {stampLabel(e.createdAt)}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ims-faint">{empty}</p>
        )
      }
    </Loaded>
  );
}

export function KeyValues({ rows }: { rows: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="ims-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MiniStats({ stats }: { stats: ReadonlyArray<{ label: string; value: ReactNode; tone?: "coral" | "amber" | "emerald" }> }) {
  return (
    <div className="ims-stat-row">
      {stats.map((s) => (
        <div key={s.label} className="ims-stat">
          <b style={s.tone ? { color: `var(--bos-${s.tone}-600, var(--bos-${s.tone}))` } : undefined}>{s.value}</b>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
