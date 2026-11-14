"use client";

import { Fragment, type ReactNode } from "react";
import { dateLabel, inrExact, qtyText, rupeesInWords } from "@/lib/ims/format";
import {
  BOM_COLUMN_LABEL,
  bomCustomerComposition,
  bomIndustryPackMeta,
  groupBomSections,
  lineAmount,
  lineIdentityBits,
  lineKindLabel,
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperPurpose,
  normalizeBomPaperTone,
  scheduleColumnsFor,
  type BomPaperLine,
  type BomPaperSection,
  type BomScheduleColumn,
} from "@/lib/ims/bom-paper";
import { PaperBrandHead, sellerDetailInline } from "../shared/DocumentPaper";
import type { BomPaperModel } from "./BomPaper";

const BOM_STAMP: Partial<Record<string, { text: string; color: string }>> = {
  draft: { text: "DRAFT", color: "#8A8FA3" },
  confirmed: { text: "CONFIRMED", color: "#0f766e" },
  cancelled: { text: "CANCELLED", color: "#b42318" },
};

function stampOf(status: string | null | undefined) {
  return BOM_STAMP[(status || "").toLowerCase()] ?? null;
}

function bomDocTitle() {
  return "BILL OF MATERIALS";
}

function paperClass(model: BomPaperModel, purpose: string) {
  const tone = normalizeBomPaperTone(model.tone);
  const density = normalizeBomPaperDensity(model.density);
  const pack = normalizeBomIndustryPack(model.industryPack);
  return [
    "bos-inv-paper",
    "ims-bom-sheet",
    `ims-bom-sheet--${purpose}`,
    `ims-bom-tone--${tone}`,
    `ims-bom-density--${density}`,
    `ims-bom-pack--${pack}`,
  ].join(" ");
}

