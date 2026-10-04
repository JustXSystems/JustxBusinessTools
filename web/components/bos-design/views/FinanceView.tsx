"use client";

import { useState } from "react";
import { AiPill, Button, FilterChip, ModuleToolbar, SearchInput } from "@/components/bos";
import { ModuleWorkspace, type ModuleWorkspaceApi } from "../modules/ModuleWorkspace";
import { FINANCE_MODULES } from "../data/finance";

const INVOICE_KINDS = ["Sales Invoices", "Credit Notes", "Debit Notes", "Templates"] as const;

function InvoiceFilters({ onCreateInvoice }: { onCreateInvoice?: () => void }) {
  const [kind, setKind] = useState<(typeof INVOICE_KINDS)[number]>("Sales Invoices");
  return (
    <div className="bos-row-between" style={{ flexWrap: "wrap", gap: 8 }}>
      <div className="bos-row" style={{ gap: 8 }} role="group" aria-label="Invoice type">
        {INVOICE_KINDS.map((k) => (
          <FilterChip key={k} active={k === kind} aria-pressed={k === kind} onClick={() => setKind(k)}>
            {k}
          </FilterChip>
        ))}
      </div>
      <Button size="sm" variant="primary" icon="plus" onClick={onCreateInvoice}>
        Create Invoice
      </Button>
    </div>
  );
}

function DashboardToolbar({ api }: { api: ModuleWorkspaceApi }) {
  return (
    <ModuleToolbar>
      <SearchInput placeholder="Search dashboard…" aria-label="Search dashboard" />
      <AiPill
        action={
          <Button size="sm" variant="ghost" onClick={() => api.navigate("receivables")}>
            Ask AI
          </Button>
        }
      >
        ₹8.4L overdue 30+ days across 3 invoices
      </AiPill>
    </ModuleToolbar>
  );
}

export function FinanceView({ onSearch, onCreateInvoice }: { onSearch?: () => void; onCreateInvoice?: () => void }) {
  return (
    <ModuleWorkspace
      aria-label="Finance & Accounts modules"
      modules={FINANCE_MODULES}
      brandName="Justx Systems"
      accent="emerald"
      onSearch={onSearch}
      renderCustom={(id, api) => {
        if (id === "fin-toolbar") return <DashboardToolbar api={api} />;
        if (id === "fin-invoice-filters") return <InvoiceFilters onCreateInvoice={onCreateInvoice} />;
        return null;
      }}
    />
  );
}
