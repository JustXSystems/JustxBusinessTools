import type { BosCalendarEvent, BosCelebration, BosTickerItem } from "@/components/bos";
import type { InvoiceLineItem } from "@/lib/bos/invoice";

export type WorkspaceKey = "design" | "launch" | "hrm" | "invoice" | "finance";

export const WORKSPACES: ReadonlyArray<{ value: WorkspaceKey; label: string }> = [
  { value: "design", label: "Design System" },
  { value: "launch", label: "Launch & Login" },
  { value: "hrm", label: "HR Management" },
  { value: "invoice", label: "Invoice Creator" },
  { value: "finance", label: "Finance & Accounts" },
];

export const TICKER_ITEMS: BosTickerItem[] = [
  { text: "Your leave request was approved", time: "2 days ago", tint: "emerald", icon: "check" },
  { text: "Pending your leave request approval", time: "Today", tint: "amber", icon: "clock" },
  { text: "You were marked absent yesterday", time: "24 Jul", tint: "coral", icon: "alert" },
  { text: "You completed 15 tasks this month", time: "This month", tint: "pastel-blue", icon: "tasks" },
  { text: "Your certificate has been issued", time: "3 days ago", tint: "lavender", icon: "award" },
  { text: "Sales meeting at 11:30", time: "25 Jul", tint: "blue", icon: "calendar" },
];

export const HOME_CELEBRATIONS: BosCelebration[] = [
  { initials: "PS", name: "Priya Sharma", tag: "BIRTHDAY · TODAY", avatar: { fill: "var(--bos-pastel-rose)", ink: "var(--bos-pastel-rose-ink)" }, tint: "coral" },
  { initials: "RK", name: "Rahul Khanna", tag: "3-YR ANNIV. · TOMORROW", avatar: { fill: "var(--bos-pastel-sage)", ink: "var(--bos-pastel-sage-ink)" }, tint: "amber" },
  { initials: "AN", name: "Ananya Nair", tag: "BIRTHDAY · 27 JUL", avatar: { fill: "var(--bos-pastel-blue)", ink: "var(--bos-pastel-blue-ink)" }, tint: "coral" },
];

/** Design-system month view sample (July 2026, today = 27th). */
export const SAMPLE_CALENDAR_EVENTS: BosCalendarEvent[] = [
  { date: "2026-07-03", label: "Client call", tint: "blue" },
  { date: "2026-07-09", label: "PO deadline", tint: "coral" },
  { date: "2026-07-14", label: "AMC renewal", tint: "emerald" },
  { date: "2026-07-21", label: "Team sync", tint: "blue" },
  { date: "2026-07-27", label: "Board review", tint: "amber" },
  { date: "2026-07-30", label: "Invoice due", tint: "coral" },
];

export const SAMPLE_TODAY = new Date(2026, 6, 27);

export const INVOICE_DEFAULTS = {
  from: "Justx Systems",
  to: "Meridian Solar EPC",
  number: "INV-2026-0442",
  taxRate: "18",
  notes: "Payment due within 15 days. Bank transfer to HDFC Bank, A/C 50100234567821, IFSC HDFC0001234.",
  dueInDays: 15,
  items: [
    { description: "Solar panel installation — 5kW system", quantity: 1, rate: 145000 },
    { description: "Annual maintenance contract", quantity: 1, rate: 12000 },
  ] satisfies Array<Omit<InvoiceLineItem, "id">>,
};

export const SIGNED_IN_USER = {
  initials: "JW",
  firstName: "James",
  name: "James Workman",
  role: "Operations Manager · Field Operations",
  email: "james.workman@meridiansolar.com",
  mobile: "+91 98450 12233",
};
