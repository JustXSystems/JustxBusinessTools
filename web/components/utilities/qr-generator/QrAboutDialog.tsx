"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { QrGeneratorConfig } from "@/lib/qr-generator/config";
import { QR_TYPES } from "@/lib/qr-generator/payloads";

export function QrAboutHeart({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="qrg-heart" onClick={onClick} aria-label="About this tool" title="About this tool">
      <svg viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id="qrg-heart-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--accent-strong, var(--accent))" }} />
          </linearGradient>
        </defs>
        <path
          fill="url(#qrg-heart-grad)"
          d="M12 21s-7.2-4.4-9.6-9C.8 8.9 2.6 5 6.3 5c2.1 0 3.4 1.2 4.2 2.4h3c.8-1.2 2.1-2.4 4.2-2.4 3.7 0 5.5 3.9 3.9 7-2.4 4.6-9.6 9-9.6 9z"
          transform="translate(0 -0.5)"
        />
      </svg>
    </button>
  );
}

function Benefit({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <li className="qrg-about-card">
      <span className="qrg-about-card-icon" aria-hidden>
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}

const FORMAT_LABEL: Record<string, string> = { png: "PNG", svg: "SVG", pdf: "PDF" };

export function QrAboutDialog({ cfg, onClose }: { cfg: QrGeneratorConfig; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const F = cfg.features;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const types = QR_TYPES.filter((t) => cfg.enabledTypes.includes(t.id));
  const groups = [...new Set(types.map((t) => t.group))];
  const fileFormats = cfg.exports.formats.filter((f) => f in FORMAT_LABEL).map((f) => FORMAT_LABEL[f]);
  const maxSize = Math.max(...cfg.exports.sizes);
  const batchOutputs = [
    cfg.exports.formats.includes("png") ? "a ZIP of PNG images" : "",
    cfg.exports.formats.includes("svg") ? "a ZIP of SVG files" : "",
    cfg.exports.formats.includes("pdf") ? "an A4 label sheet (PDF, 12 per page)" : "",
  ].filter(Boolean);
  const hasType = (id: string) => cfg.enabledTypes.some((t) => t === id);

  return createPortal(
    <div
      className="qrg-about-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="qrg-about" role="dialog" aria-modal="true" aria-labelledby="qrg-about-title">
        <header className="qrg-about-head">
          <div>
            <p className="qrg-about-eyebrow">About this tool</p>
            <h2 id="qrg-about-title">{cfg.title}</h2>
            <p className="qrg-about-lede">Branded QR codes, checked on this device before you download them.</p>
          </div>
          <button ref={closeRef} type="button" className="qrg-about-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="qrg-about-body">
          <ul className="qrg-about-stats">
            <li>
              <b>{types.length}</b>
              <span>QR types</span>
            </li>
            <li>
              <b>H</b>
              <span>Error correction with a logo</span>
            </li>
            {fileFormats.length ? (
              <li>
                <b>{fileFormats.join(" · ")}</b>
                <span>Export formats</span>
              </li>
            ) : null}
            {cfg.exports.formats.includes("png") ? (
              <li>
                <b>{maxSize}px</b>
                <span>Largest image</span>
              </li>
            ) : null}
          </ul>

          <h3>What it makes</h3>
          <div className="qrg-about-groups">
            {groups.map((g) => (
              <div key={g} className="qrg-about-group">
                <span className="qrg-about-group-name">{g}</span>
                <div className="qrg-about-chips">
                  {types
                    .filter((t) => t.group === g)
                    .map((t) => (
                      <span key={t.id} className="qrg-about-chip">
                        <span aria-hidden>{t.icon}</span> {t.label}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <h3>Why teams use it</h3>
          <ul className="qrg-about-cards">
            {F.verifyScan ? (
              <Benefit icon="✓" title="Scan-checked">
                Every design is decoded on this device and marked &ldquo;Scan verified&rdquo; before you download it.
              </Benefit>
            ) : null}
            <Benefit icon="🎨" title={cfg.brand.lockDesign ? "Brand style locked" : "On-brand design"}>
              {cfg.brand.lockDesign
                ? "Your administrator has set the colours, shapes and logo, so every code from your organisation looks the same."
                : "Colours, rounded or dotted modules, corner styles, a centre logo and a caption under the code."}
            </Benefit>
            <Benefit icon="♾" title="Never expires">
              These are static QR codes: the content is stored inside the code itself, with no redirect link that can
              stop working.
            </Benefit>
            <Benefit icon="🔒" title="Made on this device">
              The QR image is created in your browser. What you type isn&apos;t sent to any server to make the code —
              only the QR type, export format and count are recorded for your organisation&apos;s usage reports.
            </Benefit>
            {F.batch && batchOutputs.length ? (
              <Benefit icon="⚡" title="Bulk generation">
                Paste rows from Excel or upload a CSV (up to {F.batchMaxRows} rows) and download {batchOutputs.join(" or ")}.
              </Benefit>
            ) : null}
            {cfg.exports.formats.includes("svg") || cfg.exports.formats.includes("pdf") ? (
              <Benefit icon="🖨" title="Print-ready">
                {[
                  cfg.exports.formats.includes("svg") ? "SVG is vector, so it stays sharp at any size." : "",
                  cfg.exports.formats.includes("pdf")
                    ? "The PDF poster places a high-resolution code with its caption on an A4 page."
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Benefit>
            ) : null}
            {F.utm.enabled && hasType("url") ? (
              <Benefit icon="📈" title="Campaign tracking">
                Optional UTM tags on website links, so visits from your QR codes show up in Google Analytics.
              </Benefit>
            ) : null}
            {F.fillFromProfile ? (
              <Benefit icon="🏢" title="Fill from Business Profile">
                One tap fills in details like phone, email, address, UPI ID and bank details from your Business Profile.
              </Benefit>
            ) : null}
            {F.history ? (
              <Benefit icon="🕘" title="Recent codes">
                Reopen recently exported codes in one tap. They stay on this device, and Wi-Fi passwords are never saved.
              </Benefit>
            ) : null}
          </ul>

          <h3>Good to know</h3>
          <ul className="qrg-about-notes">
            <li>Static codes can&apos;t be edited after printing — to change the content, make and print a new code.</li>
            <li>
              This tool doesn&apos;t count scans.
              {F.utm.enabled && hasType("url") ? " Use UTM tags to measure website visits in Google Analytics." : ""}
            </li>
            {hasType("bank") ? (
              <li>
                Bank-transfer codes show the details as text; banking apps can&apos;t auto-fill them. Use a UPI code for
                one-tap payments.
              </li>
            ) : null}
            {hasType("app") ? <li>An app-download code opens one store — make one per store.</li> : null}
            <li>Test-scan with two different phones before a large print run.</li>
          </ul>
        </div>

        <footer className="qrg-about-foot">
          <span>Settings are managed by your organisation&apos;s administrator.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Got it
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
