"use client";

import { Fragment, type ReactNode } from "react";
import { dateLabel, inrExact, qtyText, rupeesInWords } from "@/lib/ims/format";
import {
  bomCostComposition,
  groupBomSections,
  lineAmount,
  lineIdentityBits,
  lineKindCode,
  lineKindLabel,
  type BomPaperLine,
  type BomPaperSection,
} from "@/lib/ims/bom-paper";
import { PaperBrandHead, sellerDetailInline } from "../shared/DocumentPaper";
import type { BomPaperModel } from "./BomPaper";

const BOM_STAMP: Partial<Record<string, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8A8FA3" },
  cancelled: { text: "CANCELLED", color: "#8A8FA3" },
};

function stampOf(status: string | null | undefined) {
  return BOM_STAMP[(status || "").toLowerCase()] ?? null;
}

/** Customer-facing document title — never the template name/type. */
function bomDocTitle(model: BomPaperModel): string {
  const status = (model.status || "").toLowerCase();
  if (status === "draft") return "DRAFT PROPOSAL";
  if (status === "cancelled") return "CANCELLED PROPOSAL";
  return "MATERIALS PROPOSAL";
}

function PaperShell({
  model,
  tpl,
  children,
  hideDefaultTop,
}: {
  model: BomPaperModel;
  tpl: string;
  hideDefaultTop?: boolean;
  children: ReactNode;
}) {
  const b = model.business;
  const stamp = stampOf(model.status);
  const title = bomDocTitle(model);
  return (
    <article
      className={`bos-inv-paper ims-bom-sheet ims-bom-sheet--${tpl}`}
      data-bom-tpl={tpl}
      aria-label="Bill of materials"
      style={{ position: "static" }}
    >
      {!hideDefaultTop ? (
        <div className="bos-inv-paper-top ims-bom-sheet-top">
          <PaperBrandHead
            name={b.name || "Your business"}
            logoUrl={b.logoUrl}
            detail={sellerDetailInline({ address: b.address, state: b.state, gstin: b.gstin, phone: b.phone, email: b.email })}
          />
          <div className="ims-bom-sheet-titleblock">
            <div className="bos-inv-paper-title">{title}</div>
            {stamp ? (
              <span className="ims-paper-stamp" style={{ color: stamp.color }}>
                {stamp.text}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </article>
  );
}

function DocMeta({ model, extra }: { model: BomPaperModel; extra?: ReadonlyArray<{ label: string; value: string }> }) {
  const meta: Array<{ label: string; value: string }> = [
    { label: "Doc", value: model.docNo || "Draft" },
    { label: "Rev", value: `R${Number(model.revision ?? 1)}` },
    { label: "Date", value: model.docDate ? dateLabel(model.docDate) : "—" },
  ];
  if (model.validUntil) meta.push({ label: "Valid", value: dateLabel(model.validUntil) });
  if (model.capacityLabel) meta.push({ label: "Capacity", value: model.capacityLabel });
  if (model.title) meta.push({ label: "Title", value: model.title });
  if (model.preparedBy) meta.push({ label: "Prepared", value: model.preparedBy });
  for (const e of extra ?? []) meta.push(e);
  return (
    <div className="ims-paper-meta ims-bom-meta-compact">
      {meta.map((m) => (
        <div key={m.label}>
          <b>{m.label}</b>
          <span>{m.value}</span>
        </div>
      ))}
    </div>
  );
}

function PartyBlock({ model }: { model: BomPaperModel }) {
  const siteLine = [model.location || null, model.projectRef ? `Project ${model.projectRef}` : null].filter(Boolean).join(" · ");
  return (
    <div className="bos-inv-paper-meta ims-bom-party ims-bom-party-compact">
      <div>
        <div className="bos-inv-paper-label">Customer</div>
        <div className="bos-inv-paper-value">
          {model.customerName || "—"}
          {siteLine ? <span className="ims-bom-party-inline"> · {siteLine}</span> : null}
        </div>
      </div>
    </div>
  );
}

function LineDesc({ line, showRemarks = true }: { line: BomPaperLine; showRemarks?: boolean }) {
  const ids = lineIdentityBits(line);
  const tail = [
    ...ids,
    showRemarks && line.remarks ? line.remarks : null,
  ].filter(Boolean);
  return (
    <>
      <span className="ims-bom-line-desc">{line.description}</span>
      {tail.length ? <small className="ims-bom-line-ids"> · {tail.join(" · ")}</small> : null}
    </>
  );
}

function TermsGrid({ model }: { model: BomPaperModel }) {
  const terms: Array<{ label: string; value: string }> = [];
  if (model.validUntil) terms.push({ label: "Validity", value: dateLabel(model.validUntil) });
  if (model.paymentTerms?.trim()) terms.push({ label: "Payment", value: model.paymentTerms.trim() });
  if (model.deliveryTerms?.trim()) terms.push({ label: "Delivery", value: model.deliveryTerms.trim() });
  if (model.warrantyTerms?.trim()) terms.push({ label: "Warranty", value: model.warrantyTerms.trim() });
  if (!terms.length) return null;
  return (
    <div className="ims-bom-terms ims-bom-terms-compact" aria-label="Commercial terms">
      {terms.map((t) => (
        <div key={t.label}>
          <b>{t.label}</b>
          <span>{t.value}</span>
        </div>
      ))}
    </div>
  );
}

function FootMatter({ model, signLeft }: { model: BomPaperModel; signLeft?: string }) {
  return (
    <>
      <TermsGrid model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <SignBlock model={model} left={signLeft} />
    </>
  );
}

function CommercialTotals({ model }: { model: BomPaperModel }) {
  const c = bomCostComposition(model.totals);
  return (
    <>
      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>Materials total</span>
          <span>{inrExact(c.materials)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Margin{model.marginPct ? ` (${model.marginPct}%)` : ""}</span>
          <span>{inrExact(c.margin)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Subtotal</span>
          <span>{inrExact(c.subtotal)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Tax{model.taxPct ? ` (${model.taxPct}%)` : ""}</span>
          <span>{inrExact(c.tax)}</span>
        </div>
        <div className="bos-inv-totals-row is-total">
          <span>Total</span>
          <span>{inrExact(c.grand)}</span>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(c.grand)}</div>
    </>
  );
}

function SignBlock({ model, left = "Customer acceptance" }: { model: BomPaperModel; left?: string }) {
  const b = model.business;
  return (
    <div className="ims-paper-sign">
      <div>
        <div className="ims-paper-sign-line" />
        {left}
      </div>
      <div>
        <div className="ims-paper-sign-line" />
        {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Authorised signatory · ${b.name || "Your business"}`}
      </div>
    </div>
  );
}

function CompositionBars({ sections }: { sections: ReadonlyArray<BomPaperSection> }) {
  if (!sections.length) return null;
  return (
    <div className="ims-bom-compose-bars" aria-label="Section composition">
      {sections.map((sec) => (
        <div key={sec.index} className="ims-bom-compose-row">
          <div className="ims-bom-compose-meta">
            <span>{sec.name}</span>
            <b>
              {sec.sharePct}% · {inrExact(sec.materials)}
            </b>
          </div>
          <div className="ims-bom-compose-track" aria-hidden>
            <i style={{ width: `${Math.min(100, Math.max(2, sec.sharePct))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CostRibbon({ model }: { model: BomPaperModel }) {
  const c = bomCostComposition(model.totals);
  return (
    <div className="ims-bom-cost-ribbon" aria-label="Cost composition">
      <div className="ims-bom-cost-track" aria-hidden>
        <i className="is-mat" style={{ width: `${c.materialsPct}%` }} />
        <i className="is-mar" style={{ width: `${c.marginPctOfGrand}%` }} />
        <i className="is-tax" style={{ width: `${c.taxPctOfGrand}%` }} />
      </div>
      <div className="ims-bom-cost-legend">
        <span>
          Materials <b>{c.materialsPct}%</b>
        </span>
        <span>
          Margin <b>{c.marginPctOfGrand}%</b>
        </span>
        <span>
          Tax <b>{c.taxPctOfGrand}%</b>
        </span>
      </div>
    </div>
  );
}

function EmptyRows({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="bos-inv-paper-empty">
        No items
      </td>
    </tr>
  );
}

/* ---------- Classic ---------- */

export function ClassicBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);

  return (
    <PaperShell model={model} tpl="classic">
      <DocMeta model={model} />
      <PartyBlock model={model} />
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec) => (
              <Fragment key={`sec-${sec.index}-${sec.name}`}>
                {sections.length > 1 ? (
                  <tr className="ims-bom-section">
                    <td colSpan={6}>{sec.name}</td>
                  </tr>
                ) : null}
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      <LineDesc line={l} />
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(lineAmount(l))}</td>
                  </tr>
                ))}
              </Fragment>
            ))
          ) : (
            <EmptyRows cols={6} />
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Tiered ---------- */

export function TieredBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);

  return (
    <PaperShell model={model} tpl="tiered">
      <div className="ims-bom-hero">
        <div>
          <div className="ims-bom-hero-kicker">Package capacity</div>
          <div className="ims-bom-hero-value">{model.capacityLabel || "—"}</div>
          <div className="ims-bom-hero-sub">{model.title || "Bill of materials"}</div>
        </div>
        <div className="ims-bom-hero-aside">
          <div className="ims-bom-hero-kicker">Grand total</div>
          <div className="ims-bom-hero-total">{inrExact(c.grand)}</div>
          <div className="ims-bom-hero-sub">
            {model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}
          </div>
        </div>
      </div>
      <PartyBlock model={model} />
      <CompositionBars sections={sections} />
      {sections.length ? (
        sections.map((sec) => (
          <section key={`tier-${sec.index}`} className="ims-bom-tier">
            <header className="ims-bom-tier-head">
              <div>
                <span className="ims-bom-tier-mark">Tier {sec.roman}</span>
                <h4 className="ims-bom-tier-title">{sec.name}</h4>
              </div>
              <div className="ims-bom-tier-subtotal">{inrExact(sec.materials)}</div>
            </header>
            <table className="bos-inv-paper-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Kind</th>
                  <th>Make</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      <LineDesc line={l} />
                    </td>
                    <td>
                      {lineKindLabel(l.lineKind) ? (
                        <span className={`ims-bom-kind ims-bom-kind--${l.lineKind}`}>{lineKindLabel(l.lineKind)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td>{inrExact(lineAmount(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      ) : (
        <div className="bos-inv-paper-empty">No items</div>
      )}
      <div className="ims-bom-waterfall" aria-label="Cost waterfall">
        <div>
          <span>Materials</span>
          <b>{inrExact(c.materials)}</b>
        </div>
        <div>
          <span>Margin {model.marginPct ? `${model.marginPct}%` : ""}</span>
          <b>{inrExact(c.margin)}</b>
        </div>
        <div>
          <span>Subtotal</span>
          <b>{inrExact(c.subtotal)}</b>
        </div>
        <div>
          <span>Tax {model.taxPct ? `${model.taxPct}%` : ""}</span>
          <b>{inrExact(c.tax)}</b>
        </div>
        <div className="is-total">
          <span>Grand total</span>
          <b>{inrExact(c.grand)}</b>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(c.grand)}</div>
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- EPC ---------- */

export function EpcBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  return (
    <PaperShell model={model} tpl="epc">
      <div className="ims-bom-epc-strip">
        <div>
          <b>Capacity</b>
          {model.capacityLabel || "—"}
        </div>
        <div>
          <b>Document</b>
          {model.docNo || "Draft"}
        </div>
        <div>
          <b>Date</b>
          {model.docDate ? dateLabel(model.docDate) : "—"}
        </div>
        <div>
          <b>Prepared</b>
          {model.preparedBy || "—"}
        </div>
      </div>
      <PartyBlock model={model} />
      <table className="bos-inv-paper-table ims-bom-epc-table">
        <thead>
          <tr>
            <th>Sl.</th>
            <th>Item description</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Units</th>
            <th>Price/unit</th>
            <th>Total</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec) => (
              <Fragment key={`epc-${sec.index}`}>
                <tr className="ims-bom-section ims-bom-section--roman">
                  <td colSpan={8}>
                    {sec.roman}. {sec.name}
                  </td>
                </tr>
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}><LineDesc line={l} /></td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty)}</td>
                    <td>{l.unit || "—"}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(lineAmount(l))}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.remarks || "—"}</td>
                  </tr>
                ))}
                <tr className="ims-bom-epc-sec-total">
                  <td colSpan={6}>Section total — {sec.name}</td>
                  <td colSpan={2}>{inrExact(sec.materials)}</td>
                </tr>
              </Fragment>
            ))
          ) : (
            <EmptyRows cols={8} />
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Executive ---------- */

export function ExecutiveBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  return (
    <PaperShell model={model} tpl="executive">
      <div className="ims-bom-exec-hero">
        <div>
          <div className="ims-bom-hero-kicker">Investment</div>
          <div className="ims-bom-hero-total">{inrExact(c.grand)}</div>
          <div className="ims-bom-hero-sub">{rupeesInWords(c.grand)}</div>
        </div>
        <div className="ims-bom-exec-stats">
          <div>
            <b>Capacity</b>
            <span>{model.capacityLabel || "—"}</span>
          </div>
          <div>
            <b>Materials</b>
            <span>{inrExact(c.materials)}</span>
          </div>
          <div>
            <b>Margin</b>
            <span>
              {inrExact(c.margin)}
              {model.marginPct ? ` · ${model.marginPct}%` : ""}
            </span>
          </div>
          <div>
            <b>Tax</b>
            <span>
              {inrExact(c.tax)}
              {model.taxPct ? ` · ${model.taxPct}%` : ""}
            </span>
          </div>
          <div>
            <b>Subtotal</b>
            <span>{inrExact(c.subtotal)}</span>
          </div>
          <div>
            <b>Document</b>
            <span>
              {model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}
            </span>
          </div>
        </div>
      </div>
      <CostRibbon model={model} />
      <PartyBlock model={model} />
      <div className="ims-bom-exec-sections">
        {sections.length ? (
          sections.map((sec) => (
            <div key={`exec-${sec.index}`} className="ims-bom-exec-sec">
              <div className="ims-bom-exec-sec-head">
                <div>
                  <span className="ims-bom-tier-mark">{sec.roman}</span>
                  <strong>{sec.name}</strong>
                  <span className="ims-bom-exec-count">
                    {sec.lines.length} lines · {sec.sharePct}%
                  </span>
                </div>
                <b>{inrExact(sec.materials)}</b>
              </div>
              <ul className="ims-bom-exec-lines">
                {sec.lines.map((l, i) => (
                  <li key={`${sec.name}-${i}`}>
                    <span>
                      <LineDesc line={l} />
                      {l.makeText ? <small> · {l.makeText}</small> : null}
                    </span>
                    <span>
                      {qtyText(l.qty, l.unit)} · {inrExact(lineAmount(l))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <div className="bos-inv-paper-empty">No items</div>
        )}
      </div>
      <TermsGrid model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <div className="ims-bom-accept">
        <div>
          <div className="ims-paper-sign-line" />
          Accepted by customer
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Authorised · ${model.business.name || "Your business"}`}
        </div>
      </div>
    </PaperShell>
  );
}

/* ---------- Field ---------- */

export function FieldBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  return (
    <PaperShell model={model} tpl="field">
      <div className="ims-bom-field-banner">Materials checklist for site — rates and totals are hidden.</div>
      <DocMeta
        model={model}
        extra={[
          { label: "Customer", value: model.customerName || "—" },
          { label: "Site", value: model.location || "—" },
        ]}
      />
      <table className="bos-inv-paper-table ims-bom-field-table">
        <thead>
          <tr>
            <th className="ims-bom-check-col">✓</th>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec) => (
              <Fragment key={`field-${sec.index}`}>
                <tr className="ims-bom-section">
                  <td colSpan={6}>
                    {sec.roman}. {sec.name}
                  </td>
                </tr>
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td className="ims-bom-check-col">
                      <span className="ims-bom-checkbox" aria-hidden />
                    </td>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      <LineDesc line={l} />
                      {lineKindLabel(l.lineKind) ? <small>{lineKindLabel(l.lineKind)}</small> : null}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.remarks || "—"}</td>
                  </tr>
                ))}
              </Fragment>
            ))
          ) : (
            <EmptyRows cols={6} />
          )}
        </tbody>
      </table>
      <TermsGrid model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <div className="ims-paper-sign">
        <div>
          <div className="ims-paper-sign-line" />
          Received on site
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          Installer / technician
        </div>
      </div>
    </PaperShell>
  );
}

/* ---------- Aurora (futuristic) ---------- */

export function AuroraBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  const b = model.business;
  const stamp = stampOf(model.status);

  return (
    <PaperShell model={model} tpl="aurora" hideDefaultTop>
      <header className="ims-bom-aurora-mast">
        <div className="ims-bom-aurora-brand">
          <PaperBrandHead
            name={b.name || "Your business"}
            logoUrl={b.logoUrl}
            detail={sellerDetailInline({ address: b.address, state: b.state, gstin: b.gstin, phone: b.phone, email: b.email })}
          />
        </div>
        <div className="ims-bom-aurora-signal">
          <div className="ims-bom-aurora-eyebrow">{bomDocTitle(model)}</div>
          <div className="ims-bom-aurora-capacity">{model.capacityLabel || "Package"}</div>
          <div className="ims-bom-aurora-doc">
            {model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}
          </div>
          {stamp ? (
            <span className="ims-paper-stamp" style={{ color: stamp.color }}>
              {stamp.text}
            </span>
          ) : null}
        </div>
      </header>

      <div className="ims-bom-aurora-panels">
        <div className="ims-bom-aurora-panel">
          <b>Customer</b>
          <span>{model.customerName || "—"}</span>
          <small>{model.location || "Site TBD"}</small>
        </div>
        <div className="ims-bom-aurora-panel">
          <b>Project</b>
          <span>{model.title || "Bill of materials"}</span>
          <small>{model.preparedBy ? `Prepared by ${model.preparedBy}` : "Prepared desk"}</small>
        </div>
        <div className="ims-bom-aurora-panel is-total">
          <b>Grand total</b>
          <span>{inrExact(c.grand)}</span>
          <small>{rupeesInWords(c.grand)}</small>
        </div>
      </div>

      <CostRibbon model={model} />
      <CompositionBars sections={sections} />

      {sections.map((sec) => (
        <section key={`aurora-${sec.index}`} className="ims-bom-aurora-sec">
          <header>
            <span>{sec.roman}</span>
            <h4>{sec.name}</h4>
            <em>{sec.sharePct}%</em>
            <strong>{inrExact(sec.materials)}</strong>
          </header>
          <table className="bos-inv-paper-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Component</th>
                <th>Make</th>
                <th>Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sec.lines.map((l, i) => (
                <tr key={`${sec.name}-${i}`}>
                  <td>{i + 1}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <LineDesc line={l} />
                    {lineKindLabel(l.lineKind) ? <small>{lineKindLabel(l.lineKind)}</small> : null}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                  <td>{qtyText(l.qty, l.unit)}</td>
                  <td>{inrExact(lineAmount(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <div className="ims-bom-aurora-foot">
        <div>
          <span>Materials</span>
          <b>{inrExact(c.materials)}</b>
        </div>
        <div>
          <span>Margin {model.marginPct ? `${model.marginPct}%` : ""}</span>
          <b>{inrExact(c.margin)}</b>
        </div>
        <div>
          <span>Tax {model.taxPct ? `${model.taxPct}%` : ""}</span>
          <b>{inrExact(c.tax)}</b>
        </div>
        <div className="is-total">
          <span>Total</span>
          <b>{inrExact(c.grand)}</b>
        </div>
      </div>
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Ledger ---------- */

export function LedgerBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  let row = 0;
  return (
    <PaperShell model={model} tpl="ledger">
      <div className="ims-bom-ledger-meta">
        <div>
          <b>REF</b> {model.docNo || "DRAFT"}
        </div>
        <div>
          <b>DATE</b> {model.docDate ? dateLabel(model.docDate) : "—"}
        </div>
        <div>
          <b>CAP</b> {model.capacityLabel || "—"}
        </div>
        <div>
          <b>CUST</b> {model.customerName || "—"}
        </div>
        <div>
          <b>SITE</b> {model.location || "—"}
        </div>
        <div>
          <b>BY</b> {model.preparedBy || "—"}
        </div>
      </div>
      <table className="bos-inv-paper-table ims-bom-ledger-table">
        <thead>
          <tr>
            <th>IDX</th>
            <th>SEC</th>
            <th>DESCRIPTION</th>
            <th>CODE</th>
            <th>MAKE</th>
            <th>QTY</th>
            <th>UNIT</th>
            <th>RATE</th>
            <th>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.map((sec) =>
              sec.lines.map((l, i) => {
                row += 1;
                return (
                  <tr key={`${sec.name}-${i}`}>
                    <td className="ims-bom-ledger-idx">{String(row).padStart(3, "0")}</td>
                    <td>{sec.roman}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      <LineDesc line={l} />
                      {l.remarks ? <small>{l.remarks}</small> : null}
                    </td>
                    <td>
                      <span className={`ims-bom-kind-code ims-bom-kind--${l.lineKind || "stock"}`}>{lineKindCode(l.lineKind)}</span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty)}</td>
                    <td>{l.unit || "—"}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(lineAmount(l))}</td>
                  </tr>
                );
              }),
            )
          ) : (
            <EmptyRows cols={9} />
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      <FootMatter model={model} signLeft="Verified" />
    </PaperShell>
  );
}

/* ---------- Atelier ---------- */

export function AtelierBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  return (
    <PaperShell model={model} tpl="atelier">
      <div className="ims-bom-atelier-display">
        <p className="ims-bom-atelier-eyebrow">{bomDocTitle(model)}</p>
        <h2>{model.title || "Materials schedule"}</h2>
        <p className="ims-bom-atelier-lede">
          {model.capacityLabel ? `${model.capacityLabel} · ` : ""}
          {model.customerName || "Customer"}
          {model.location ? ` · ${model.location}` : ""}
        </p>
      </div>
      <div className="ims-bom-atelier-facts">
        <div>
          <b>Document</b>
          {model.docNo || "Draft"}
        </div>
        <div>
          <b>Date</b>
          {model.docDate ? dateLabel(model.docDate) : "—"}
        </div>
        <div>
          <b>Prepared</b>
          {model.preparedBy || "—"}
        </div>
        <div>
          <b>Total</b>
          {inrExact(c.grand)}
        </div>
      </div>
      {sections.map((sec) => (
        <section key={`atelier-${sec.index}`} className="ims-bom-atelier-chapter">
          <header>
            <span>Chapter {sec.roman}</span>
            <h3>{sec.name}</h3>
            <strong>{inrExact(sec.materials)}</strong>
          </header>
          <table className="bos-inv-paper-table">
            <thead>
              <tr>
                <th></th>
                <th>Item</th>
                <th>Make</th>
                <th>Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sec.lines.map((l, i) => (
                <tr key={`${sec.name}-${i}`}>
                  <td>{String(i + 1).padStart(2, "0")}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <LineDesc line={l} />
                    {l.remarks ? <small>{l.remarks}</small> : null}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                  <td>{qtyText(l.qty, l.unit)}</td>
                  <td>{inrExact(lineAmount(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <div className="ims-bom-atelier-totals">
        <div>
          <span>Materials</span>
          <b>{inrExact(c.materials)}</b>
        </div>
        <div>
          <span>Margin{model.marginPct ? ` ${model.marginPct}%` : ""}</span>
          <b>{inrExact(c.margin)}</b>
        </div>
        <div>
          <span>Tax{model.taxPct ? ` ${model.taxPct}%` : ""}</span>
          <b>{inrExact(c.tax)}</b>
        </div>
        <div className="is-total">
          <span>Grand total</span>
          <b>{inrExact(c.grand)}</b>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(c.grand)}</div>
      <TermsGrid model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <div className="ims-bom-accept">
        <div>
          <div className="ims-paper-sign-line" />
          Client acceptance
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Studio · ${model.business.name || "Your business"}`}
        </div>
      </div>
    </PaperShell>
  );
}

/* ---------- Prism ---------- */

export function PrismBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  const b = model.business;
  const stamp = stampOf(model.status);

  return (
    <PaperShell model={model} tpl="prism" hideDefaultTop>
      <div className="ims-bom-prism">
        <aside className="ims-bom-prism-rail">
          <PaperBrandHead
            name={b.name || "Your business"}
            logoUrl={b.logoUrl}
            detail={sellerDetailInline({ address: b.address, state: b.state, gstin: b.gstin, phone: b.phone, email: b.email })}
          />
          <div className="ims-bom-prism-badge" aria-label="Capacity">
            <span>Capacity</span>
            <strong>{model.capacityLabel || "—"}</strong>
          </div>
          <dl className="ims-bom-prism-dl">
            <div>
              <dt>Document</dt>
              <dd>{model.docNo || "Draft"}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{model.docDate ? dateLabel(model.docDate) : "—"}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{model.customerName || "—"}</dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>{model.location || "—"}</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{model.preparedBy || "—"}</dd>
            </div>
          </dl>
          {stamp ? (
            <span className="ims-paper-stamp" style={{ color: stamp.color }}>
              {stamp.text}
            </span>
          ) : null}
          <div className="ims-bom-prism-rail-total">
            <span>Grand total</span>
            <strong>{inrExact(c.grand)}</strong>
          </div>
        </aside>
        <div className="ims-bom-prism-main">
          <div className="ims-bom-prism-head">
            <h2>{model.title || "Bill of materials"}</h2>
            <p>Structured materials schedule with layered commercial totals.</p>
          </div>
          <CompositionBars sections={sections} />
          {sections.map((sec) => (
            <section key={`prism-${sec.index}`} className="ims-bom-prism-sec">
              <header>
                <span>{sec.roman}</span>
                <h4>{sec.name}</h4>
                <b>{inrExact(sec.materials)}</b>
              </header>
              <ul>
                {sec.lines.map((l, i) => (
                  <li key={`${sec.name}-${i}`}>
                    <div>
                      <LineDesc line={l} />
                      <small>
                        {l.makeText || "—"}
                        {lineKindLabel(l.lineKind) ? ` · ${lineKindLabel(l.lineKind)}` : ""}
                        {l.remarks ? ` · ${l.remarks}` : ""}
                      </small>
                    </div>
                    <div className="ims-bom-prism-line-amt">
                      <span>{qtyText(l.qty, l.unit)}</span>
                      <b>{inrExact(lineAmount(l))}</b>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="ims-bom-prism-layers">
            <div>
              <span>Materials</span>
              <b>{inrExact(c.materials)}</b>
            </div>
            <div>
              <span>Margin{model.marginPct ? ` ${model.marginPct}%` : ""}</span>
              <b>{inrExact(c.margin)}</b>
            </div>
            <div>
              <span>Tax{model.taxPct ? ` ${model.taxPct}%` : ""}</span>
              <b>{inrExact(c.tax)}</b>
            </div>
            <div className="is-total">
              <span>Total</span>
              <b>{inrExact(c.grand)}</b>
            </div>
          </div>
          <div className="ims-paper-words">{rupeesInWords(c.grand)}</div>
      <FootMatter model={model} />
        </div>
      </div>
    </PaperShell>
  );
}

/* ---------- Orbit — digital proposal cockpit ---------- */

export function OrbitBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  const lineCount = model.lines.length;
  return (
    <PaperShell model={model} tpl="orbit">
      <div className="ims-bom-orbit-kpis">
        <div>
          <b>Capacity</b>
          <span>{model.capacityLabel || "—"}</span>
        </div>
        <div>
          <b>Lines</b>
          <span>{lineCount}</span>
        </div>
        <div>
          <b>Sections</b>
          <span>{sections.length}</span>
        </div>
        <div>
          <b>Materials</b>
          <span>{inrExact(c.materials)}</span>
        </div>
        <div className="is-total">
          <b>Grand total</b>
          <span>{inrExact(c.grand)}</span>
        </div>
      </div>
      <PartyBlock model={model} />
      <CompositionBars sections={sections} />
      <CostRibbon model={model} />
      <table className="bos-inv-paper-table ims-bom-orbit-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Component</th>
            <th>Kind</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sections.length ? (
            sections.flatMap((sec) =>
              sec.lines.map((l, i) => (
                <tr key={`${sec.name}-${i}`}>
                  <td>{i + 1}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <strong className="ims-bom-orbit-sec">{sec.name}</strong>
                    <LineDesc line={l} />
                    {l.remarks ? <small>{l.remarks}</small> : null}
                  </td>
                  <td>
                    {lineKindLabel(l.lineKind) ? (
                      <span className={`ims-bom-kind ims-bom-kind--${l.lineKind}`}>{lineKindLabel(l.lineKind)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                  <td>{qtyText(l.qty, l.unit)}</td>
                  <td>{inrExact(lineAmount(l))}</td>
                </tr>
              )),
            )
          ) : (
            <EmptyRows cols={6} />
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Forge — procurement / marketplace BOQ ---------- */

export function ForgeBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const stock = model.lines.filter((l) => (l.lineKind || "stock") === "stock" || l.lineKind === "scaled");
  const other = model.lines.filter((l) => l.lineKind === "service" || l.lineKind === "overhead");
  const c = bomCostComposition(model.totals);

  const renderBuy = (lines: typeof model.lines, title: string) => (
    <section className="ims-bom-forge-block">
      <header>
        <h4>{title}</h4>
        <span>{lines.length} lines</span>
      </header>
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Supplier / make</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length ? (
            lines.map((l, i) => (
              <tr key={`${title}-${i}`}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: "normal" }}>
                  <LineDesc line={l} showRemarks={false} />
                  <small>
                    {l.section}
                    {l.remarks ? ` · ${l.remarks}` : ""}
                  </small>
                </td>
                <td style={{ whiteSpace: "normal" }}>{l.makeText || "TBD"}</td>
                <td>{qtyText(l.qty)}</td>
                <td>{l.unit || "—"}</td>
                <td>{inrExact(l.rate)}</td>
                <td>{inrExact(lineAmount(l))}</td>
              </tr>
            ))
          ) : (
            <EmptyRows cols={7} />
          )}
        </tbody>
      </table>
    </section>
  );

  return (
    <PaperShell model={model} tpl="forge">
      <div className="ims-bom-forge-banner">
        <div>
          <b>Job</b>
          {model.title || "Bill of materials"} · {model.capacityLabel || "—"}
        </div>
        <div>
          <b>Ship to</b>
          {model.customerName || "—"}
          {model.location ? ` · ${model.location}` : ""}
        </div>
        <div>
          <b>Ref</b>
          {model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}
        </div>
      </div>
      {renderBuy(stock, "Materials to procure")}
      {other.length ? renderBuy(other, "Services & overhead") : null}
      {!stock.length && !other.length ? (
        <div className="bos-inv-paper-empty">No items</div>
      ) : null}
      <div className="ims-bom-forge-foot">
        <div>
          <span>Materials</span>
          <b>{inrExact(c.materials)}</b>
        </div>
        <div>
          <span>Margin{model.marginPct ? ` ${model.marginPct}%` : ""}</span>
          <b>{inrExact(c.margin)}</b>
        </div>
        <div>
          <span>Tax{model.taxPct ? ` ${model.taxPct}%` : ""}</span>
          <b>{inrExact(c.tax)}</b>
        </div>
        <div className="is-total">
          <span>Grand total</span>
          <b>{inrExact(c.grand)}</b>
        </div>
      </div>
      {sections.length ? <CompositionBars sections={sections} /> : null}
      <FootMatter model={model} signLeft="Procurement checked" />
    </PaperShell>
  );
}

/* ---------- Nova — investment close ---------- */

export function NovaBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  return (
    <PaperShell model={model} tpl="nova">
      <div className="ims-bom-nova-hero">
        <div>
          <p className="ims-bom-nova-eyebrow">Your system investment</p>
          <h2>{model.capacityLabel || "Package"}</h2>
          <p>
            {model.customerName || "Customer"}
            {model.location ? ` · ${model.location}` : ""}
          </p>
        </div>
        <div className="ims-bom-nova-total">
          <span>Outlay</span>
          <strong>{inrExact(c.grand)}</strong>
          <small>{rupeesInWords(c.grand)}</small>
        </div>
      </div>
      <ol className="ims-bom-nova-steps">
        <li>
          <span>01</span>
          <div>
            <b>Materials</b>
            <em>{inrExact(c.materials)}</em>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <b>Margin{model.marginPct ? ` · ${model.marginPct}%` : ""}</b>
            <em>{inrExact(c.margin)}</em>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <b>Tax{model.taxPct ? ` · ${model.taxPct}%` : ""}</b>
            <em>{inrExact(c.tax)}</em>
          </div>
        </li>
        <li className="is-total">
          <span>04</span>
          <div>
            <b>Grand total</b>
            <em>{inrExact(c.grand)}</em>
          </div>
        </li>
      </ol>
      <DocMeta model={model} />
      {sections.map((sec) => (
        <section key={`nova-${sec.index}`} className="ims-bom-nova-sec">
          <header>
            <h4>{sec.name}</h4>
            <b>{inrExact(sec.materials)}</b>
          </header>
          <ul>
            {sec.lines.map((l, i) => (
              <li key={`${sec.name}-${i}`}>
                <span>
                  <LineDesc line={l} />
                  {l.makeText ? <small> · {l.makeText}</small> : null}
                </span>
                <span>
                  {qtyText(l.qty, l.unit)} · {inrExact(lineAmount(l))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <TermsGrid model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <div className="ims-bom-nova-accept">
        <div>
          <strong>Ready to proceed?</strong>
          <p>Sign to accept this materials schedule and commercial outlay.</p>
        </div>
        <div className="ims-bom-accept" style={{ margin: 0 }}>
          <div>
            <div className="ims-paper-sign-line" />
            Customer
          </div>
          <div>
            <div className="ims-paper-sign-line" />
            {model.preparedBy || model.business.name || "Business"}
          </div>
        </div>
      </div>
    </PaperShell>
  );
}

/* ---------- Folio — card stream / mobile-era ---------- */

export function FolioBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  return (
    <PaperShell model={model} tpl="folio">
      <div className="ims-bom-folio-top">
        <div>
          <b>{model.title || "Bill of materials"}</b>
          <span>
            {model.capacityLabel || "—"} · {model.customerName || "—"}
            {model.location ? ` · ${model.location}` : ""}
          </span>
        </div>
        <div className="ims-bom-folio-total">
          <span>Total</span>
          <strong>{inrExact(c.grand)}</strong>
        </div>
      </div>
      {sections.map((sec) => (
        <section key={`folio-${sec.index}`} className="ims-bom-folio-sec">
          <h4>
            {sec.roman}. {sec.name}
            <em>{inrExact(sec.materials)}</em>
          </h4>
          <div className="ims-bom-folio-grid">
            {sec.lines.map((l, i) => (
              <article key={`${sec.name}-${i}`} className="ims-bom-folio-card">
                <header>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {lineKindLabel(l.lineKind) ? (
                    <span className={`ims-bom-kind ims-bom-kind--${l.lineKind}`}>{lineKindLabel(l.lineKind)}</span>
                  ) : null}
                </header>
                <h5><LineDesc line={l} showRemarks={false} /></h5>
                <p>{l.makeText || "—"}</p>
                {l.remarks ? <small>{l.remarks}</small> : null}
                <footer>
                  <span>{qtyText(l.qty, l.unit)}</span>
                  <b>{inrExact(lineAmount(l))}</b>
                </footer>
              </article>
            ))}
          </div>
        </section>
      ))}
      <div className="ims-bom-folio-foot">
        <div>
          <span>Materials</span>
          <b>{inrExact(c.materials)}</b>
        </div>
        <div>
          <span>Margin</span>
          <b>{inrExact(c.margin)}</b>
        </div>
        <div>
          <span>Tax</span>
          <b>{inrExact(c.tax)}</b>
        </div>
        <div className="is-total">
          <span>Grand</span>
          <b>{inrExact(c.grand)}</b>
        </div>
      </div>
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Aether — flagship materials proposal ---------- */

export function AetherBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const c = bomCostComposition(model.totals);
  const b = model.business;
  const stamp = stampOf(model.status);
  const sellerLine = sellerDetailInline({
    address: b.address,
    state: b.state,
    gstin: b.gstin,
    phone: b.phone,
    email: b.email,
  });
  const forLine = [
    model.customerName || "—",
    model.location || null,
    model.projectRef ? `Project ${model.projectRef}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const metaBits = [
    model.docNo || "Draft",
    `R${Number(model.revision ?? 1)}`,
    model.docDate ? dateLabel(model.docDate) : null,
    model.validUntil ? `Valid ${dateLabel(model.validUntil)}` : null,
    model.preparedBy ? `By ${model.preparedBy}` : null,
  ].filter(Boolean);
  const titleBits = [model.title || null, model.capacityLabel || null].filter(Boolean).join(" · ");

  return (
    <PaperShell model={model} tpl="aether" hideDefaultTop>
      <header className="ims-bom-aether-head">
        <div className="ims-bom-aether-head-row">
          <PaperBrandHead name={b.name || "Your business"} logoUrl={b.logoUrl} detail={sellerLine || null} />
          <div className="ims-bom-aether-docblock">
            <div className="ims-bom-aether-eyebrow">
              Materials proposal
              {stamp ? <span className="ims-paper-stamp" style={{ color: stamp.color }}> · {stamp.text}</span> : null}
            </div>
            <h1>{bomDocTitle(model)}</h1>
            {titleBits ? <p className="ims-bom-aether-title">{titleBits}</p> : null}
          </div>
        </div>

        <div className="ims-bom-aether-meta-line" aria-label="Document meta">
          {metaBits.join(" · ")}
        </div>

        <div className="ims-bom-aether-for-line">
          <b>For</b>
          <span>{forLine}</span>
        </div>

        <div className="ims-bom-aether-totals-bar" aria-label="Investment summary">
          <div>
            <span>Materials</span>
            <b>{inrExact(c.materials)}</b>
          </div>
          <div>
            <span>Margin{model.marginPct ? ` ${model.marginPct}%` : ""}</span>
            <b>{inrExact(c.margin)}</b>
          </div>
          <div>
            <span>Tax{model.taxPct ? ` ${model.taxPct}%` : ""}</span>
            <b>{inrExact(c.tax)}</b>
          </div>
          <div className="is-total">
            <span>Grand total</span>
            <b>{inrExact(c.grand)}</b>
          </div>
        </div>
      </header>

      {sections.map((sec) => (
        <section key={`aether-${sec.index}`} className="ims-bom-aether-sec">
          <header>
            <div>
              <span className="ims-bom-tier-mark">{sec.roman}</span>
              <h4>{sec.name}</h4>
            </div>
            <em>
              {sec.sharePct}% · {inrExact(sec.materials)}
            </em>
          </header>
          <table className="bos-inv-paper-table ims-bom-aether-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Make</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sec.lines.map((l, i) => (
                <tr key={`${sec.name}-${i}`}>
                  <td>{i + 1}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    <LineDesc line={l} />
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                  <td>{qtyText(l.qty, l.unit)}</td>
                  <td>{inrExact(l.rate)}</td>
                  <td>{inrExact(lineAmount(l))}</td>
                </tr>
              ))}
              <tr className="ims-bom-aether-subtotal">
                <td colSpan={5}>Section subtotal</td>
                <td>{inrExact(sec.materials)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      {!sections.length ? <div className="bos-inv-paper-empty">No items</div> : null}

      <CommercialTotals model={model} />
      <FootMatter model={model} />
    </PaperShell>
  );
}

