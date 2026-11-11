"use client";

import { Fragment, type ReactNode } from "react";
import { dateLabel, inrExact, qtyText, rupeesInWords } from "@/lib/ims/format";
import type { BomBusiness, BomDoc, BomTotals } from "@/lib/ims/bom";
import {
  bomPaperTemplateMeta,
  groupBomSections,
  lineKindLabel,
  normalizeBomPaperTemplate,
  type BomPaperLine,
  type BomPaperTemplateId,
} from "@/lib/ims/bom-paper";
import { PaperBrandHead, sellerDetail } from "../shared/DocumentPaper";

export type BomPaperModel = {
  business: BomBusiness;
  docNo?: string | null;
  docDate?: string | null;
  status?: string | null;
  title: string;
  capacityLabel: string;
  customerName: string;
  location: string;
  preparedBy?: string | null;
  notes?: string | null;
  marginPct: number;
  taxPct: number;
  lines: ReadonlyArray<BomPaperLine>;
  totals: BomTotals;
  /** Tenant default from Settings → Documents. */
  template?: BomPaperTemplateId | null;
};

export function modelFromDoc(doc: BomDoc, business: BomBusiness, template?: BomPaperTemplateId | null): BomPaperModel {
  return {
    business,
    docNo: doc.docNo,
    docDate: doc.docDate,
    status: doc.status,
    title: doc.title || doc.packageName || "Bill of materials",
    capacityLabel: doc.capacityLabel || "",
    customerName: doc.customerName || "",
    location: doc.location || "",
    preparedBy: doc.preparedBy,
    notes: doc.notes,
    marginPct: doc.marginPct,
    taxPct: doc.taxPct,
    lines: (doc.lines ?? []).map((l) => ({
      section: l.section,
      lineKind: l.lineKind,
      description: l.description,
      makeText: l.makeText,
      qty: l.qty,
      unit: l.unit,
      rate: l.rate,
      amount: l.amount,
      remarks: l.remarks,
    })),
    totals: {
      materialsTotal: doc.materialsTotal,
      marginAmount: doc.marginAmount,
      taxAmount: doc.taxAmount,
      grandTotal: doc.grandTotal,
    },
    template,
  };
}

const BOM_STAMP: Partial<Record<string, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8A8FA3" },
  cancelled: { text: "CANCELLED", color: "#8A8FA3" },
};

function stampOf(status: string | null | undefined) {
  return BOM_STAMP[(status || "").toLowerCase()] ?? null;
}

