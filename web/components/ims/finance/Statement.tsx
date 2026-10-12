"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components/bos";
import { finance, STATEMENT_KIND_LABEL, type Statement } from "@/lib/ims/finance";
import { dateLabel, downloadCsv, inrExact } from "@/lib/ims/format";
import { Loaded, useIms, useImsData, usePrint } from "../core";
import { PeriodSelect, sellerOf, type PeriodOrAll } from "./shared";

/** Positive = the party owes you (Dr), negative = you owe them (Cr). */
export const balanceText = (n: number): string => (Math.abs(n) < 0.005 ? inrExact(0) : `${inrExact(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);

export function StatementPaper({ data }: { data: Statement }) {
  const { session } = useIms();
  const seller = sellerOf(session);
  const p = data.party;
  return (
    <article className="bos-inv-paper" aria-label={`Statement of account — ${p.name}`} style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{seller.name || "Your business"}</div>
          <div className="ims-paper-seller">{[seller.address, seller.state, seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.phone, seller.email].filter(Boolean).join("\n")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">STATEMENT</div>
          <div className="ims-paper-sub">
            {dateLabel(data.range.from)} – {dateLabel(data.range.to)}
          </div>
        </div>
      </div>
      <div className="bos-inv-paper-meta">
        <div>
          <div className="bos-inv-paper-label">Account of</div>
          <div className="bos-inv-paper-value">{p.name}</div>
          <div className="ims-paper-sub">{[p.address, p.state, p.gstin ? `GSTIN ${p.gstin}` : null, p.mobile, p.email].filter(Boolean).join("\n")}</div>
        </div>
        <div className="fin-paper-grid">
          <div>
            <b>Opening balance</b>
            {balanceText(data.opening)}
          </div>
          <div>
            <b>Closing balance</b>
            {balanceText(data.closing)}
          </div>
          {p.creditLimit ? (
            <div>
              <b>Credit limit</b>
              {inrExact(p.creditLimit)}
            </div>
          ) : null}
        </div>
      </div>
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Particulars</th>
            <th>Ref</th>
            <th className="fin-paper-num">Debit</th>
            <th className="fin-paper-num">Credit</th>
            <th className="fin-paper-num">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{dateLabel(data.range.from)}</td>
            <td style={{ whiteSpace: "normal" }}>Opening balance</td>
            <td>—</td>
            <td className="fin-paper-num">—</td>
            <td className="fin-paper-num">—</td>
            <td className="fin-paper-num">{balanceText(data.opening)}</td>
          </tr>
          {data.rows.map((r, i) => (
            <tr key={`${r.kind}-${r.ref ?? ""}-${i}`}>
              <td>{dateLabel(r.date)}</td>
              <td style={{ whiteSpace: "normal" }}>
                {r.description}
                <small>{STATEMENT_KIND_LABEL[r.kind]}</small>
              </td>
              <td>{r.ref || "—"}</td>
              <td className="fin-paper-num">{r.debit ? inrExact(r.debit) : "—"}</td>
              <td className="fin-paper-num">{r.credit ? inrExact(r.credit) : "—"}</td>
              <td className="fin-paper-num">{balanceText(r.balance)}</td>
            </tr>
          ))}
          {!data.rows.length ? (
            <tr>
              <td colSpan={6} className="bos-inv-paper-empty">
                No transactions in this period
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="bos-inv-totals" style={{ width: 300 }}>
        <div className="bos-inv-totals-row">
          <span>Total debit</span>
          <span>{inrExact(data.totals.debit)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Total credit</span>
          <span>{inrExact(data.totals.credit)}</span>
        </div>
        <div className="bos-inv-totals-row is-total">
          <span>{data.closing > 0.005 ? "Balance due to us" : data.closing < -0.005 ? "Balance payable by us" : "Settled"}</span>
          <span>{inrExact(Math.abs(data.closing))}</span>
        </div>
      </div>
      <div className="bos-inv-notes">Debit = amount owed to {seller.name || "us"}; Credit = payments, returns and amounts we owe. Please report any discrepancy within 7 days.</div>
    </article>
  );
}

export function exportStatement(data: Statement) {
  downloadCsv(`statement-${data.party.name.replace(/[^\w]+/g, "-").toLowerCase()}`, [{ date: data.range.from, kind: "opening" as const, ref: null, description: "Opening balance", debit: 0, credit: 0, module: null, open: null, balance: data.opening }, ...data.rows], [
    { header: "Date", value: (r) => r.date },
    { header: "Type", value: (r) => STATEMENT_KIND_LABEL[r.kind] },
    { header: "Particulars", value: (r) => r.description },
    { header: "Ref", value: (r) => r.ref },
    { header: "Debit", value: (r) => r.debit || "" },
    { header: "Credit", value: (r) => r.credit || "" },
    { header: "Balance (+ they owe)", value: (r) => r.balance },
  ]);
}

/** Statement of account for one party in a dialog, with print and CSV export. */
export function StatementDialog({ party, onClose }: { party: { id: string | null; name: string } | null; onClose: () => void }) {
  return party ? <StatementDialogBody party={party} onClose={onClose} /> : null;
}

function StatementDialogBody({ party, onClose }: { party: { id: string | null; name: string }; onClose: () => void }) {
  const [period, setPeriod] = useState<PeriodOrAll>("fytd");
  const print = usePrint();
  const state = useImsData(() => finance.statement({ partyId: party.id, partyName: party.id ? undefined : party.name, period }), [party.id, party.name, period]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Statement of account · ${party.name}`}
      wide
      actions={
        <>
          <Button variant="ghost" icon="download" disabled={!state.data} onClick={() => state.data && exportStatement(state.data)}>
            Export CSV
          </Button>
          <Button variant="primary" icon="printer" disabled={!state.data} onClick={print}>
            Print
          </Button>
        </>
      }
    >
      <div className="fin-xl">
        <div style={{ marginBottom: 12 }}>
          <PeriodSelect value={period} onChange={setPeriod} />
        </div>
        <Loaded state={state} rows={2}>
          {(d) => <StatementPaper data={d} />}
        </Loaded>
      </div>
    </Dialog>
  );
}
