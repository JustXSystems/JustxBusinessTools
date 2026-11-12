"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiUrl } from "@/lib/api-base";

type PublicLine = {
  id: string;
  section: string;
  description: string;
  makeText: string | null;
  sku: string | null;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
};

type PublicBom = {
  docNo: string;
  status: string;
  docDate: string;
  capacityLabel: string | null;
  title: string | null;
  customerName: string;
  location: string | null;
  notes: string | null;
  materialsTotal: number;
  marginAmount: number;
  taxAmount: number;
  grandTotal: number;
  proposalStatus: string | null;
  proposalResponseNote: string | null;
  lines: PublicLine[];
  businessName: string;
};

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
        setDoc(data.doc as PublicBom);
        const name = String((data.doc as PublicBom)?.customerName ?? "").trim();
        if (name) setResponderName((prev) => prev || name);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const sections = useMemo(() => {
    const map = new Map<string, PublicLine[]>();
    for (const line of doc?.lines ?? []) {
      const list = map.get(line.section) ?? [];
      list.push(line);
      map.set(line.section, list);
    }
    return [...map.entries()];
  }, [doc]);

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
      setDoc(data.doc as PublicBom);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !doc) {
    return (
      <main style={{ maxWidth: 720, margin: "48px auto", padding: 24, fontFamily: "Georgia, serif" }}>
        <h1>Proposal unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!doc) {
    return (
      <main style={{ maxWidth: 720, margin: "48px auto", padding: 24, fontFamily: "Georgia, serif" }}>
        <p>Loading proposal…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 880, margin: "32px auto", padding: "24px 20px 64px", fontFamily: "Georgia, 'Times New Roman', serif", color: "#1a1a1a" }}>
      <header style={{ borderBottom: "2px solid #1a1a1a", paddingBottom: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7 }}>{doc.businessName}</div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 32, fontWeight: 600 }}>{doc.title || "Materials proposal"}</h1>
        <p style={{ margin: 0, fontSize: 15 }}>
          {doc.docNo} · {doc.docDate}
          {doc.capacityLabel ? ` · ${doc.capacityLabel}` : ""}
        </p>
        <p style={{ margin: "8px 0 0" }}>
          For <strong>{doc.customerName || "Customer"}</strong>
          {doc.location ? ` · ${doc.location}` : ""}
        </p>
      </header>

      {sections.map(([section, lines]) => (
        <section key={section} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 12px", borderBottom: "1px solid #ccc", paddingBottom: 6 }}>{section}</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 4px" }}>Description</th>
                <th style={{ padding: "6px 4px" }}>Qty</th>
                <th style={{ padding: "6px 4px" }}>Rate</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px 4px" }}>
                    <div>{l.description}</div>
                    {l.makeText || l.sku ? (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {[l.makeText, l.sku].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                    {l.qty} {l.unit}
                  </td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>{inr(l.rate)}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <aside style={{ marginTop: 8, padding: 16, background: "#f6f4ef", borderRadius: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>Materials</span>
          <strong>{inr(doc.materialsTotal)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>Margin</span>
          <strong>{inr(doc.marginAmount)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>Tax</span>
          <strong>{inr(doc.taxAmount)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, marginTop: 8 }}>
          <span>Grand total</span>
          <strong>{inr(doc.grandTotal)}</strong>
        </div>
      </aside>

      {doc.notes ? (
        <p style={{ marginTop: 20, fontSize: 14, opacity: 0.85 }}>
          <strong>Notes:</strong> {doc.notes}
        </p>
      ) : null}

      <section style={{ marginTop: 36, paddingTop: 20, borderTop: "1px solid #ccc" }}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>Your response</h2>
        {doc.proposalStatus === "accepted" || doc.proposalStatus === "rejected" ? (
          <p>
            This proposal was <strong>{doc.proposalStatus}</strong>
            {doc.proposalResponseNote ? `: ${doc.proposalResponseNote}` : "."}
          </p>
        ) : canDecide ? (
          <>
            <label style={{ display: "block", marginBottom: 12, fontSize: 14 }}>
              Your name
              <input
                value={responderName}
                onChange={(e) => setResponderName(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 15 }}
              />
            </label>
            <label style={{ display: "block", marginBottom: 16, fontSize: 14 }}>
              Note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 15 }}
              />
            </label>
            {error ? <p style={{ color: "#a33" }}>{error}</p> : null}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide("accepted")}
                style={{ padding: "12px 20px", background: "#1a1a1a", color: "#fff", border: 0, cursor: "pointer", fontSize: 15 }}
              >
                Accept proposal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide("rejected")}
                style={{ padding: "12px 20px", background: "#fff", color: "#1a1a1a", border: "1px solid #1a1a1a", cursor: "pointer", fontSize: 15 }}
              >
                Reject
              </button>
            </div>
          </>
        ) : (
          <p>This proposal is no longer open for a response ({doc.proposalStatus || "closed"}).</p>
        )}
      </section>
    </main>
  );
}
