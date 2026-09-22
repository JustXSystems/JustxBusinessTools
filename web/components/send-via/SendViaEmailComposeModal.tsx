"use client";

import { useEffect, useState } from "react";
import type { OutboundEmailFormatId } from "@/lib/outbound-email";

export type SendViaEmailComposeModalProps = {
  formatId: OutboundEmailFormatId;
  deliveryHint?: string;
  attachmentNote?: string;
  to: string;
  onToChange: (value: string) => void;
  cc: string;
  onCcChange: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  replyTo: string;
  onReplyToChange: (value: string) => void;
  messageTemplate: string;
  onMessageTemplateChange: (value: string) => void;
  previewText: string;
  previewHtml: string | null;
  busy?: boolean;
  onClose: () => void;
  onSend: () => void;
};

type ComposePane = "preview" | "template";

export function SendViaEmailComposeModal({
  formatId,
  deliveryHint,
  attachmentNote,
  to,
  onToChange,
  cc,
  onCcChange,
  subject,
  onSubjectChange,
  replyTo,
  onReplyToChange,
  messageTemplate,
  onMessageTemplateChange,
  previewText,
  previewHtml,
  busy,
  onClose,
  onSend,
}: SendViaEmailComposeModalProps) {
  const [pane, setPane] = useState<ComposePane>("preview");
  const [showCc, setShowCc] = useState(() => Boolean(cc.trim()));
  const [showReplyTo, setShowReplyTo] = useState(() => Boolean(replyTo.trim()));

  useEffect(() => {
    if (cc.trim()) setShowCc(true);
  }, [cc]);

  useEffect(() => {
    if (replyTo.trim()) setShowReplyTo(true);
  }, [replyTo]);

  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const formatLabel = formatId === "corporate" ? "Corporate HTML" : "Plain text";
  const formatLabelShort = formatId === "corporate" ? "HTML" : "Plain";
  const previewTabLabel = compact ? "Preview" : "Reading pane";
  const templateTabLabel = compact ? "Template" : "Edit template";

  return (
    <div
      className="modal-overlay email-compose-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="email-compose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-compose-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="email-compose-toolbar">
          <div className="email-compose-toolbar-primary">
            <button
              type="button"
              className="btn btn-primary btn-sm email-compose-send"
              disabled={busy}
              onClick={() => onSend()}
            >
              {busy ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={onClose}
            >
              Discard
            </button>
          </div>
          <div className="email-compose-toolbar-meta">
            <span className={`email-compose-format is-${formatId}`}>
              {compact ? formatLabelShort : formatLabel}
            </span>
            {attachmentNote ? (
              <span className="email-compose-attach" title={attachmentNote}>
                📎 <span className="email-compose-attach-text">{attachmentNote}</span>
              </span>
            ) : null}
          </div>
        </header>

        {deliveryHint ? <p className="email-compose-hint">{deliveryHint}</p> : null}

        <div className="email-compose-headers">
          <div className="email-compose-row">
            <label className="email-compose-label" htmlFor="email-compose-to">
              To
            </label>
            <input
              id="email-compose-to"
              className="email-compose-input"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              value={to}
              autoComplete="email"
              onChange={(e) => onToChange(e.target.value)}
            />
          </div>

          {showCc ? (
            <div className="email-compose-row">
              <label className="email-compose-label" htmlFor="email-compose-cc">
                Cc
              </label>
              <input
                id="email-compose-cc"
                className="email-compose-input"
                type="text"
                inputMode="email"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="email"
                value={cc}
                placeholder="comma-separated"
                onChange={(e) => onCcChange(e.target.value)}
              />
            </div>
          ) : null}

          {showReplyTo ? (
            <div className="email-compose-row">
              <label className="email-compose-label" htmlFor="email-compose-reply">
                Reply-To
              </label>
              <input
                id="email-compose-reply"
                className="email-compose-input"
                type="email"
                inputMode="email"
                autoCapitalize="off"
                autoCorrect="off"
                value={replyTo}
                onChange={(e) => onReplyToChange(e.target.value)}
              />
            </div>
          ) : null}

          <div className="email-compose-row email-compose-row-subject">
            <label className="email-compose-label" htmlFor="email-compose-subject">
              Subject
            </label>
            <input
              id="email-compose-subject"
              className="email-compose-input email-compose-subject-input"
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
            />
          </div>

          <div className="email-compose-row-actions">
            {!showCc ? (
              <button type="button" className="email-compose-link" onClick={() => setShowCc(true)}>
                Cc
              </button>
            ) : null}
            {!showReplyTo ? (
              <button
                type="button"
                className="email-compose-link"
                onClick={() => setShowReplyTo(true)}
              >
                Reply-To
              </button>
            ) : null}
          </div>
        </div>

        <div className="email-compose-main">
          <div className="email-compose-pane-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={pane === "preview"}
              className={pane === "preview" ? "active" : undefined}
              onClick={() => setPane("preview")}
            >
              {previewTabLabel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === "template"}
              className={pane === "template" ? "active" : undefined}
              onClick={() => setPane("template")}
            >
              {templateTabLabel}
            </button>
          </div>

          <div className="email-compose-pane-body">
            {pane === "preview" ? (
              previewHtml ? (
                <iframe
                  title="Email preview — matches sent body"
                  className="email-compose-preview-frame"
                  sandbox=""
                  srcDoc={previewHtml}
                />
              ) : (
                <pre className="email-compose-preview-text">{previewText}</pre>
              )
            ) : (
              <textarea
                className="email-compose-template mono"
                value={messageTemplate}
                spellCheck={false}
                onChange={(e) => onMessageTemplateChange(e.target.value)}
                aria-label="Message template"
              />
            )}
          </div>
        </div>

        <footer className="email-compose-footer">
          <span id="email-compose-title" className="email-compose-footer-note">
            Preview matches the body sent via webhook or Email Outbox.
          </span>
        </footer>
      </div>
    </div>
  );
}