function PaperShell({
  model,
  title,
  className,
  children,
  badge,
}: {
  model: BomPaperModel;
  title: string;
  className?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const b = model.business;
  const stamp = stampOf(model.status);
  return (
    <article className={`bos-inv-paper ${className || ""}`.trim()} aria-label="Bill of materials" style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <PaperBrandHead
          name={b.name || "Your business"}
          logoUrl={b.logoUrl}
          detail={sellerDetail({ address: b.address, state: b.state, gstin: b.gstin, phone: b.phone, email: b.email })}
        />
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">{title}</div>
          {badge}
          {stamp ? (
            <span className="ims-paper-stamp" style={{ color: stamp.color }}>
              {stamp.text}
            </span>
          ) : null}
        </div>
      </div>
      {children}
    </article>
  );
}

function DocMeta({ model, extra }: { model: BomPaperModel; extra?: ReadonlyArray<{ label: string; value: string }> }) {
  const meta: Array<{ label: string; value: string }> = [
    { label: "Document no.", value: model.docNo || "Draft" },
    { label: "Document date", value: model.docDate ? dateLabel(model.docDate) : "—" },
    { label: "Package / capacity", value: model.capacityLabel || "—" },
  ];
  if (model.title) meta.push({ label: "Title", value: model.title });
  if (model.preparedBy) meta.push({ label: "Prepared by", value: model.preparedBy });
  for (const e of extra ?? []) meta.push(e);
  return (
    <div className="ims-paper-meta">
      {meta.map((m) => (
        <div key={m.label}>
          <b>{m.label}</b>
          {m.value}
        </div>
      ))}
    </div>
  );
}

function PartyBlock({ model }: { model: BomPaperModel }) {
  return (
    <div className="bos-inv-paper-meta">
      <div>
        <div className="bos-inv-paper-label">Customer</div>
        <div className="bos-inv-paper-value">{model.customerName || "—"}</div>
      </div>
      <div>
        <div className="bos-inv-paper-label">Site / location</div>
        <div className="bos-inv-paper-value">{model.location || "—"}</div>
      </div>
    </div>
  );
}

function CommercialTotals({ model }: { model: BomPaperModel }) {
  const subtotal = model.totals.materialsTotal + model.totals.marginAmount;
  return (
    <>
      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>Materials total</span>
          <span>{inrExact(model.totals.materialsTotal)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Margin{model.marginPct ? ` (${model.marginPct}%)` : ""}</span>
          <span>{inrExact(model.totals.marginAmount)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Subtotal</span>
          <span>{inrExact(subtotal)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Tax{model.taxPct ? ` (${model.taxPct}%)` : ""}</span>
          <span>{inrExact(model.totals.taxAmount)}</span>
        </div>
        <div className="bos-inv-totals-row is-total">
          <span>Total</span>
          <span>{inrExact(model.totals.grandTotal)}</span>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(model.totals.grandTotal)}</div>
    </>
  );
}

function SignBlock({ model }: { model: BomPaperModel }) {
  const b = model.business;
  return (
    <div className="ims-paper-sign">
      <div>
        <div className="ims-paper-sign-line" />
        Customer acceptance
      </div>
      <div>
        <div className="ims-paper-sign-line" />
        {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Authorised signatory · ${b.name || "Your business"}`}
      </div>
    </div>
  );
}

/** Classic dealer BOM — matches existing commercial sheet language. */
function ClassicBomPaper({ model }: { model: BomPaperModel }) {
  const status = (model.status || "").toLowerCase();
  const title = status === "draft" ? "DRAFT BOM" : "BILL OF MATERIALS";
  const sections = groupBomSections(model.lines);

  return (
    <PaperShell model={model} title={title}>
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
                    <td colSpan={6}>{sec.name || `Section ${String.fromCharCode(65 + sec.index)}`}</td>
                  </tr>
                ) : null}
                {sec.lines.map((l, i) => (
                  <tr key={`${sec.name}-${i}-${l.description}`}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {l.description}
                      {l.remarks ? <small>{l.remarks}</small> : null}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(l.amount ?? l.qty * l.rate)}</td>
                  </tr>
                ))}
              </Fragment>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="bos-inv-paper-empty">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <div className="ims-paper-sign">
        <div />
        <div>
          <div className="ims-paper-sign-line" />
          {model.preparedBy ? `Prepared by ${model.preparedBy}` : `Authorised signatory · ${model.business.name || "Your business"}`}
        </div>
      </div>
    </PaperShell>
  );
}

/** Marketplace / C&I proposal with tier badges, kind tags, section roll-ups. */
function TieredBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines);
  const subtotal = model.totals.materialsTotal + model.totals.marginAmount;

  return (
    <PaperShell
      model={model}
      title="BOM PROPOSAL"
      className="ims-bom-paper--tiered"
      badge={<div className="ims-bom-paper-chip">Tiered schedule</div>}
    >
      <div className="ims-bom-hero">
        <div>
          <div className="ims-bom-hero-kicker">Package capacity</div>
          <div className="ims-bom-hero-value">{model.capacityLabel || "—"}</div>
          <div className="ims-bom-hero-sub">{model.title || "Bill of materials"}</div>
        </div>
        <div className="ims-bom-hero-aside">
          <div className="ims-bom-hero-kicker">Grand total</div>
          <div className="ims-bom-hero-total">{inrExact(model.totals.grandTotal)}</div>
          <div className="ims-bom-hero-sub">{model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}</div>
        </div>
      </div>
      <PartyBlock model={model} />
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
                      {l.description}
                      {l.remarks ? <small>{l.remarks}</small> : null}
                    </td>
                    <td>
                      {lineKindLabel(l.lineKind) ? <span className={`ims-bom-kind ims-bom-kind--${l.lineKind}`}>{lineKindLabel(l.lineKind)}</span> : "—"}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty, l.unit)}</td>
                    <td>{inrExact(l.amount ?? l.qty * l.rate)}</td>
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
          <b>{inrExact(model.totals.materialsTotal)}</b>
        </div>
        <div>
          <span>Margin {model.marginPct ? `${model.marginPct}%` : ""}</span>
          <b>{inrExact(model.totals.marginAmount)}</b>
        </div>
        <div>
          <span>Subtotal</span>
          <b>{inrExact(subtotal)}</b>
        </div>
        <div>
          <span>Tax {model.taxPct ? `${model.taxPct}%` : ""}</span>
          <b>{inrExact(model.totals.taxAmount)}</b>
        </div>
        <div className="is-total">
          <span>Grand total</span>
          <b>{inrExact(model.totals.grandTotal)}</b>
        </div>
      </div>
      <div className="ims-paper-words">{rupeesInWords(model.totals.grandTotal)}</div>
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <SignBlock model={model} />
    </PaperShell>
  );
}

/** Dense EPC / tender schedule — Roman sections, units, remarks. */
function EpcBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines);
  return (
    <PaperShell model={model} title="DETAILED BILL OF MATERIALS" className="ims-bom-paper--epc" badge={<div className="ims-bom-paper-chip">EPC technical</div>}>
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
                    <td style={{ whiteSpace: "normal" }}>{l.description}</td>
                    <td style={{ whiteSpace: "normal" }}>{l.makeText || "—"}</td>
                    <td>{qtyText(l.qty)}</td>
                    <td>{l.unit || "—"}</td>
                    <td>{inrExact(l.rate)}</td>
                    <td>{inrExact(l.amount ?? l.qty * l.rate)}</td>
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
            <tr>
              <td colSpan={8} className="bos-inv-paper-empty">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CommercialTotals model={model} />
      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}
      <SignBlock model={model} />
    </PaperShell>
  );
}

/** Executive overview — section economics first. */
function ExecutiveBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines);
  const subtotal = model.totals.materialsTotal + model.totals.marginAmount;
  return (
    <PaperShell model={model} title="EXECUTIVE BOM" className="ims-bom-paper--executive" badge={<div className="ims-bom-paper-chip">Decision pack</div>}>
      <div className="ims-bom-exec-hero">
        <div>
          <div className="ims-bom-hero-kicker">Investment</div>
          <div className="ims-bom-hero-total">{inrExact(model.totals.grandTotal)}</div>
          <div className="ims-bom-hero-sub">{rupeesInWords(model.totals.grandTotal)}</div>
        </div>
        <div className="ims-bom-exec-stats">
          <div>
            <b>Capacity</b>
            <span>{model.capacityLabel || "—"}</span>
          </div>
          <div>
            <b>Materials</b>
            <span>{inrExact(model.totals.materialsTotal)}</span>
          </div>
          <div>
            <b>Margin</b>
            <span>
              {inrExact(model.totals.marginAmount)}
              {model.marginPct ? ` · ${model.marginPct}%` : ""}
            </span>
          </div>
          <div>
            <b>Tax</b>
            <span>
              {inrExact(model.totals.taxAmount)}
              {model.taxPct ? ` · ${model.taxPct}%` : ""}
            </span>
          </div>
          <div>
            <b>Subtotal</b>
            <span>{inrExact(subtotal)}</span>
          </div>
          <div>
            <b>Document</b>
            <span>
              {model.docNo || "Draft"} · {model.docDate ? dateLabel(model.docDate) : "—"}
            </span>
          </div>
        </div>
      </div>
      <PartyBlock model={model} />
      <div className="ims-bom-exec-sections">
        {sections.length ? (
          sections.map((sec) => (
            <div key={`exec-${sec.index}`} className="ims-bom-exec-sec">
              <div className="ims-bom-exec-sec-head">
                <div>
                  <span className="ims-bom-tier-mark">{sec.roman}</span>
                  <strong>{sec.name}</strong>
                  <span className="ims-bom-exec-count">{sec.lines.length} lines</span>
                </div>
                <b>{inrExact(sec.materials)}</b>
              </div>
              <ul className="ims-bom-exec-lines">
                {sec.lines.map((l, i) => (
                  <li key={`${sec.name}-${i}`}>
                    <span>
                      {l.description}
                      {l.makeText ? <small> · {l.makeText}</small> : null}
                    </span>
                    <span>
                      {qtyText(l.qty, l.unit)} · {inrExact(l.amount ?? l.qty * l.rate)}
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

/** Field install pack — quantities only, checkboxes, no commercial rates. */
function FieldBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines);
  return (
    <PaperShell model={model} title="FIELD INSTALL PACK" className="ims-bom-paper--field" badge={<div className="ims-bom-paper-chip">No pricing</div>}>
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
                      {l.description}
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
            <tr>
              <td colSpan={6} className="bos-inv-paper-empty">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>
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

/** Printable commercial BOM sheet — layout chosen in IMS Settings → Documents. */
export function BomPaper({ model }: { model: BomPaperModel }) {
  const template = normalizeBomPaperTemplate(model.template);
  switch (template) {
    case "tiered":
      return <TieredBomPaper model={model} />;
    case "epc":
      return <EpcBomPaper model={model} />;
    case "executive":
      return <ExecutiveBomPaper model={model} />;
    case "field":
      return <FieldBomPaper model={model} />;
    case "classic":
    default:
      return <ClassicBomPaper model={model} />;
  }
}

export function BomPaperTemplateLabel({ id }: { id: BomPaperTemplateId | null | undefined }) {
  return <>{bomPaperTemplateMeta(id).label}</>;
}
