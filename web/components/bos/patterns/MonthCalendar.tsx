"use client";

import { useMemo, type ReactNode } from "react";
import { BOS_WEEKDAYS_MON_FIRST, buildMonthGrid, monthLabel, shiftMonth } from "@/lib/bos/calendar";
import { IconButton } from "../primitives/Button";
import { cx } from "../cx";

export type BosCalendarEvent = {
  /** `YYYY-MM-DD` */
  date: string;
  label: string;
  /** Tint class suffix, e.g. "blue" | "emerald" | "rose" | "pastel-blue". */
  tint: string;
};

export type BosMonthCalendarProps = {
  year: number;
  /** 0-based month. */
  month: number;
  events?: BosCalendarEvent[];
  today?: Date;
  /** Navigation; omit to hide the arrows. */
  onNavigate?: (next: { year: number; month: number }) => void;
  title?: ReactNode;
};

/** Monday-first month grid with tinted event pills (dots on small screens). */
export function MonthCalendar({ year, month, events = [], today, onNavigate, title }: BosMonthCalendarProps) {
  const cells = useMemo(() => buildMonthGrid(year, month, today), [year, month, today]);
  const byDay = useMemo(() => {
    const map = new Map<string, BosCalendarEvent[]>();
    for (const ev of events) map.set(ev.date, [...(map.get(ev.date) ?? []), ev]);
    return map;
  }, [events]);

  return (
    <div className="bos-cal">
      <div className="bos-cal-head">
        <div className="bos-cal-title">{title ?? monthLabel(year, month)}</div>
        {onNavigate ? (
          <div className="bos-cal-nav">
            <IconButton icon="chevronLeft" aria-label="Previous month" onClick={() => onNavigate(shiftMonth(year, month, -1))} />
            <IconButton icon="chevronRight" aria-label="Next month" onClick={() => onNavigate(shiftMonth(year, month, 1))} />
          </div>
        ) : null}
      </div>
      <div className="bos-cal-grid" role="grid" aria-label={monthLabel(year, month)}>
        {BOS_WEEKDAYS_MON_FIRST.map((d) => (
          <div key={d} className="bos-cal-dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const dayEvents = cell.inMonth ? byDay.get(cell.key) ?? [] : [];
          return (
            <div
              key={cell.key}
              role="gridcell"
              className={cx("bos-cal-cell", !cell.inMonth && "is-muted", cell.isToday && "is-today", dayEvents.length > 0 && "has-events")}
              aria-label={dayEvents.length ? `${cell.day}: ${dayEvents.map((e) => e.label).join(", ")}` : undefined}
            >
              <div className="bos-cal-date">{cell.day}</div>
              {dayEvents.map((ev, i) => (
                <div key={i} className={cx("bos-cal-event", `bos-tint-${ev.tint}`)} title={ev.label}>
                  {ev.label}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
