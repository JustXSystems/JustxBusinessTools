/**
 * Typed client for the Justx IMS-Dealer API (`/api/ims/*`). Area clients
 * (`purchase.ts`, `finance.ts`…) build on the request helpers exported here.
 */
import { apiUrl } from "@/lib/api-base";

export class ImsApiError extends Error {
  status: number;
  code?: string;
  details?: string[];

  constructor(status: number, message: string, code?: string, details?: string[]) {
    super(message);
    this.name = "ImsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get schemaPending(): boolean {
    return this.code === "IMS_SCHEMA_PENDING";
  }

  /** IMS isn't Live for the caller's org yet (Admin → Tools → Justx IMS — Dealer). */
  get notEnabled(): boolean {
    return this.code === "IMS_NOT_ENABLED";
  }

  get insufficientStock(): boolean {
    return this.code === "IMS_INSUFFICIENT_STOCK";
  }
}

export async function imsApi<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetch(apiUrl(`/api/ims${path}`), {
    method,
    credentials: "include",
    cache: "no-store",
    signal: init?.signal,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const details = Array.isArray(data.details) ? (data.details as string[]) : undefined;
    const message = details?.length ? details.join(" · ") : typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new ImsApiError(res.status, message, typeof data.code === "string" ? data.code : undefined, details);
  }
  return data as T;
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong");

export type QueryValue = string | number | boolean | null | undefined;
export const qs = (params: Record<string, QueryValue>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const get = <T>(path: string, params?: Record<string, QueryValue>) => imsApi<T>(`${path}${params ? qs(params) : ""}`);
export const post = <T>(path: string, body?: unknown) => imsApi<T>(path, { method: "POST", body: body ?? {} });
export const put = <T>(path: string, body: unknown) => imsApi<T>(path, { method: "PUT", body });
export const patch = <T>(path: string, body: unknown) => imsApi<T>(path, { method: "PATCH", body });
export const del = <T = void>(path: string) => imsApi<T>(path, { method: "DELETE" });

/* ---------- Shared vocabulary (mirrors server/src/ims/logic.ts) ---------- */

export type ImsRole = "owner" | "manager" | "incharge" | "staff" | "accountant" | "auditor" | "field" | "viewer";
export type ImsPermission =
  | "stockIn"
  | "stockOut"
  | "damage"
  | "stockCheck"
  | "items"
  | "suppliers"
  | "po"
  | "approvals"
  | "sales"
  | "receivables"
  | "payables"
  | "closing"
  | "field"
  | "reports"
  | "integrations"
  | "audit"
  | "settings";
export type PermissionMatrix = Record<Exclude<ImsRole, "owner">, Record<ImsPermission, boolean>>;

export type Period = "today" | "yesterday" | "7d" | "30d" | "mtd" | "lastmonth" | "qtd" | "fytd" | "custom";
export type DateRange = { from: string; to: string };

export type StockStatus = "GOOD" | "LOW" | "OUT_OF_STOCK" | "OVERSTOCK";
export type MovementType = "OPENING" | "IN" | "OUT" | "DAMAGE" | "ADJUSTMENT" | "RETURN_IN" | "RETURN_OUT" | "WRITE_OFF";
export type AgingKey = "0-15" | "16-30" | "31-60" | "61-90" | "90+";

export type Taxonomy = {
  categories: Array<{ name: string; hsn?: string | null; gstRate?: number | null }>;
  brands: string[];
  units: string[];
  locations: string[];
  damageReasons: string[];
  adjustmentReasons: string[];
  returnReasons: string[];
  holdReasons: string[];
  expenseCategories: string[];
};

export type ReminderRuleKey = "3b" | "due" | "7d" | "15d" | "30d" | "60d" | "90d";
export type ReminderTemplate = { key: string; label: string; channel: "whatsapp" | "sms" | "email"; subject?: string; body: string };
export type ReminderSettings = { autoEnabled: boolean; rules: Record<ReminderRuleKey, boolean>; channels: Array<"whatsapp" | "sms" | "email">; templates: ReminderTemplate[] };

export type ImsSettings = {
  businessName: string;
  businessType: string;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  fiscalYearStart: number;
  poPrefix: string;
  invoicePrefix: string;
  billPrefix: string;
  returnPrefix: string;
  checkPrefix: string;
  ticketPrefix: string;
  poApprovalLimit: number;
  draftPoPurgeDays: number;
  paymentTermsDays: number;
  defaultGstRate: number;
  allowNegativeStock: boolean;
  exciseEnabled: boolean;
  /** Excise applies (enabled, or a liquor / bar business type). */
  exciseActive: boolean;
  permissions: PermissionMatrix;
  taxonomy: Taxonomy;
  reminders: ReminderSettings;
  terms: string | null;
};

export type ImsSourceRef = { id: string; label: string; icon: string; href: string; description: string; kind: "documents" | "catalog" };

export type ImsBrand = { name: string; logoUrl: string | null; gstin: string | null; state: string | null; address: string | null; phone: string | null; email: string | null };

export type ImsSession = {
  host: string;
  tenantId: number;
  actor: { userId: number | null; name: string | null; email: string | null; platformRole: string };
  access: { role: ImsRole; roleLabel: string; perms: ImsPermission[] };
  settings: ImsSettings;
  brand: ImsBrand | null;
  sources: ImsSourceRef[];
  catalogs: ImsSourceRef[];
  today: string;
};

/* ---------- Workspace ---------- */

export type ImsModuleKey =
  | "dashboard"
  | "items"
  | "stock"
  | "stockin"
  | "stockout"
  | "checks"
  | "lowstock"
  | "returns"
  | "history"
  | "scanner"
  | "parties"
  | "purchase"
  | "approvals"
  | "sales"
  | "receivables"
  | "payables"
  | "ledger"
  | "closing"
  | "field"
  | "reports"
  | "gst"
  | "excise"
  | "audit"
  | "integrations"
  | "connect"
  | "helpdesk"
  | "settings"
  | "more";

export type ImsNotification = { id: string; tone: "coral" | "amber" | "blue" | "emerald"; title: string; body: string; module: ImsModuleKey; open?: string; at: string | null };

export type ImsDashboard = {
  today: string;
  range: DateRange;
  kpis: {
    totalItems: number;
    stockValue: number;
    retailValue: number;
    lowStock: number;
    outOfStock: number;
    overStock: number;
    goodStock: number;
    damagedUnits: number;
    stockIn: number;
    stockOut: number;
    damaged: number;
    salesValue: number;
    todayIn: number;
    todayOut: number;
    todayEntries: number;
    salesMtd: number;
    receivable: number;
    overdue: number;
    overdueCount: number;
    payable: number;
    pendingApprovals: number;
  };
  pending: { po: number; bills: number; checks: number };
  aging: Array<{ key: AgingKey; label: string; color: string; items: number; value: number }>;
  categories: Array<{ category: string; items: number; units: number; value: number }>;
  series: Array<{ date: string; in: number; out: number }>;
  topMovers: Array<{ itemId: string; name: string; qty: number; value: number }>;
  recent: Array<{ id: string; itemId: string; itemName: string; type: MovementType; qty: number; after: number; refNo: string | null; partyName: string | null; actorName: string | null; createdAt: string | null }>;
  notifications: ImsNotification[];
};

export type ImsEvent = { id: number; actorName: string | null; type: string; entityType: string | null; entityId: string | null; summary: string; createdAt: string | null };

export type ImsSearchResult = { kind: "item" | "party" | "invoice" | "po" | "bill"; id: string; title: string; sub: string; module: ImsModuleKey; open: string };

/* ---------- Settings & team ---------- */

export type ImsMember = {
  userId: number;
  name: string | null;
  email: string | null;
  platformRole: string;
  imsRole: ImsRole;
  phone: string | null;
  isAccountManager: boolean;
  active: boolean;
  locked: boolean;
};

export type ImsSettingsMeta = {
  settings: ImsSettings;
  businessTypes: ReadonlyArray<{ key: string; label: string }>;
  permissionKeys: ReadonlyArray<{ key: ImsPermission; label: string }>;
  roles: ImsRole[];
  defaults: PermissionMatrix;
};

/* ---------- Inventory ---------- */

export type ImsItem = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gstRate: number;
  supplierId: string | null;
  supplierName: string | null;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number | null;
  currentStock: number;
  damagedStock: number;
  minStock: number;
  maxStock: number | null;
  reorderQty: number | null;
  suggestedReorder: number;
  location: string | null;
  volumeMl: number | null;
  exciseCategory: string | null;
  notes: string | null;
  active: boolean;
  status: StockStatus;
  stockValue: number;
  idleDays: number;
  agingBucket: AgingKey;
  movement30d: number;
  lastMovementAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ItemInput = {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  brand?: string | null;
  unit?: string;
  hsn?: string | null;
  gstRate?: number;
  supplierId?: string | null;
  purchasePrice?: number;
  sellingPrice?: number;
  mrp?: number | null;
  minStock?: number;
  maxStock?: number | null;
  reorderQty?: number | null;
  location?: string | null;
  volumeMl?: number | null;
  exciseCategory?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type ItemList = {
  items: ImsItem[];
  facets: { categories: string[]; brands: string[]; units: string[] };
  summary: { count: number; value: number; units: number; low: number; out: number; over: number; damaged: number };
};

export type ImsMovement = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  unit: string | null;
  category: string | null;
  type: MovementType;
  qty: number;
  delta: number;
  before: number;
  after: number;
  unitCost: number | null;
  unitPrice: number | null;
  value: number;
  refType: string;
  refId: string | null;
  refNo: string | null;
  partyId: string | null;
  partyName: string | null;
  reason: string | null;
  refundStatus: string | null;
  exciseDuty: number | null;
  notes: string | null;
  date: string;
  actorName: string | null;
  createdAt: string | null;
};

export type PostedMovement = { id: string; itemId: string; itemName: string; type: MovementType; qty: number; delta: number; before: number; after: number; value: number };

export type MovementInput = {
  type: MovementType;
  lines: Array<{ itemId: string; qty: number; unitCost?: number | null; unitPrice?: number | null; exciseDuty?: number | null; notes?: string | null }>;
  partyId?: string | null;
  partyName?: string | null;
  refNo?: string | null;
  reason?: string | null;
  refundStatus?: string | null;
  notes?: string | null;
  date?: string;
  damaged?: boolean;
};

export type CheckStatus = "counting" | "submitted" | "approved" | "adjusted" | "cancelled";
export type CheckLine = { itemId: string; name: string; sku: string | null; unit: string; category: string | null; systemQty: number; physicalQty: number | null; difference: number; unitCost: number; note: string | null };
export type ImsStockCheck = {
  id: string;
  checkNo: string;
  title: string;
  status: CheckStatus;
  scope: { category?: string | null; location?: string | null; lowOnly?: boolean; itemIds?: number };
  itemCount: number;
  countedCount: number;
  mismatchCount: number;
  varianceQty: number;
  varianceValue: number;
  notes: string | null;
  countedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines?: CheckLine[];
};

export type RefundStatus = "none" | "pending" | "refunded" | "credit_note";
export type ImsReturn = {
  id: string;
  returnNo: string;
  kind: "customer" | "supplier";
  status: "open" | "completed" | "cancelled";
  partyId: string | null;
  partyName: string;
  refDocId: string | null;
  refDocNo: string | null;
  date: string;
  lines: Array<{ itemId: string; name: string; unit: string | null; qty: number; rate: number; amount: number }>;
  total: number;
  reason: string | null;
  disposition: "restock" | "damaged";
  refundStatus: RefundStatus;
  refundAmount: number;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export type ReturnInput = {
  kind: "customer" | "supplier";
  partyId?: string | null;
  partyName: string;
  refDocId?: string | null;
  refDocNo?: string | null;
  date?: string;
  lines: Array<{ itemId: string; qty: number; rate?: number }>;
  reason?: string | null;
  disposition?: "restock" | "damaged";
  refundStatus?: RefundStatus;
  refundAmount?: number;
  notes?: string | null;
};

export type LowStockGroup = { supplierId: string | null; supplierName: string; items: ImsItem[]; value: number };

/* ---------- Parties (minimal shape every picker relies on; full shape in purchase.ts) ---------- */

export type PartyKind = "supplier" | "customer" | "both";
export type PartyOption = {
  id: string;
  kind: PartyKind;
  name: string;
  contactPerson: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  paymentTermsDays: number | null;
  creditLimit: number | null;
};

/* ---------- Endpoints ---------- */

export const ims = {
  session: () => get<ImsSession>("/session"),
  dashboard: (params: { period?: Period; from?: string; to?: string } = {}) => get<ImsDashboard>("/dashboard", params),
  notifications: () => get<{ notifications: ImsNotification[] }>("/notifications"),
  events: (params: { entityType?: string; entityId?: string; q?: string; from?: string; to?: string; limit?: number } = {}) => get<{ events: ImsEvent[] }>("/events", params),
  search: (q: string) => get<{ results: ImsSearchResult[] }>("/search", { q }),

  settings: () => get<ImsSettingsMeta>("/settings"),
  saveSettings: (input: Partial<Omit<ImsSettings, "exciseActive">>) => put<{ settings: ImsSettings }>("/settings", input),
  team: () => get<{ members: ImsMember[]; canManage: boolean }>("/team"),
  saveMember: (userId: number, input: { imsRole?: Exclude<ImsRole, "owner">; phone?: string | null; displayName?: string | null; isAccountManager?: boolean; active?: boolean }) =>
    put<{ members: ImsMember[] }>(`/team/${userId}`, input),

  items: (params: { q?: string; category?: string; brand?: string; supplierId?: string; status?: StockStatus | "ATTENTION"; includeInactive?: boolean } = {}) => get<ItemList>("/items", params),
  item: (id: string) => get<{ item: ImsItem; movements: ImsMovement[]; stats90d: Partial<Record<MovementType, { qty: number; value: number }>> }>(`/items/${id}`),
  lookupItem: (code: string) => get<{ item: ImsItem | null }>("/items/lookup", { code }),
  createItem: (input: ItemInput & { openingStock?: number }) => post<{ item: ImsItem }>("/items", input),
  updateItem: (id: string, input: Partial<ItemInput>) => patch<{ item: ImsItem }>(`/items/${id}`, input),
  deleteItem: (id: string) => del<{ archived?: boolean } | undefined>(`/items/${id}`),
  importItems: (items: Array<Record<string, unknown>>) => post<{ created: number; updated: number; errors: string[] }>("/items/bulk", { items }),
  inventoryMeta: () => get<{ taxonomy: Taxonomy; suppliers: Array<{ id: string; name: string }>; allowNegativeStock: boolean; canSeeCost: boolean }>("/inventory/meta"),

  postMovements: (input: MovementInput) => post<{ movements: PostedMovement[] }>("/movements", input),
  movements: (params: { period?: Period; from?: string; to?: string; type?: string; itemId?: string; partyId?: string; q?: string; limit?: number } = {}) =>
    get<{ range: DateRange; movements: ImsMovement[]; totals: Partial<Record<MovementType, { qty: number; value: number; count: number }>> }>("/movements", params),
  lowStock: () => get<{ items: ImsItem[]; bySupplier: LowStockGroup[] }>("/low-stock"),

  checks: () => get<{ checks: ImsStockCheck[] }>("/checks"),
  check: (id: string) => get<{ check: ImsStockCheck }>(`/checks/${id}`),
  createCheck: (input: { title: string; category?: string | null; location?: string | null; itemIds?: string[]; lowOnly?: boolean; notes?: string | null }) => post<{ check: ImsStockCheck }>("/checks", input),
  saveCount: (id: string, input: { lines: Array<{ itemId: string; physicalQty: number | null; note?: string | null }>; notes?: string | null }) => patch<{ check: ImsStockCheck }>(`/checks/${id}`, input),
  submitCheck: (id: string) => post<{ check: ImsStockCheck }>(`/checks/${id}/submit`),
  approveCheck: (id: string) => post<{ check: ImsStockCheck }>(`/checks/${id}/approve`),
  rejectCheck: (id: string, note?: string) => post<{ check: ImsStockCheck }>(`/checks/${id}/reject`, { note }),
  cancelCheck: (id: string) => post<{ check: ImsStockCheck }>(`/checks/${id}/cancel`),

  /** Active parties for pickers. `supplier` / `customer` also include `both`. */
  partyOptions: (kind?: "supplier" | "customer", q?: string) => get<{ parties: PartyOption[] }>("/parties", { kind, q }),

  returns: (kind?: "customer" | "supplier") => get<{ returns: ImsReturn[]; damage: ImsMovement[]; quarantine: ImsItem[] }>("/returns", { kind }),
  createReturn: (input: ReturnInput) => post<{ return: ImsReturn }>("/returns", input),
  updateReturn: (id: string, input: { refundStatus?: RefundStatus; refundAmount?: number; notes?: string | null }) => patch<{ return: ImsReturn }>(`/returns/${id}`, input),
  cancelReturn: (id: string) => post<{ ok: true }>(`/returns/${id}/cancel`),
};
