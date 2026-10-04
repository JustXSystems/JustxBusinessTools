"use client";

import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { cx } from "../cx";
import { BosIcon } from "../icons";

export type BosKanbanCard = {
  id: string;
  title: ReactNode;
  /** One tag — never more (design rule). */
  tag?: ReactNode;
  /** Avatar cluster. */
  people?: ReactNode;
  due?: ReactNode;
};

export type BosKanbanColumn = {
  id: string;
  title: ReactNode;
  /** Status-light colour for the header dot (CSS colour). */
  dot?: string;
  /** Big highlighted count (pipeline summaries) instead of the small pill. */
  highlightCount?: { value: ReactNode; color: string };
  cards: BosKanbanCard[];
};

export type BosKanbanProps = {
  columns: BosKanbanColumn[];
  /** Enables drag & drop (plus a "Move to…" picker on touch screens); receives the card, source and target column ids. */
  onMove?: (cardId: string, fromColumnId: string, toColumnId: string) => void;
  "aria-label"?: string;
};

/** Calm board: one tag, one due date, one avatar cluster per card. */
export function Kanban({ columns, onMove, ...aria }: BosKanbanProps) {
  const [dragging, setDragging] = useState<{ card: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const onDrop = (e: DragEvent, to: string) => {
    e.preventDefault();
    if (dragging && onMove && dragging.from !== to) onMove(dragging.card, dragging.from, to);
    setDragging(null);
    setOver(null);
  };

  return (
    <div
      className="bos-kanban"
      style={{ "--bos-kanban-cols": columns.length } as CSSProperties}
      role="list"
      aria-label={aria["aria-label"] ?? "Board"}
    >
      {columns.map((col) => (
        <div
          key={col.id}
          role="listitem"
          className={cx("bos-kanban-col", over === col.id && dragging?.from !== col.id && "is-drop-target")}
          onDragOver={
            onMove
              ? (e) => {
                  e.preventDefault();
                  if (over !== col.id) setOver(col.id);
                }
              : undefined
          }
          onDragLeave={onMove ? () => setOver((cur) => (cur === col.id ? null : cur)) : undefined}
          onDrop={onMove ? (e) => onDrop(e, col.id) : undefined}
        >
          <div className="bos-kanban-head">
            <div className="bos-kanban-title">
              {col.dot ? <span className="bos-light" style={{ background: col.dot }} aria-hidden="true" /> : null}
              {col.title}
            </div>
            {col.highlightCount ? (
              <div className="bos-kanban-count bos-kanban-count-hl" style={{ color: col.highlightCount.color }}>
                {col.highlightCount.value}
              </div>
            ) : (
              <div className="bos-kanban-count">{col.cards.length}</div>
            )}
          </div>
          {col.cards.map((card) => (
            <article
              key={card.id}
              className={cx("bos-kanban-card", dragging?.card === card.id && "is-dragging")}
              draggable={Boolean(onMove)}
              onDragStart={
                onMove
                  ? (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", card.id);
                      setDragging({ card: card.id, from: col.id });
                    }
                  : undefined
              }
              onDragEnd={
                onMove
                  ? () => {
                      setDragging(null);
                      setOver(null);
                    }
                  : undefined
              }
              style={onMove ? undefined : { cursor: "default" }}
            >
              <div className="bos-kanban-card-title">{card.title}</div>
              {card.tag}
              {card.people || card.due ? (
                <div className="bos-kanban-card-foot">
                  <div>{card.people}</div>
                  {card.due ? <div className="bos-kanban-due">{card.due}</div> : null}
                </div>
              ) : null}
              {onMove && columns.length > 1 ? (
                <label className="bos-kanban-move">
                  <BosIcon name="chevronRight" />
                  Move to…
                  <select
                    aria-label={`Move ${typeof card.title === "string" ? card.title : "card"} to`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onMove(card.id, col.id, e.target.value);
                    }}
                  >
                    <option value="" disabled>
                      Move to…
                    </option>
                    {columns
                      .filter((c) => c.id !== col.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {typeof c.title === "string" ? c.title : c.id}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
