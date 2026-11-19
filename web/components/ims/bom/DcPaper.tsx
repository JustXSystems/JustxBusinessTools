"use client";

import type { BomDcStatus } from "@/lib/ims/bom";
import { dateLabel, qtyText } from "@/lib/ims/format";
import { useIms } from "../core";
import { PaperBrandHead, sellerDetail, type PaperParty } from "../shared/DocumentPaper";

export type DcPaperLine = {
  description: string;
  makeText?: string | null;
  qty: number;
  unit: string;
  remarks?: string | null;
};

/** Draft or saved DC values rendered on the shared invoice paper chrome. */
export type DcPaperModel = {
  docNo: string;
  docDate: string;
  status: BomDcStatus;
  /** BOM document number shown as the reference on the challan. */
  bomDocNo: string;
  customerName: string;
  location?: string | null;
  shipTo?: string | null;
  transporter?: string | null;
  vehicleNo?: string | null;
  notes?: string | null;
  /** Display name of the person who verified the DC. */
  verifiedByName?: string | null;
  approvedByName?: string | null;
  lines: ReadonlyArray<DcPaperLine>;
};

const DC_STAMP: Record<BomDcStatus, { text: string; color: string } | null> = {
  draft: { text: "DRAFT", color: "#D98A1F" },
  verified: { text: "VERIFIED", color: "#2563EB" },
  approved: { text: "APPROVED", color: "#1FA679" },
  cancelled: { text: "CANCELLED", color: "#6B7280" },
};

function sellerOf(session: ReturnType<typeof useIms>["session"]): PaperParty {
  const s = session.settings;
  const b = session.brand;
  return {
    label: "From",
    name: s.businessName || b?.name || "",
    gstin: s.gstin ?? b?.gstin ?? null,
    address: s.address ?? b?.address ?? null,
    state: s.state ? `${s.state}${s.stateCode ? ` (${s.stateCode})` : ""}` : (b?.state ?? null),
    phone: s.phone ?? b?.phone ?? null,
    email: s.email ?? b?.email ?? null,
    logoUrl: b?.logoUrl ?? null,
  };
}

/**
 * Delivery challan sheet on the same `.bos-inv-paper` invoice template used by tax invoices / POs.
 * Qty-focused table (no rates/tax); meta includes BOM reference and verified-by display name.
 */
export function DcPaper({ model }: { model: DcPaperModel }) {
  const { session } = useIms();
  const seller = sellerOf(session);
  const stamp = DC_STAMP[model.status];
  const shipTo = model.shipTo?.trim() || "";
  const meta: Array<{ label: string; value: string }> = [
    { label: "Challan no.", value: model.docNo || "DC/…" },
    { label: "Challan date", value: dateLabel(model.docDate) },
    { label: "BOM reference", value: model.bomDocNo || "—" },
    { label: "Verified by", value: model.verifiedByName?.trim() || "—" },
  ];
  if (model.transporter?.trim()) meta.push({ label: "Transporter", value: model.transporter.trim() });
  if (model.vehicleNo?.trim()) meta.push({ label: "Vehicle", value: model.vehicleNo.trim() });
  if (model.approvedByName?.trim()) meta.push({ label: "Approved by", value: model.approvedByName.trim() });

  return (
    <article className="bos-inv-paper" aria-label="Delivery challan" style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <PaperBrandHead name={seller.name} logoUrl={seller.logoUrl} detail={sellerDetail(seller)} />
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">DELIVERY CHALLAN</div>
          {stamp ? (
            <span className="ims-paper-stamp" style={{ color: stamp.color }}>
              {stamp.text}
            </span>
          ) : null}
        </div>
      </div>

      <div className="ims-paper-meta">
        {meta.map((m) => (
          <div key={m.label}>
            <b>{m.label}</b>
            {m.value}
          </div>
        ))}
      </div>

      <div className="bos-inv-paper-meta">
        <div>
          <div className="bos-inv-paper-label">Deliver to</div>
          <div className="bos-inv-paper-value">{model.customerName || "—"}</div>
          {shipTo || model.location ? <div className="ims-paper-sub">{[shipTo || null, model.location].filter(Boolean).join("\n")}</div> : null}
        </div>
        <div>
          <div className="bos-inv-paper-label">Customer</div>
          <div className="bos-inv-paper-value">{model.customerName || "—"}</div>
          {model.location ? <div className="ims-paper-sub">{model.location}</div> : null}
        </div>
      </div>

      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Make</th>
            <th>Qty</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.length ? (
            model.lines.map((l, i) => (
              <tr key={`${l.description}-${i}`}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: "normal" }}>{l.description || "—"}</td>
                <td>{l.makeText?.trim() || "—"}</td>
                <td>{qtyText(l.qty, l.unit)}</td>
                <td style={{ whiteSpace: "normal" }}>{l.remarks?.trim() || "—"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="bos-inv-paper-empty">
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
          Received by
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          Authorised signatory · {seller.name}
        </div>
      </div>
    </article>
  );
}
