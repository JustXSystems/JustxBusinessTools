import type { DocumentConfig } from "@/config/tools.config";
import type { BusinessProfile } from "@/lib/types/business-profile";
import type { DocumentState } from "@/lib/types/document";
import { docComputeTotals, wordsTotal } from "@/lib/document-math";
import { fmtDate, fmtINR } from "@/lib/format";

type Props = {
  config: DocumentConfig;
  state: DocumentState;
  profile: BusinessProfile;
};

export function DocumentPreview({ config, state, profile }: Props) {
  const { computed, totalQty, taxable, cgst, sgst, igst, totalTax, grand } =
    docComputeTotals(state);
  const words = wordsTotal(grand);

  return (
    <div className="doc-preview">
      <div className="dp-header">
        <div>
          {profile.logo ? (
            <img className="dp-logo" src={profile.logo} alt="" />
          ) : (
            <div className="dp-company-name">{profile.businessName || "Your Business"}</div>
          )}
          {profile.logo ? (
            <div className="dp-company-name">{profile.businessName || "Your Business"}</div>
          ) : null}
          {profile.addressLine1 ? <p>{profile.addressLine1}</p> : null}
          {profile.addressLine2 ? <p>{profile.addressLine2}</p> : null}
          {profile.gstin ? <p><b>GSTIN:</b> {profile.gstin}</p> : null}
        </div>
        <div className="text-right">
          <p><b>{config.docLabel} No.:</b> {state.docNo}</p>
          <p><b>Date:</b> {fmtDate(state.docDate)}</p>
          <p><b>{config.extraDateLabel}:</b> {fmtDate(state.extraDate)}</p>
        </div>
      </div>

      <div className="dp-title-bar">{config.docLabel}</div>

      <div className="doc-two-col">
        <div>
          <p className="fw-800">{config.partyLabel}</p>
          <p>{state.party.name || "—"}</p>
          <p>{state.party.address}</p>
          <p>{state.party.phone}</p>
          {state.party.gstin ? <p>GSTIN: {state.party.gstin}</p> : null}
          <p>{state.party.state}</p>
        </div>
        <div>
          <p className="fw-800">Summary</p>
          <p>Items: {state.items.length}</p>
          <p>Total Qty: {totalQty}</p>
          <p>Grand Total: ₹{fmtINR(grand)}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>HSN</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {computed.map((it, idx) => (
            <tr key={it.id}>
              <td>{idx + 1}</td>
              <td>{it.name}</td>
              <td>{it.hsn}</td>
              <td className="num">{it.qty} {it.unit}</td>
              <td className="num">{fmtINR(it.rate)}</td>
              <td className="num">{fmtINR(it.total)}</td>
            </tr>
          ))}
          <tr className="fw-800">
            <td colSpan={5} className="num">Total</td>
            <td className="num">₹{fmtINR(grand)}</td>
          </tr>
        </tbody>
      </table>

      <div className="doc-two-col">
        <div>
          <p className="fw-800">Amount in Words</p>
          <p>{words}</p>
        </div>
        <div>
          <p><b>Taxable:</b> ₹{fmtINR(taxable)}</p>
          {state.cgstSgstEnabled ? (
            <>
              <p><b>CGST:</b> ₹{fmtINR(cgst)}</p>
              <p><b>SGST:</b> ₹{fmtINR(sgst)}</p>
            </>
          ) : (
            <p><b>IGST:</b> ₹{fmtINR(igst)}</p>
          )}
          <p className="fw-800">Grand Total: ₹{fmtINR(grand)}</p>
        </div>
      </div>

      {state.notes ? (
        <div className="mt-10">
          <p className="fw-800">Notes</p>
          <p>{state.notes}</p>
        </div>
      ) : null}

      {profile.bankAccount ? (
        <div className="doc-two-col">
          <div>
            <p className="fw-800">Bank Details</p>
            <p>{profile.bankName}, {profile.bankBranch}</p>
            <p>A/C: {profile.bankAccount}</p>
            <p>IFSC: {profile.bankIfsc}</p>
          </div>
          <div>
            <p className="fw-800">Terms</p>
            <p className="pre-wrap">{profile.terms ?? ""}</p>
          </div>
        </div>
      ) : null}

      <p className="doc-muted-foot">
        Generated with JustXSystems
      </p>
    </div>
  );
}
