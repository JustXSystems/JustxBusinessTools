"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiUrl } from "@/lib/api-base";
import {
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperTemplate,
  normalizeBomPaperTone,
  type BomPaperTemplateId,
} from "@/lib/ims/bom-paper";
import { BomPaper, type BomPaperModel } from "@/components/ims/bom/BomPaper";
import "@/components/bos/styles/bos.patterns.css";
import "@/components/ims/bom/bom.css";
import "./proposal.css";

type PublicLine = {
  id: string;
  section: string;
  description: string;
  makeText: string | null;
  sku: string | null;
  hsn?: string | null;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  remarks?: string | null;
  lineKind?: string | null;
  optionalFlag?: boolean | null;
  optionKey?: string | null;
  alternateCount?: number | null;
};

type PublicBusiness = {
  name: string;
  gstin?: string | null;
  address?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  bankUpi?: string | null;
};

type PublicBom = {
  docNo: string;
  status: string;
  docDate: string;
  capacityLabel: string | null;
  title: string | null;
  customerName: string;
  location: string | null;
  customerState?: string | null;
  projectRef?: string | null;
  revision?: number;
  validUntil?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  warrantyTerms?: string | null;
  scopeOfSupply?: string | null;
  exclusions?: string | null;
  notes: string | null;
  preparedBy?: string | null;
  marginPct?: number;
  taxPct?: number;
  materialsTotal: number;
  marginAmount: number;
  taxAmount: number;
  grandTotal: number;
  proposalStatus: string | null;
  proposalResponseNote: string | null;
  lines: PublicLine[];
  business?: PublicBusiness;
  businessName?: string;
  template?: string | null;
  industryPack?: string | null;
  tone?: string | null;
  density?: string | null;
  hideMargin?: boolean | null;
};

function toPaperModel(doc: PublicBom): BomPaperModel {
  const business = doc.business ?? {
    name: doc.businessName || "Your Company",
    gstin: null,
    address: null,
    state: null,
    phone: null,
    email: null,
    logoUrl: null,
  };
  return {
    business: {
      name: business.name,
      gstin: business.gstin ?? null,
      address: business.address ?? null,
      state: business.state ?? null,
      phone: business.phone ?? null,
      email: business.email ?? null,
      logoUrl: business.logoUrl ?? null,
      bankName: business.bankName ?? null,
      bankBranch: business.bankBranch ?? null,
      bankAccount: business.bankAccount ?? null,
      bankIfsc: business.bankIfsc ?? null,
      bankUpi: business.bankUpi ?? null,
    },
    docNo: doc.docNo,
    docDate: doc.docDate,
    status: doc.status,
    title: doc.title || "Materials proposal",
    capacityLabel: doc.capacityLabel || "",
    customerName: doc.customerName || "",
    location: doc.location || "",
    customerState: doc.customerState ?? null,
    projectRef: doc.projectRef ?? null,
    preparedBy: doc.preparedBy ?? null,
    notes: doc.notes,
    revision: doc.revision ?? 1,
    validUntil: doc.validUntil ?? null,
    paymentTerms: doc.paymentTerms ?? null,
    deliveryTerms: doc.deliveryTerms ?? null,
    warrantyTerms: doc.warrantyTerms ?? null,
    scopeOfSupply: doc.scopeOfSupply ?? null,
    exclusions: doc.exclusions ?? null,
    marginPct: Number(doc.marginPct) || 0,
    taxPct: Number(doc.taxPct) || 0,
    template: normalizeBomPaperTemplate(doc.template) as BomPaperTemplateId,
    industryPack: normalizeBomIndustryPack(doc.industryPack),
    tone: normalizeBomPaperTone(doc.tone),
    density: normalizeBomPaperDensity(doc.density),
    hideMargin: Boolean(doc.hideMargin),
    lines: (doc.lines ?? []).map((l) => ({
      section: l.section,
      lineKind: (l.lineKind as BomPaperModel["lines"][number]["lineKind"]) ?? "stock",
      description: l.description,
      makeText: l.makeText,
      sku: l.sku,
      hsn: l.hsn ?? null,
      qty: l.qty,
      unit: l.unit,
      rate: l.rate,
      amount: l.amount,
      remarks: l.remarks ?? null,
      optionalFlag: Boolean(l.optionalFlag),
      optionKey: l.optionKey ?? null,
      alternateCount: Number(l.alternateCount) || 0,
    })),
    totals: {
      materialsTotal: doc.materialsTotal,
      marginAmount: doc.marginAmount,
      taxAmount: doc.taxAmount,
      grandTotal: doc.grandTotal,
    },
  };
}

export default function PublicBomProposalPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [doc, setDoc] = useState<PublicBom | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [responderName, setResponderName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(apiUrl(`/api/public/bom-proposal/${encodeURIComponent(token)}`))
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Proposal not found");
        const proposal = (data.proposal ?? data.doc) as PublicBom | undefined;
        if (!proposal) throw new Error("Proposal not found");
        setDoc(proposal);
        const name = String(proposal.customerName ?? "").trim();
        if (name) setResponderName((prev) => prev || name);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const canDecide = doc?.proposalStatus === "sent" || doc?.proposalStatus === "viewed";

  async function decide(decision: "accepted" | "rejected") {
    const name = responderName.trim();
    if (name.length < 2) {
      setError("Please enter your name before responding.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(apiUrl(`/api/public/bom-proposal/${encodeURIComponent(token)}/decide`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, responderName: name, note: note.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not save your response");
      const proposal = (data.proposal ?? data.doc) as PublicBom | undefined;
      if (!proposal) throw new Error("Could not save your response");
      setDoc(proposal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !doc) {
    return (
      <main className="bom-proposal-public">
        <div className="bom-proposal-public-shell">
          <h1>Proposal unavailable</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="bom-proposal-public">
        <div className="bom-proposal-public-shell">
          <p>Loading proposal…</p>
        </div>
      </main>
    );
  }

  const model = toPaperModel(doc);

  return (
    <main className="bom-proposal-public">
      <div className="bom-proposal-public-shell bos">
        <BomPaper model={model} />

        <section className="bom-proposal-dock no-print" aria-label="Your response">
          <h2>Your response</h2>
          {doc.proposalStatus === "accepted" || doc.proposalStatus === "rejected" ? (
            <p>
              This proposal was <strong>{doc.proposalStatus}</strong>
              {doc.proposalResponseNote ? `: ${doc.proposalResponseNote}` : "."}
            </p>
          ) : canDecide ? (
            <>
              <label>
                Your name
                <input value={responderName} onChange={(e) => setResponderName(e.target.value)} />
              </label>
              <label>
                Note (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </label>
              {error ? <p className="bom-proposal-dock-error">{error}</p> : null}
              <div className="bom-proposal-dock-actions">
                <button type="button" disabled={busy} onClick={() => void decide("accepted")}>
                  Accept proposal
                </button>
                <button type="button" className="is-ghost" disabled={busy} onClick={() => void decide("rejected")}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <p>This proposal is no longer open for a response ({doc.proposalStatus || "closed"}).</p>
          )}
        </section>
      </div>
    </main>
  );
}
