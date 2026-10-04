"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import type { BosTone } from "../tokens";
import { BosIcon, type BosIconName } from "../icons";
import { BosPortal } from "../theme-context";
import { cx } from "../cx";
import { useOverlayFocus } from "./useOverlayFocus";

export type BosDialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Tinted icon disc above the title. */
  icon?: { tone: BosTone; name?: BosIconName; glyph?: ReactNode };
  /** Action buttons, right-aligned. */
  actions?: ReactNode;
  /** Small left-aligned note in the action row. */
  actionsNote?: ReactNode;
  wide?: boolean;
  /** Render inside the nearest positioned ancestor instead of the viewport (demo frames). */
  contained?: boolean;
  /** Close when the scrim is clicked (default true). */
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
};

/**
 * Confirmation / reading dialog. Always mounted so open/close animate; while
 * closed the subtree is `inert` and invisible to assistive tech.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  actions,
  actionsNote,
  wide,
  contained,
  dismissible = true,
  initialFocus,
  children,
}: BosDialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useOverlayFocus(open, panel, onClose, initialFocus);

  const overlay = (
    <div
      className={cx("bos-overlay", contained && "is-contained", open && "is-open")}
      inert={!open}
      aria-hidden={!open}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={cx("bos-dialog", wide && "bos-dialog-wide")}
        role="dialog"
        aria-modal={contained ? undefined : true}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        {icon ? (
          <div className={cx("bos-dialog-icon", `bos-tint-${icon.tone}`)} aria-hidden="true">
            {icon.glyph ?? <BosIcon name={icon.name ?? "alert"} />}
          </div>
        ) : null}
        <div className="bos-dialog-title" id={titleId}>
          {title}
        </div>
        {description ? (
          <div className="bos-dialog-desc" id={descId}>
            {description}
          </div>
        ) : null}
        {children}
        {actions ? (
          <div className="bos-dialog-actions">
            {actionsNote ? <span className="bos-dialog-actions-note">{actionsNote}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );

  return contained ? overlay : <BosPortal>{overlay}</BosPortal>;
}
