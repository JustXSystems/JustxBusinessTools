"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BosIcon, type BosIconName } from "../icons";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";
import { cx } from "../cx";

/* ---------- Action ticker ---------- */

export type BosTickerItem = {
  text: string;
  time: string;
  /** Tint suffix: blue | emerald | amber | coral | pastel-blue | lavender … */
  tint: string;
  icon: BosIconName;
};

const FADE_MS = 220;

/**
 * One-line rotating activity feed. Pauses on hover/focus; dots jump directly.
 */
export function ActionTicker({ items, intervalMs = 3200 }: { items: BosTickerItem[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const fadeTimer = useRef<number | undefined>(undefined);

  const goTo = (next: number) => {
    window.clearTimeout(fadeTimer.current);
    setFading(true);
    fadeTimer.current = window.setTimeout(() => {
      setIndex(next);
      setFading(false);
    }, FADE_MS);
  };

  const advanceRef = useRef(() => {});
  useEffect(() => {
    advanceRef.current = () => goTo((index + 1) % items.length);
  });

  useEffect(() => {
    if (paused || items.length < 2) return;
    const id = window.setInterval(() => advanceRef.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [paused, items.length, intervalMs]);

  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);

  if (items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)];

  return (
    <div
      className="bos-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-live="polite"
    >
      <div className={cx("bos-ticker-icon", `bos-tint-${item.tint}`)} aria-hidden="true">
        <BosIcon name={item.icon} weight={2.5} />
      </div>
      <div className={cx("bos-ticker-text", fading && "is-fading")}>{item.text}</div>
      <div className="bos-ticker-time" style={{ transition: `opacity ${FADE_MS}ms`, opacity: fading ? 0 : 1 }}>
        {item.time}
      </div>
      <div className="bos-ticker-dots">
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            className={cx("bos-ticker-dot", i === index && "is-active")}
            aria-label={`Show: ${it.text}`}
            aria-pressed={i === index}
            onClick={() => i !== index && goTo(i)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Celebrations strip ---------- */

export type BosCelebration = {
  initials: string;
  name: string;
  tag: string;
  /** Pastel avatar fill + ink. */
  avatar: { fill: string; ink: string };
  /** Tag tint suffix (coral birthday, amber anniversary). */
  tint: string;
};

export function Celebrations({ items, label = "🎉 Celebrations" }: { items: BosCelebration[]; label?: ReactNode }) {
  return (
    <div className="bos-celebrations" role="list" aria-label="Celebrations">
      <span className="bos-celebrations-label">{label}</span>
      {items.map((c) => (
        <div key={c.name} className="bos-row" style={{ gap: 10, flexShrink: 0 }} role="listitem">
          <span className="bos-celeb-sep" aria-hidden="true" />
          <div className="bos-celeb">
            <span className="bos-avatar bos-avatar-xs" style={{ background: c.avatar.fill, color: c.avatar.ink }} aria-hidden="true">
              {c.initials}
            </span>
            <span className="bos-celeb-name">{c.name}</span>
            <span className={cx("bos-celeb-tag", `bos-tint-${c.tint}`)}>{c.tag}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Approval row ---------- */

export type BosApprovalDecision = "approved" | "rejected";

/**
 * Pending request with Approve / Reject. Once decided the buttons collapse to a
 * status badge and the row fades to 60%.
 */
export function ApprovalRow({
  avatar,
  name,
  meta,
  decision,
  onDecide,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  extra,
}: {
  avatar?: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  decision?: BosApprovalDecision | null;
  onDecide?: (decision: BosApprovalDecision) => void;
  approveLabel?: string;
  rejectLabel?: string;
  /** Extra trailing content shown before the actions (badges, amounts). */
  extra?: ReactNode;
}) {
  return (
    <div className={cx("bos-approval", decision && "is-decided")}>
      <div className="bos-approval-main">
        {avatar}
        <div style={{ minWidth: 0 }}>
          <div className="bos-approval-name">{name}</div>
          {meta ? <div className="bos-approval-meta">{meta}</div> : null}
        </div>
      </div>
      <div className="bos-approval-actions">
        {extra}
        {decision ? (
          <Badge tone={decision === "approved" ? "emerald" : "coral"}>{decision === "approved" ? "APPROVED" : "REJECTED"}</Badge>
        ) : onDecide ? (
          <>
            <Button size="sm" variant="destructive" onClick={() => onDecide("rejected")}>
              {rejectLabel}
            </Button>
            <Button size="sm" variant="primary" onClick={() => onDecide("approved")}>
              {approveLabel}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Balance chips ---------- */

export function BalanceRow({
  items,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; unit?: ReactNode; tone?: string }>;
}) {
  return (
    <div className="bos-balance-row">
      {items.map((b, i) => (
        <div key={i} className="bos-balance">
          <div className="bos-balance-label">{b.label}</div>
          <div className="bos-balance-value" style={b.tone ? { color: b.tone } : undefined}>
            {b.value} {b.unit ? <span className="bos-balance-unit">{b.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
