import type { BusinessProfile } from "@/lib/types/business-profile";
import type { SessionUser } from "@/lib/types/auth";
import type { CartQuote, CheckoutResult, SubscriptionInfo, UpiClaimResult } from "@/lib/types/subscription";
import type { NotificationsPayload } from "@/lib/types/notification";
import type { ToolRecord, ToolUsage } from "@/lib/types/tool-record";
import { apiUrl } from "@/lib/api-base";

export class ApiError extends Error {
  code?: string;
  limit?: number;

  constructor(message: string, code?: string, limit?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.limit = limit;
  }
}

export type Client = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  created_at: string;
};

export type Invoice = {
  id: number;
  client_id: number;
  invoice_number: string;
  amount: number | string;
  status: "draft" | "sent" | "paid" | "overdue";
  issue_date: string;
  due_date: string;
  notes: string | null;
  client_name?: string;
  client_company?: string | null;
};

export type Task = {
  id: number;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done";
  due_date: string | null;
};

export type Expense = {
  id: number;
  category: string;
  amount: number | string;
  description: string | null;
  expense_date: string;
};

export type Stats = {
  clients: number;
  invoices: number;
  paid: number;
  outstanding: number;
  tasks: number;
  taskBreakdown: { todo: number; in_progress: number; done: number };
  expenses: number;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(`/api${path}`), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const payload = data as { error?: string; limit?: number; details?: string[] };
    const detailText = Array.isArray(payload.details) ? payload.details.join(", ") : "";
    const message = detailText || payload.error || "Request failed";
    throw new ApiError(message, payload.error, payload.limit);
  }
  return data as T;
}

export function money(value: number | string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

export async function fetchProfile(): Promise<BusinessProfile> {
  return api<BusinessProfile>("/profile");
}

export async function saveProfile(profile: Partial<BusinessProfile>): Promise<BusinessProfile> {
  return api<BusinessProfile>("/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export async function fetchToolUsage(toolId: string): Promise<ToolUsage> {
  return api<ToolUsage>(`/tools/${toolId}/usage`);
}

export async function fetchToolRecords(toolId: string): Promise<ToolRecord[]> {
  return api<ToolRecord[]>(`/tools/${toolId}/records`);
}

export async function createToolRecord(
  toolId: string,
  data: Record<string, unknown>,
  id?: string,
): Promise<ToolRecord> {
  return api<ToolRecord>(`/tools/${toolId}/records`, {
    method: "POST",
    body: JSON.stringify({ id, data }),
  });
}

export async function updateToolRecord(
  toolId: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<ToolRecord> {
  return api<ToolRecord>(`/tools/${toolId}/records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

export async function deleteToolRecord(toolId: string, recordId: string): Promise<void> {
  return api<void>(`/tools/${toolId}/records/${recordId}`, { method: "DELETE" });
}

export type DocSequence = { docNo: string; prefix: string; year: number; month: number; seq: number };

export async function fetchNextDocNumber(toolId: string): Promise<DocSequence> {
  return api<DocSequence>(`/sequences/${toolId}/next`, { method: "POST" });
}

export async function fetchDocumentList(toolId: string) {
  return api<import("@/lib/types/document").DocumentListItem[]>(`/documents/${toolId}`);
}

export async function fetchDocument(toolId: string, id: string) {
  return api<import("@/lib/types/document").DocumentState & { id: string }>(
    `/documents/${toolId}/${id}`,
  );
}

export async function createDocument(toolId: string, state: Record<string, unknown>) {
  return api(`/documents/${toolId}`, {
    method: "POST",
    body: JSON.stringify(state),
  });
}

export async function updateDocument(
  toolId: string,
  id: string,
  state: Record<string, unknown>,
) {
  return api(`/documents/${toolId}/${id}`, {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

export async function deleteDocument(toolId: string, id: string): Promise<void> {
  return api<void>(`/documents/${toolId}/${id}`, { method: "DELETE" });
}

export async function fetchSubscription(): Promise<SubscriptionInfo> {
  return api<SubscriptionInfo>("/subscription");
}

export async function fetchCartQuote(toolIds: string[]): Promise<CartQuote> {
  const tools = encodeURIComponent(toolIds.join(","));
  return api<CartQuote>(`/subscription/quote?tools=${tools}`);
}

export async function startCheckout(
  planId: string,
  toolIds?: string[],
  extra?: { gatewayId?: number; method?: string },
): Promise<CheckoutResult> {
  return api<CheckoutResult>("/subscription/checkout", {
    method: "POST",
    body: JSON.stringify({
      planId,
      ...(toolIds?.length ? { toolIds } : {}),
      ...(extra?.gatewayId ? { gatewayId: extra.gatewayId } : {}),
      ...(extra?.method ? { method: extra.method } : {}),
    }),
  });
}

export async function submitUpiClaim(body: {
  toolIds: string[];
  payerName: string;
  payerEmail: string;
  payerPhone?: string;
  payerUpi?: string;
  utr: string;
  paidAt?: string;
  notes?: string;
}): Promise<UpiClaimResult> {
  return api<UpiClaimResult>("/subscription/upi-claims", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function cancelProSubscription(toolIds?: string[]): Promise<SubscriptionInfo> {
  return api<SubscriptionInfo>("/subscription/cancel", {
    method: "POST",
    body: JSON.stringify(toolIds?.length ? { toolIds } : {}),
  });
}

export async function fetchNotifications(): Promise<NotificationsPayload> {
  return api<NotificationsPayload>("/notifications");
}

export async function requestPhoneOtp(phone: string): Promise<void> {
  await api("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function verifyPhoneOtp(phone: string, code: string): Promise<SessionUser> {
  const data = await api<{ user: SessionUser }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
  return data.user;
}
