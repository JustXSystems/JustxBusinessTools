"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BosIcon } from "../icons";
import { BosPortal } from "../theme-context";
import { cx } from "../cx";
import { revealBlock } from "../scroll";
import { useOverlayFocus } from "./useOverlayFocus";

export type BosCommand = {
  id: string;
  label: string;
  section: string;
  icon?: ReactNode;
  hint?: string;
  /** Extra search terms. */
  keywords?: string;
  onSelect: () => void;
};

export type BosCommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: BosCommand[];
  placeholder?: string;
  contained?: boolean;
};

function matches(cmd: BosCommand, q: string): boolean {
  if (!q) return true;
  const hay = `${cmd.label} ${cmd.section} ${cmd.keywords ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/** ⌘K palette: type to filter, ↑/↓ to move, Enter to run, Esc to close. */
export function CommandPalette({ open, onClose, commands, placeholder = "Type a command or search…", contained }: BosCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setQuery("");
    setActive(0);
    onClose();
  };
  useOverlayFocus(open, panel, close, input);

  const filtered = useMemo(() => commands.filter((c) => matches(c, query.trim())), [commands, query]);
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    revealBlock(listRef.current, listRef.current?.querySelector(`[data-index="${activeIndex}"]`));
  }, [open, activeIndex]);

  const run = (cmd: BosCommand) => {
    close();
    cmd.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + delta + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      run(filtered[activeIndex]);
    }
  };

  const overlay = (
    <div
      className={cx("bos-overlay", "is-top", contained && "is-contained", open && "is-open")}
      inert={!open}
      aria-hidden={!open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={panel} className="bos-cmdk" role="dialog" aria-modal={contained ? undefined : true} aria-label="Command palette">
        <div className="bos-cmdk-input-row">
          <BosIcon name="search" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open}
            aria-controls="bos-cmdk-list"
            aria-activedescendant={activeIndex >= 0 ? `bos-cmdk-${filtered[activeIndex].id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="bos-kbd">Esc</kbd>
        </div>
        <div className="bos-cmdk-list" id="bos-cmdk-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? <div className="bos-cmdk-empty">No results for “{query}”</div> : null}
          {filtered.map((cmd, i) => {
            const header = i === 0 || filtered[i - 1].section !== cmd.section ? cmd.section : null;
            return (
              <Fragment key={cmd.id}>
                {header ? (
                  <div className="bos-cmdk-section" role="presentation">
                    {header}
                  </div>
                ) : null}
                <button
                  type="button"
                  id={`bos-cmdk-${cmd.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === activeIndex}
                  tabIndex={-1}
                  className={cx("bos-cmdk-item", i === activeIndex && "is-active")}
                  onMouseMove={() => i !== activeIndex && setActive(i)}
                  onClick={() => run(cmd)}
                >
                  <span className="bos-cmdk-item-icon" aria-hidden="true">
                    {cmd.icon ?? "›"}
                  </span>
                  <span className="bos-cmdk-item-label">{cmd.label}</span>
                  {cmd.hint ? <span className="bos-cmdk-item-hint">{cmd.hint}</span> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );

  return contained ? overlay : <BosPortal>{overlay}</BosPortal>;
}

/** Binds ⌘K / Ctrl+K to `onTrigger` while mounted. */
export function useCommandHotkey(onTrigger: () => void) {
  const ref = useRef(onTrigger);
  useEffect(() => {
    ref.current = onTrigger;
  }, [onTrigger]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