function PaperShell({
  model,
  purpose,
  children,
  hideDefaultTop,
}: {
  model: BomPaperModel;
  purpose: string;
  hideDefaultTop?: boolean;
  children: ReactNode;
}) {
  const b = model.business;
  const stamp = stampOf(model.status);
  return (
    <article
      className={paperClass(model, purpose)}
      data-bom-tpl={purpose}
      data-bom-pack={normalizeBomIndustryPack(model.industryPack)}
      aria-label="Bill of materials"
      style={{ position: "static" }}
    >
      {!hideDefaultTop ? (
        <div className="bos-inv-paper-top ims-bom-sheet-top">
          <PaperBrandHead
            name={b.name || "Your business"}
            logoUrl={b.logoUrl}
            detail={sellerDetailInline({
              address: b.address,
              state: b.state,
              gstin: b.gstin,
              phone: b.phone,
              email: b.email,
            })}
          />
          <div className="ims-bom-sheet-titleblock">
            <div className="bos-inv-paper-title">{bomDocTitle()}</div>
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

function sizeLabel(model: BomPaperModel) {
  return bomIndustryPackMeta(model.industryPack).sizeLabel;
}

function DocMeta({ model, extra }: { model: BomPaperModel; extra?: ReadonlyArray<{ label: string; value: string }> }) {
  const meta: Array<{ label: string; value: string }> = [
    { label: "Doc", value: model.docNo || "Draft" },
    { label: "Rev", value: `R${Number(model.revision ?? 1)}` },
    { label: "Date", value: model.docDate ? dateLabel(model.docDate) : "—" },
  ];
  if (model.validUntil) meta.push({ label: "Valid", value: dateLabel(model.validUntil) });
  if (model.capacityLabel) meta.push({ label: sizeLabel(model), value: model.capacityLabel });
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
  const siteLine = [model.location || null, model.projectRef ? `Project ${model.projectRef}` : null]
    .filter(Boolean)
    .join(" · ");
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
  const tail = [...ids, showRemarks && line.remarks ? line.remarks : null].filter(Boolean);
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
  const hideMargin = Boolean(model.hideMargin);
  const c = bomCustomerComposition(model.totals, hideMargin);
  return (
    <>
      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row">
          <span>{hideMargin ? "Supply total" : "Materials total"}</span>
          <span>{inrExact(c.materials)}</span>
        </div>
        {!hideMargin ? (
          <div className="bos-inv-totals-row">
            <span>Margin{model.marginPct ? ` (${model.marginPct}%)` : ""}</span>
            <span>{inrExact(c.margin)}</span>
          </div>
        ) : null}
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

function CostRibbon({ model }: { model: BomPaperModel }) {
  const hideMargin = Boolean(model.hideMargin);
  const c = bomCustomerComposition(model.totals, hideMargin);
  return (
    <div className="ims-bom-cost-ribbon" aria-label="Cost composition">
      <div className="ims-bom-cost-track" aria-hidden>
        <i className="is-mat" style={{ width: `${c.materialsPct}%` }} />
        {!hideMargin ? <i className="is-mar" style={{ width: `${c.marginPctOfGrand}%` }} /> : null}
        <i className="is-tax" style={{ width: `${c.taxPctOfGrand}%` }} />
      </div>
      <div className="ims-bom-cost-legend">
        <span>
          {hideMargin ? "Supply" : "Materials"} <b>{c.materialsPct}%</b>
        </span>
        {!hideMargin ? (
          <span>
            Margin <b>{c.marginPctOfGrand}%</b>
          </span>
        ) : null}
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

function cellValue(col: BomScheduleColumn, line: BomPaperLine, index: number, hideMargin: boolean) {
  switch (col) {
    case "check":
      return <span className="ims-bom-checkbox" aria-hidden />;
    case "index":
      return index + 1;
    case "item":
      return (
        <span style={{ whiteSpace: "normal" }}>
          <LineDesc line={line} showRemarks={false} />
        </span>
      );
    case "sku":
      return line.sku?.trim() || "—";
    case "hsn":
      return line.hsn?.trim() || "—";
    case "make":
      return <span style={{ whiteSpace: "normal" }}>{line.makeText || "—"}</span>;
    case "kind":
      return lineKindLabel(line.lineKind) ? (
        <span className={`ims-bom-kind ims-bom-kind--${line.lineKind}`}>{lineKindLabel(line.lineKind)}</span>
      ) : (
        "—"
      );
    case "qty":
      return qtyText(line.qty, undefined);
    case "unit":
      return line.unit || "—";
    case "rate":
      return hideMargin ? "—" : inrExact(line.rate);
    case "amount": {
      if (hideMargin) {
        // Fold document margin into displayed line amount proportionally is complex;
        // show line amount as materials; totals already fold margin at roll-up.
        return inrExact(lineAmount(line));
      }
      return inrExact(lineAmount(line));
    }
    case "remarks":
      return <span style={{ whiteSpace: "normal" }}>{line.remarks || "—"}</span>;
    default:
      return "—";
  }
}

function ScheduleTable({
  model,
  sections,
  showSectionTotals = false,
  romanSections = false,
}: {
  model: BomPaperModel;
  sections: ReadonlyArray<BomPaperSection>;
  showSectionTotals?: boolean;
  romanSections?: boolean;
}) {
  const purpose = normalizeBomPaperPurpose(model.template);
  const pack = normalizeBomIndustryPack(model.industryPack);
  const cols = scheduleColumnsFor(purpose, pack);
  const hideMargin = Boolean(model.hideMargin) && purpose !== "field";
  const qtyOnly = purpose === "field";
  const displayCols = qtyOnly ? cols : cols;

  return (
    <table className="bos-inv-paper-table ims-bom-schedule">
      <thead>
        <tr>
          {displayCols.map((c) => (
            <th key={c} className={c === "check" ? "ims-bom-check-col" : undefined}>
              {c === "qty" && !displayCols.includes("unit") ? "Qty" : BOM_COLUMN_LABEL[c]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.length ? (
          sections.map((sec) => (
            <Fragment key={`sec-${sec.index}-${sec.name}`}>
              {sections.length > 1 ? (
                <tr className={`ims-bom-section${romanSections ? " ims-bom-section--roman" : ""}`}>
                  <td colSpan={displayCols.length}>
                    {romanSections ? `${sec.roman}. ${sec.name}` : sec.name}
                  </td>
                </tr>
              ) : null}
              {sec.lines.map((l, i) => (
                <tr key={`${sec.name}-${i}-${l.description}`}>
                  {displayCols.map((c) => (
                    <td key={c} className={c === "check" ? "ims-bom-check-col" : undefined}>
                      {c === "qty" && !displayCols.includes("unit")
                        ? qtyText(l.qty, l.unit)
                        : cellValue(c, l, i, hideMargin)}
                    </td>
                  ))}
                </tr>
              ))}
              {showSectionTotals && !qtyOnly ? (
                <tr className="ims-bom-epc-sec-total">
                  <td colSpan={Math.max(1, displayCols.length - 1)}>Section total — {sec.name}</td>
                  <td>{inrExact(sec.materials)}</td>
                </tr>
              ) : null}
            </Fragment>
          ))
        ) : (
          <EmptyRows cols={displayCols.length} />
        )}
      </tbody>
    </table>
  );
}

function InvestmentBar({ model }: { model: BomPaperModel }) {
  const hideMargin = Boolean(model.hideMargin);
  const c = bomCustomerComposition(model.totals, hideMargin);
  const pack = bomIndustryPackMeta(model.industryPack);
  return (
    <div className="ims-bom-aether-totals-bar" aria-label="Investment summary">
      <div>
        <span>{hideMargin ? "Supply" : "Materials"}</span>
        <b>{inrExact(c.materials)}</b>
      </div>
      {!hideMargin ? (
        <div>
          <span>Margin{model.marginPct ? ` ${model.marginPct}%` : ""}</span>
          <b>{inrExact(c.margin)}</b>
        </div>
      ) : null}
      <div>
        <span>Tax{model.taxPct ? ` ${model.taxPct}%` : ""}</span>
        <b>{inrExact(c.tax)}</b>
      </div>
      <div className="is-grand">
        <span>Total</span>
        <b>{inrExact(c.grand)}</b>
      </div>
      {model.capacityLabel ? (
        <div>
          <span>{pack.sizeLabel}</span>
          <b>{model.capacityLabel}</b>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Proposal (flagship sell sheet) ---------- */

export function ProposalBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const b = model.business;
  const stamp = stampOf(model.status);
  const sellerLine = [
    b.address,
    b.state,
    b.gstin ? `GSTIN ${b.gstin}` : null,
    b.phone,
    b.email,
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
    <PaperShell model={model} purpose="proposal" hideDefaultTop>
      <header className="ims-bom-aether-head">
        <div className="ims-bom-aether-head-row">
          <PaperBrandHead name={b.name || "Your business"} logoUrl={b.logoUrl} detail={sellerLine || null} />
          <div className="ims-bom-aether-docblock">
            <h1>{bomDocTitle()}</h1>
            {stamp ? (
              <span className="ims-paper-stamp ims-bom-status-pill" style={{ color: stamp.color }}>
                {stamp.text}
              </span>
            ) : null}
            {titleBits ? <p className="ims-bom-aether-title">{titleBits}</p> : null}
          </div>
        </div>
        <div className="ims-bom-aether-meta-line" aria-label="Document meta">
          {metaBits.join(" · ")}
        </div>
        <div className="ims-bom-aether-for-line">
          <b>For</b>
          <span>
            {model.customerName || "—"}
            {[model.location, model.projectRef ? `Project ${model.projectRef}` : null].filter(Boolean).length
              ? ` · ${[model.location, model.projectRef ? `Project ${model.projectRef}` : null].filter(Boolean).join(" · ")}`
              : ""}
          </span>
        </div>
        <InvestmentBar model={model} />
      </header>
      <ScheduleTable model={model} sections={sections} showSectionTotals />
      <div className="ims-paper-words">{rupeesInWords(bomCustomerComposition(model.totals, Boolean(model.hideMargin)).grand)}</div>
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Executive ---------- */

export function ExecutiveBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const hideMargin = Boolean(model.hideMargin);
  const c = bomCustomerComposition(model.totals, hideMargin);
  return (
    <PaperShell model={model} purpose="executive">
      <div className="ims-bom-exec-hero">
        <div>
          <div className="ims-bom-hero-kicker">Investment</div>
          <div className="ims-bom-hero-total">{inrExact(c.grand)}</div>
          <div className="ims-bom-hero-sub">{rupeesInWords(c.grand)}</div>
        </div>
        <div className="ims-bom-exec-stats">
          <div>
            <b>{sizeLabel(model)}</b>
            <span>{model.capacityLabel || "—"}</span>
          </div>
          <div>
            <b>{hideMargin ? "Supply" : "Materials"}</b>
            <span>{inrExact(c.materials)}</span>
          </div>
          {!hideMargin ? (
            <div>
              <b>Margin</b>
              <span>
                {inrExact(c.margin)}
                {model.marginPct ? ` · ${model.marginPct}%` : ""}
              </span>
            </div>
          ) : null}
          <div>
            <b>Tax</b>
            <span>
              {inrExact(c.tax)}
              {model.taxPct ? ` · ${model.taxPct}%` : ""}
            </span>
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
      <FootMatter model={model} signLeft="Accepted by customer" />
    </PaperShell>
  );
}

/* ---------- Technical BOQ ---------- */

export function TechnicalBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  return (
    <PaperShell model={model} purpose="technical">
      <div className="ims-bom-epc-strip">
        <div>
          <b>{sizeLabel(model)}</b>
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
      <ScheduleTable model={model} sections={sections} showSectionTotals romanSections />
      <CommercialTotals model={model} />
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Field ---------- */

export function FieldBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  return (
    <PaperShell model={model} purpose="field">
      <div className="ims-bom-field-banner">Materials checklist for site — rates and totals are hidden.</div>
      <DocMeta
        model={model}
        extra={[
          { label: "Customer", value: model.customerName || "—" },
          { label: "Site", value: model.location || "—" },
        ]}
      />
      <ScheduleTable model={model} sections={sections} romanSections />
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

/* ---------- Share (mobile cards) ---------- */

export function ShareBomPaper({ model }: { model: BomPaperModel }) {
  const sections = groupBomSections(model.lines, model.totals.materialsTotal);
  const hideMargin = Boolean(model.hideMargin);
  const c = bomCustomerComposition(model.totals, hideMargin);
  return (
    <PaperShell model={model} purpose="share">
      <DocMeta model={model} />
      <PartyBlock model={model} />
      <div className="ims-bom-folio-grid">
        {sections.length ? (
          sections.flatMap((sec) =>
            sec.lines.map((l, i) => (
              <div key={`${sec.name}-${i}`} className="ims-bom-folio-card">
                <div className="ims-bom-folio-card-top">
                  <span className="ims-bom-folio-sec">{sec.name}</span>
                  {lineKindLabel(l.lineKind) ? (
                    <span className={`ims-bom-kind ims-bom-kind--${l.lineKind}`}>{lineKindLabel(l.lineKind)}</span>
                  ) : null}
                </div>
                <div className="ims-bom-folio-desc">
                  <LineDesc line={l} />
                </div>
                <div className="ims-bom-folio-meta">
                  <span>{l.makeText || "—"}</span>
                  <span>{qtyText(l.qty, l.unit)}</span>
                  <b>{inrExact(lineAmount(l))}</b>
                </div>
              </div>
            )),
          )
        ) : (
          <div className="bos-inv-paper-empty">No items</div>
        )}
      </div>
      <div className="ims-bom-folio-foot">
        <div>
          <span>Total</span>
          <b>{inrExact(c.grand)}</b>
        </div>
        <div className="ims-paper-words">{rupeesInWords(c.grand)}</div>
      </div>
      <FootMatter model={model} />
    </PaperShell>
  );
}

/* ---------- Legacy export aliases (map old skins → purposes) ---------- */

export const AetherBomPaper = ProposalBomPaper;
export const ClassicBomPaper = ProposalBomPaper;
export const TieredBomPaper = ProposalBomPaper;
export const AuroraBomPaper = ProposalBomPaper;
export const AtelierBomPaper = ProposalBomPaper;
export const PrismBomPaper = ProposalBomPaper;
export const NovaBomPaper = ProposalBomPaper;
export const OrbitBomPaper = ExecutiveBomPaper;
export const EpcBomPaper = TechnicalBomPaper;
export const LedgerBomPaper = TechnicalBomPaper;
export const ForgeBomPaper = TechnicalBomPaper;
export const FolioBomPaper = ShareBomPaper;
