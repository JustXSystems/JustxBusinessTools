export type DocumentParty = {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  state: string;
};

export type DocumentItem = {
  id: number;
  name: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
};

export type DocumentState = {
  id: string | null;
  docNo: string;
  docDate: string;
  extraDate: string;
  party: DocumentParty;
  items: DocumentItem[];
  igstPct: number;
  cgstPct: number;
  sgstPct: number;
  cgstSgstEnabled: boolean;
  notes: string;
  status: "draft" | "saved";
};

export type DocumentListItem = {
  id: string;
  docNo: string;
  partyName: string;
  docDate: string;
  grandTotal: number;
  status: string;
};

export type ComputedLineItem = DocumentItem & {
  taxable: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  total: number;
};

export type DocumentTotals = {
  computed: ComputedLineItem[];
  totalQty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grand: number;
};
