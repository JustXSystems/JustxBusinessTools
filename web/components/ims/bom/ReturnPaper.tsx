"use client";

import { dateLabel, qtyText } from "@/lib/ims/format";
import { useIms } from "../core";
import { PaperBrandHead, sellerDetail, type PaperParty } from "../shared/DocumentPaper";

export type ReturnPaperLine = {
  description: string;
  qty: number;
  unit: string;
  remarks?: string | null;
};

/** Draft or posted unused-material return values on the shared invoice paper chrome. */
export type ReturnPaperModel = {
  /** Blank / “RTN/…” while composing before post. */
  returnNo: string;
  returnDate: string;
  /** draft = composing; posted = saved RTN. */
  status: "draft" | "posted";
  dcDocNo: string;
  bomDocNo: string;
  quotationRef?: string | null;
  customerName: string;
  location?: string | null;
  projectRef?: string | null;
  notes?: string | null;
  createdByName?: string | null;
  lines: ReadonlyArray<ReturnPaperLine>;
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
 * Unused-material return sheet on the same `.bos-inv-paper` chrome as delivery challans.
 * Qty-focused (stock RETURN_IN); meta ties the RTN to its DC and BOM.
 */
export function ReturnPaper({ model }: { model: ReturnPaperModel }) {
  const { session } = useIms();
  const seller = sellerOf(session);
  const stamp =
    model.status === "draft"
      ? { text: "DRAFT", color: "#D98A1F" }
      : { text: "RETURNED", color: "#1FA679" };
  const meta: Array<{ label: string; value: string }> = [
    { label: "Return no.", value: model.returnNo || "RTN/…" },
    { label: "Return date", value: dateLabel(model.returnDate) },
    { label: "Against DC", value: model.dcDocNo || "—" },
    { label: "BOM reference", value: model.bomDocNo || "—" },
  ];
  if (model.quotationRef?.trim()) meta.push({ label: "Quotation", value: model.quotationRef.trim() });
  if (model.projectRef?.trim()) meta.push({ label: "Project", value: model.projectRef.trim() });
  if (model.createdByName?.trim()) meta.push({ label: "Posted by", value: model.createdByName.trim() });

  return (
    <article className="bos-inv-paper" aria-label="Material return" style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <PaperBrandHead name={seller.name} logoUrl={seller.logoUrl} detail={sellerDetail(seller)} />
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">MATERIAL RETURN</div>
          <span className="ims-paper-stamp" style={{ color: stamp.color }}>
            {stamp.text}
          </span>
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
          <div className="bos-inv-paper-label">Returned from</div>
          <div className="bos-inv-paper-value">{model.customerName || "—"}</div>
          {model.location ? <div className="ims-paper-sub">{model.location}</div> : null}
        </div>
        <div>
          <div className="bos-inv-paper-label">Stock to</div>
          <div className="bos-inv-paper-value">{seller.name || "Store"}</div>
          <div className="ims-paper-sub">Unused materials against {model.dcDocNo || "DC"}</div>
        </div>
      </div>

      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Qty returned</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {model.lines.length ? (
            model.lines.map((l, i) => (
              <tr key={`${l.description}-${i}`}>
                <td>{i + 1}</td>
                <td style={{ whiteSpace: "normal" }}>{l.description || "—"}</td>
                <td>{qtyText(l.qty, l.unit)}</td>
                <td style={{ whiteSpace: "normal" }}>{l.remarks?.trim() || "—"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="bos-inv-paper-empty">
                No return quantities yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {model.notes ? <div className="bos-inv-notes">{model.notes}</div> : null}

      <div className="ims-paper-sign">
        <div>
          <div className="ims-paper-sign-line" />
          Returned by / site
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          Received in store · {seller.name}
        </div>
      </div>
    </article>
  );
}
