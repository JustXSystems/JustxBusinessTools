import type { Router } from "express";
import { z } from "zod";
import { actorOf, can, parse, type ImsDeps } from "./context.js";
import { isoOf, money, rows, type Queryable } from "./db.js";
import { addDaysISO, AUDIT_CATEGORIES, AUDIT_SEVERITIES, daysBetween, round2, todayISO, type AuditCategory, type AuditIssue } from "./logic.js";
import { getSettings } from "./settings.js";

/* ---------- Ask AI: built-in answers from the tenant's own data, plus a compact data summary for an optional LLM ---------- */

export type AssistantPart = "inv" | "ar" | "ap" | "po";

export const ASSISTANT_PAGES = {
  dashboard: { title: "Today at a glance", parts: ["inv", "ar", "ap", "po"], suggestions: ["What needs my attention today?", "Which items should I reorder first?", "Summarise stock movement this week.", "Who owes me the most, and who is overdue?"] },
  stock: { title: "Stock", parts: ["inv"], suggestions: ["Which items are running low, and who supplies them?", "Which stock is not moving?", "Which category holds most of my stock value?", "Suggest a reorder list."] },
  lowstock: { title: "Restock list", parts: ["inv", "po"], suggestions: ["Suggest a reorder list grouped by supplier.", "Which out-of-stock items sell fastest?", "What is the value of items below minimum?"] },
  items: { title: "Items", parts: ["inv"], suggestions: ["Which brand has the most stock value?", "Which items have not moved in 30 days?", "Show my top 10 items by stock value."] },
  history: { title: "Stock movements", parts: ["inv"], suggestions: ["Summarise this week's stock in and out.", "Which items moved the most?", "Anything unusual in recent movements?"] },
  purchase: { title: "Purchase orders", parts: ["po", "inv"], suggestions: ["Which purchase orders are still pending?", "Total value of open POs by supplier.", "Which supplier do I order from most?"] },
  parties: { title: "Suppliers & customers", parts: ["po", "ar", "ap"], suggestions: ["Which supplier do I order from most?", "Who owes me the most, and who is overdue?", "Which vendor do I owe the most?"] },
  receivables: { title: "Accounts receivable", parts: ["ar"], suggestions: ["Who should I chase first?", "How much is overdue by more than 60 days?", "Draft a polite reminder for the most overdue customer."] },
  payables: { title: "Accounts payable", parts: ["ap"], suggestions: ["Which bills are due in the next 14 days?", "Which bills are on hold or awaiting approval?", "Which vendor do I owe the most?"] },
  reports: { title: "Reports", parts: ["inv", "ar", "ap", "po"], suggestions: ["Give me a one-paragraph summary of the business.", "What are the biggest risks in stock right now?", "How is cash tied up between stock, receivables and payables?"] },
} as const satisfies Record<string, { title: string; parts: ReadonlyArray<AssistantPart>; suggestions: ReadonlyArray<string> }>;

export type AssistantPage = keyof typeof ASSISTANT_PAGES;

export type AssistantItem = { name: string; brand: string | null; category: string | null; unit: string; stock: number; min: number; max: number | null; reorderQty: number | null; cost: number; supplier: string | null; sold30: number };
export type AssistantMove = { date: string; type: string; item: string; qty: number; ref: string | null; by: string | null };
export type AssistantDoc = { no: string; party: string; total: number; paid: number; balance: number; due: string; daysLate: number; status: string };
export type AssistantPo = { no: string; supplier: string; status: string; date: string; total: number };

export type AssistantSnapshot = {
  business: string;
  today: string;
  items?: AssistantItem[];
  moves?: AssistantMove[];
  receivables?: AssistantDoc[];
  payables?: AssistantDoc[];
  pos?: AssistantPo[];
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const sum = <T>(list: ReadonlyArray<T>, f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
const bullets = <T>(list: ReadonlyArray<T>, f: (x: T) => string, n = 8) =>
  list
    .slice(0, n)
    .map((x) => `- ${f(x)}`)
    .join("\n");
const value = (i: AssistantItem) => Math.max(0, i.stock) * i.cost;
const isLow = (i: AssistantItem) => i.stock <= i.min && (i.min > 0 || i.stock <= 0);
const reorderQty = (i: AssistantItem) => Math.max(1, Math.ceil(i.reorderQty ?? (i.max ?? i.min * 2) - i.stock));
const groupSum = <T>(list: ReadonlyArray<T>, key: (x: T) => string, amount: (x: T) => number) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + amount(x));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const OPEN_PO = new Set(["draft", "pending_approval", "approved", "sent", "partially_received"]);

/** The data summary handed to an LLM: compact, capped, and limited to what this user may see. */
export function assistantContext(snap: AssistantSnapshot): string {
  const out: string[] = [`COMPANY: ${snap.business}. DATE: ${snap.today}.`];
  if (snap.items) {
    const items = snap.items;
    const low = items.filter(isLow).sort((a, b) => a.stock - b.stock);
    out.push(`INVENTORY: ${items.length} items, stock value ${inr(sum(items, value))} at purchase price. Out of stock: ${items.filter((i) => i.stock <= 0).length}. At or below minimum: ${low.length}.`);
    out.push(`BY CATEGORY (value): ${groupSum(items, (i) => i.category || "Uncategorised", value)
      .slice(0, 10)
      .map(([k, v]) => `${k} ${inr(v)}`)
      .join("; ")}`);
    out.push(`LOW OR OUT OF STOCK (name | stock/min | supplier | cost): ${low
      .slice(0, 25)
      .map((i) => `${i.name} | ${i.stock}/${i.min} ${i.unit} | ${i.supplier ?? "-"} | ${inr(i.cost)}`)
      .join(" ;; ")}`);
    out.push(`TOP VALUE ITEMS: ${[...items]
      .sort((a, b) => value(b) - value(a))
      .slice(0, 12)
      .map((i) => `${i.name} ${i.stock} ${i.unit} = ${inr(value(i))}`)
      .join("; ")}`);
    out.push(`FAST MOVERS (sold in 30 days): ${[...items]
      .sort((a, b) => b.sold30 - a.sold30)
      .filter((i) => i.sold30 > 0)
      .slice(0, 10)
      .map((i) => `${i.name} ${i.sold30}`)
      .join("; ")}`);
    out.push(`NOT MOVING (no sales in 30 days, in stock): ${items
      .filter((i) => i.sold30 === 0 && i.stock > 0)
      .slice(0, 10)
      .map((i) => `${i.name} ${i.stock} ${i.unit}`)
      .join("; ")}`);
  }
  if (snap.moves) {
    out.push(`RECENT STOCK MOVEMENTS (date | type | item | qty | ref | by): ${snap.moves
      .slice(0, 25)
      .map((m) => `${m.date} | ${m.type} | ${m.item} | ${m.qty} | ${m.ref ?? "-"} | ${m.by ?? "-"}`)
      .join(" ;; ")}`);
  }
  if (snap.receivables) {
    const r = snap.receivables;
    out.push(`RECEIVABLES (customers owe us): ${inr(sum(r, (d) => d.balance))} across ${r.length} open invoices. By customer: ${groupSum(r, (d) => d.party, (d) => d.balance)
      .slice(0, 12)
      .map(([k, v]) => `${k} ${inr(v)}`)
      .join("; ")}`);
    out.push(`OPEN INVOICES (no | customer | total | paid | balance | due | days late): ${r
      .slice(0, 22)
      .map((d) => `${d.no} | ${d.party} | ${inr(d.total)} | ${inr(d.paid)} | ${inr(d.balance)} | ${d.due} | ${d.daysLate}`)
      .join(" ;; ")}`);
  }
  if (snap.payables) {
    const p = snap.payables;
    out.push(`PAYABLES (we owe vendors): ${inr(sum(p, (d) => d.balance))} across ${p.length} unpaid bills. By vendor: ${groupSum(p, (d) => d.party, (d) => d.balance)
      .slice(0, 12)
      .map(([k, v]) => `${k} ${inr(v)}`)
      .join("; ")}`);
    out.push(`UNPAID BILLS (no | vendor | balance | due | days late, negative = not yet due | status): ${p
      .slice(0, 24)
      .map((d) => `${d.no} | ${d.party} | ${inr(d.balance)} | ${d.due} | ${d.daysLate} | ${d.status}`)
      .join(" ;; ")}`);
  }
  if (snap.pos) {
    const open = snap.pos.filter((p) => OPEN_PO.has(p.status));
    out.push(`PURCHASE ORDERS: ${snap.pos.length} in the last 180 days, ${open.length} open. Open (po | supplier | status | date | total): ${open
      .slice(0, 25)
      .map((p) => `${p.no} | ${p.supplier} | ${p.status} | ${p.date} | ${inr(p.total)}`)
      .join(" ;; ")}`);
  }
  return out.join("\n").slice(0, 14_000);
}

/** Built-in answers to the suggested questions (and close variants) — no LLM needed. Null when it can't answer. */
export function assistantAnswer(question: string, snap: AssistantSnapshot): string | null {
  const s = question.toLowerCase();
  const items = snap.items ?? [];
  const low = items.filter(isLow).sort((a, b) => a.stock - b.stock);
  const ar = [...(snap.receivables ?? [])].sort((a, b) => b.daysLate - a.daysLate);
  const ap = snap.payables ?? [];
  const pos = snap.pos ?? [];
  const openPo = pos.filter((p) => OPEN_PO.has(p.status));

  if (snap.items) {
    if (/fastest|best sell|sell most|selling fast/.test(s) && /out.of.stock|low|below|running/.test(s)) {
      if (!low.length) return "Nothing is at or below its minimum stock right now.";
      return `**Fastest sellers among low or out-of-stock items** (sold in the last 30 days):\n${bullets([...low].sort((a, b) => b.sold30 - a.sold30), (i) => `${i.name} — ${i.sold30} sold, ${i.stock} ${i.unit} left`)}`;
    }
    if (/value/.test(s) && /below|low|minimum/.test(s)) {
      if (!low.length) return "Nothing is at or below its minimum stock right now.";
      return `**${low.length} items are at or below minimum.** Refilling them would cost about ${inr(sum(low, (i) => reorderQty(i) * i.cost))} at purchase price. Stock still on hand in these items is worth ${inr(sum(low, value))}.`;
    }
    if (/reorder|running low|low stock|below min|out.of.stock|restock/.test(s)) {
      if (!low.length) return "Nothing is at or below its minimum stock right now.";
      if (/supplier|group/.test(s)) {
        const g = new Map<string, AssistantItem[]>();
        for (const i of low) g.set(i.supplier ?? "No supplier", [...(g.get(i.supplier ?? "No supplier") ?? []), i]);
        return `**Reorder list by supplier** (${low.length} items):\n${[...g.entries()].map(([k, v]) => `- **${k}**: ${v.map((i) => `${i.name} (${i.stock} left, order ~${reorderQty(i)})`).join("; ")}`).join("\n")}`;
      }
      return `**${low.length} items are at or below minimum.** Most urgent first:\n${bullets(low, (i) => `${i.name} — ${i.stock}/${i.min} ${i.unit}, supplier ${i.supplier ?? "-"}, order about ${reorderQty(i)}`, 10)}`;
    }
    if (/not moving|dead|slow|no movement|not moved|haven'?t moved|no sales/.test(s)) {
      const z = items.filter((i) => i.sold30 === 0 && i.stock > 0).sort((a, b) => value(b) - value(a));
      return z.length ? `**${z.length} items had no sales in 30 days** (${inr(sum(z, value))} tied up):\n${bullets(z, (i) => `${i.name} — ${i.stock} ${i.unit}, ${inr(value(i))}`, 10)}` : "Every item in stock has sold at least once in the last 30 days.";
    }
    if (/categor/.test(s)) {
      const e = groupSum(items, (i) => i.category || "Uncategorised", value);
      const tot = sum(e, (x) => x[1]) || 1;
      return `**Stock value by category** (total ${inr(tot)}):\n${bullets(e, ([k, v]) => `${k} — ${inr(v)} (${Math.round((v / tot) * 100)}%)`)}`;
    }
    if (/brand/.test(s)) return `**Stock value by brand:**\n${bullets(groupSum(items, (i) => i.brand || "No brand", value), ([k, v]) => `${k} — ${inr(v)}`)}`;
    if (/top \d+|highest|most valuable|stock value/.test(s) && !/owe|receiv|payable/.test(s)) {
      return `**Top items by stock value:**\n${bullets([...items].sort((a, b) => value(b) - value(a)), (i) => `${i.name} — ${i.stock} ${i.unit} = ${inr(value(i))}`, 10)}`;
    }
  }
  if (/attention|today|summar|overview|risk|cash tied|business/.test(s) && !/movement|stock in|week/.test(s)) {
    const lines: string[] = [];
    if (snap.items) lines.push(`Stock: ${items.filter((i) => i.stock <= 0).length} items out of stock and ${low.length} at or below minimum. Stock is worth ${inr(sum(items, value))}.`);
    if (snap.receivables) lines.push(`Customers owe you ${inr(sum(ar, (d) => d.balance))}; ${inr(sum(ar.filter((d) => d.daysLate > 60), (d) => d.balance))} of it is more than 60 days late.`);
    if (snap.payables) {
      const soon = ap.filter((d) => d.daysLate >= -14);
      lines.push(`You owe vendors ${inr(sum(ap, (d) => d.balance))}; ${soon.length} bills (${inr(sum(soon, (d) => d.balance))}) are due within 14 days or overdue.`);
    }
    if (snap.pos) lines.push(`${openPo.length} purchase orders are still open (${inr(sum(openPo, (p) => p.total))}).`);
    if (lines.length) return `**Here's what stands out today**\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }
  if (snap.moves && /movement|stock in|stock out|moved|week|unusual/.test(s)) {
    const wk = snap.moves.filter((m) => daysBetween(m.date, snap.today) <= 7);
    const byType = groupSum(wk, (m) => m.type, (m) => Math.abs(m.qty));
    const byItem = groupSum(wk, (m) => m.item, (m) => Math.abs(m.qty));
    return `**Last 7 days:** ${wk.length} movements — ${byType.map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} ${v} units`).join(", ") || "none"}.\n**Busiest items:**\n${bullets(byItem, ([k, v]) => `${k} — ${v} units`, 6) || "- none"}`;
  }
  if (snap.receivables) {
    if (/draft|reminder|message/.test(s) && ar.length) {
      const d = ar[0];
      return `Here's a polite reminder for **${d.party}** (${d.no}, ${inr(d.balance)}, ${Math.max(0, d.daysLate)} days past due):\n\n“Dear ${d.party}, this is a gentle reminder that invoice ${d.no} for ${inr(d.balance)} was due on ${d.due}. Could you please arrange the payment at your earliest convenience? If it has already been paid, kindly share the details so we can update our records. Thank you — ${snap.business}.”`;
    }
    const days = s.match(/(\d+)\s*days/);
    if (days && /overdue|late|more than|above/.test(s) && !/vendor|bill|supplier/.test(s)) {
      const n = Number(days[1]);
      const l = ar.filter((d) => d.daysLate > n);
      return `**${inr(sum(l, (d) => d.balance))} is more than ${n} days late** across ${l.length} invoices:\n${bullets(l, (d) => `${d.no} — ${d.party}, ${inr(d.balance)}, ${d.daysLate} days late`) || "- none"}`;
    }
    if (/chase|owe me|owes me|overdue|receivable|customer/.test(s) && !/vendor|supplier|bill|purchase/.test(s)) {
      if (!ar.length) return "No customer has an unpaid invoice right now.";
      const e = groupSum(
        ar.filter((d) => d.daysLate > 0),
        (d) => d.party,
        (d) => d.balance,
      );
      return `**Customers owe you ${inr(sum(ar, (d) => d.balance))}.** Chase these first (overdue balance):\n${bullets(e, ([k, v]) => `${k} — ${inr(v)}`, 6) || "- nobody is overdue yet"}\n\nOldest overdue invoice: ${ar[0].no} (${ar[0].party}), ${Math.max(0, ar[0].daysLate)} days late.`;
    }
  }
  if (snap.payables) {
    if (/due in the next|due soon|next \d+ days/.test(s)) {
      const l = ap.filter((d) => d.daysLate >= -14).sort((a, b) => b.daysLate - a.daysLate);
      return l.length ? `**${l.length} bills are due or overdue in the next 14 days** (${inr(sum(l, (d) => d.balance))}):\n${bullets(l, (d) => `${d.no} — ${d.party}, ${inr(d.balance)}, ${d.daysLate > 0 ? `${d.daysLate} days late` : `due in ${-d.daysLate} days`}`)}` : "No bills fall due in the next 14 days.";
    }
    if (/on hold|reject|approval|awaiting/.test(s)) {
      const l = ap.filter((d) => d.status === "on_hold" || d.status === "pending_approval");
      return l.length ? `**${l.length} bills are not cleared for payment:**\n${bullets(l, (d) => `${d.no} — ${d.party}, ${inr(d.balance)}, ${d.status.replace(/_/g, " ")}`)}` : "Every unpaid bill is approved.";
    }
    if (/vendor|supplier/.test(s) && /owe|payable/.test(s)) {
      return ap.length ? `**You owe vendors ${inr(sum(ap, (d) => d.balance))}.** Largest balances:\n${bullets(groupSum(ap, (d) => d.party, (d) => d.balance), ([k, v]) => `${k} — ${inr(v)}`, 6)}` : "You don't owe any vendor right now.";
    }
  }
  if (snap.pos) {
    if (/order from most|most orders|has the most orders/.test(s)) {
      return pos.length ? `**Purchase orders by supplier** (last 180 days):\n${bullets(groupSum(pos, (p) => p.supplier, () => 1), ([k, v]) => `${k} — ${v} order${v === 1 ? "" : "s"}`)}` : "No purchase orders in the last 180 days.";
    }
    if (/purchase order|pending|open po|\bpos?\b/.test(s)) {
      if (/supplier|value/.test(s)) return `**Open PO value by supplier** (${inr(sum(openPo, (p) => p.total))} total):\n${bullets(groupSum(openPo, (p) => p.supplier, (p) => p.total), ([k, v]) => `${k} — ${inr(v)}`) || "- none"}`;
      return openPo.length ? `**${openPo.length} purchase orders are still open:**\n${bullets(openPo, (p) => `${p.no} — ${p.supplier}, ${p.status.replace(/_/g, " ")}, ${inr(p.total)}`)}` : "No purchase orders are open.";
    }
  }
  return null;
}

/* ---------- Ask Audit AI: plain-language questions over the audit rule engine's findings ---------- */

export type AskableIssue = AuditIssue & { open: boolean };

const AUDIT_INTENTS: ReadonlyArray<{ category: AuditCategory; re: RegExp }> = [
  { category: "tally", re: /tally/ },
  { category: "gst", re: /\bgst|tax|gstin|b2c/ },
  { category: "duplicates", re: /duplicate|twice|double/ },
  { category: "documents", re: /missing doc|document|attachment|without (a )?bill|supporting/ },
  { category: "bank", re: /bank|unmatched|unreconciled|reconcil/ },
  { category: "stock", re: /stock|inventory|negative|count|write.?off|adjustment/ },
  { category: "changed", re: /changed|modified|edited|deleted|after approval/ },
  { category: "unusual", re: /unusual|odd|suspicious|strange|large/ },
  { category: "ar", re: /receivable|customer|collect|without payment|unpaid invoice|owe me/ },
  { category: "ap", re: /payable|vendor|supplier bill|we owe|bills? (pending|overdue)/ },
];

const STOP_WORDS = new Set("the a an and or of to for in on is are was were why what which who show me list all any with without from this that these those there do does did have has be by at it its how many much please".split(" "));

export function auditAsk(question: string, issues: ReadonlyArray<AskableIssue>, today: string): { answer: string; rows: AskableIssue[]; matched: number } {
  const s = question.toLowerCase();
  let list = issues.filter((i) => i.open || /closed|resolved|all/.test(s));
  const cats = AUDIT_INTENTS.filter((x) => x.re.test(s)).map((x) => x.category);
  if (cats.length) list = list.filter((i) => cats.includes(i.category));

  const amountRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|(?<![\w/-])([\d,]{4,}(?:\.\d+)?)(?![\w/-])/;
  const amt = s.match(amountRe);
  const amount = amt ? Number((amt[1] ?? amt[2]).replace(/,/g, "")) : null;
  const days = s.match(/(\d+)\s*days/);
  if (days && /pending|older|more than|over|above|>/.test(s)) list = list.filter((i) => i.date !== null && daysBetween(i.date, today) > Number(days[1]));
  else if (amount !== null && /above|more than|over|greater|>/.test(s)) list = list.filter((i) => (i.amount ?? 0) > amount);
  else if (amount !== null && /below|less than|under|</.test(s)) list = list.filter((i) => i.amount !== null && i.amount < amount);
  else if (amount !== null) list = list.filter((i) => i.amount !== null && Math.abs(i.amount - amount) < 1);

  const tokens = s
    .replace(amountRe, " ")
    .replace(/\d+\s*days/g, " ")
    .split(/[^a-z0-9/-]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && /\d/.test(t));
  if (tokens.length) {
    const hits = list.filter((i) => tokens.some((t) => `${i.entityLabel} ${i.title} ${i.detail}`.toLowerCase().includes(t)));
    if (hits.length) list = hits;
  } else if (!cats.length && amount === null && !days && !/summar|overview|biggest|worst|priorit|everything|open|all/.test(s)) {
    const words = s.split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !STOP_WORDS.has(t));
    list = words.length ? list.filter((i) => words.some((w) => `${i.entityLabel} ${i.title} ${i.detail}`.toLowerCase().includes(w))) : list;
  }

  const sev = (i: AskableIssue) => AUDIT_SEVERITIES.indexOf(i.severity);
  list = [...list].sort((a, b) => sev(b) - sev(a) || (b.amount ?? 0) - (a.amount ?? 0));
  const total = sum(list, (i) => i.amount ?? 0);
  if (!list.length) return { answer: "No matching findings in this period. Try a broader question, or widen the date range.", rows: [], matched: 0 };

  if (list.length === 1) {
    const i = list[0];
    const cat = AUDIT_CATEGORIES.find((c) => c.key === i.category);
    return { answer: `**${i.title}** — ${i.entityLabel}${i.amount !== null ? `, ${inr(i.amount)}` : ""}.\n${i.detail}\n\n**What to do:** ${cat?.fix ?? "Review the entry and record a verdict."}`, rows: list, matched: 1 };
  }
  const byCat = groupSum(list, (i) => i.category, () => 1);
  const label = (k: string) => AUDIT_CATEGORIES.find((c) => c.key === k)?.label ?? k;
  const severe = list.filter((i) => i.severity === "critical" || i.severity === "high").length;
  return {
    answer: `**${list.length} findings**${total ? ` worth ${inr(total)}` : ""}${severe ? `, ${severe} high or critical` : ""}.\n${bullets(byCat, ([k, n]) => `${label(k)} — ${n}`, 10)}${byCat.length === 1 ? `\n\n**What to do:** ${AUDIT_CATEGORIES.find((c) => c.key === byCat[0][0])?.fix ?? ""}` : ""}`,
    rows: list.slice(0, 40),
    matched: list.length,
  };
}

/* ---------- Loading a permission-filtered snapshot ---------- */

async function loadSnapshot(db: Queryable, tenantId: number, business: string, parts: ReadonlySet<AssistantPart>): Promise<AssistantSnapshot> {
  const today = todayISO();
  const snap: AssistantSnapshot = { business, today };
  const p = { tenantId, since30: addDaysISO(today, -30), since14: addDaysISO(today, -14), since180: addDaysISO(today, -180) };
  await Promise.all([
    parts.has("inv")
      ? Promise.all([
          rows<{ name: string; brand: string | null; category: string | null; unit: string; current_stock: string; min_stock: string; max_stock: string | null; reorder_qty: string | null; purchase_price: string; supplier: string | null; sold30: string | null }>(
            db,
            `SELECT i.name, i.brand, i.category, i.unit, i.current_stock, i.min_stock, i.max_stock, i.reorder_qty, i.purchase_price, s.name AS supplier,
                    (SELECT SUM(m.qty) FROM ims_movements m WHERE m.tenant_id = i.tenant_id AND m.item_id = i.id AND m.type = 'OUT' AND m.movement_date >= :since30) AS sold30
             FROM ims_items i LEFT JOIN ims_parties s ON s.tenant_id = i.tenant_id AND s.id = i.supplier_id
             WHERE i.tenant_id = :tenantId AND i.active = 1 ORDER BY i.name LIMIT 3000`,
            p,
          ),
          rows<{ movement_date: string; type: string; item_name: string; qty: string; ref_no: string | null; actor_name: string | null }>(
            db,
            `SELECT movement_date, type, item_name, qty, ref_no, actor_name FROM ims_movements
             WHERE tenant_id = :tenantId AND movement_date >= :since14 ORDER BY movement_date DESC, created_at DESC LIMIT 300`,
            p,
          ),
        ]).then(([items, moves]) => {
          snap.items = items.map((i) => ({
            name: i.name,
            brand: i.brand,
            category: i.category,
            unit: i.unit,
            stock: money(i.current_stock),
            min: money(i.min_stock),
            max: i.max_stock === null ? null : money(i.max_stock),
            reorderQty: i.reorder_qty === null ? null : money(i.reorder_qty),
            cost: money(i.purchase_price),
            supplier: i.supplier,
            sold30: money(i.sold30),
          }));
          snap.moves = moves.map((m) => ({ date: isoOf(m.movement_date), type: m.type, item: m.item_name, qty: money(m.qty), ref: m.ref_no, by: m.actor_name }));
        })
      : null,
    parts.has("ar")
      ? rows<{ invoice_no: string; customer_name: string; grand_total: string; amount_paid: string; invoice_date: string; due_date: string | null }>(
          db,
          `SELECT invoice_no, customer_name, grand_total, amount_paid, invoice_date, due_date FROM ims_invoices
           WHERE tenant_id = :tenantId AND status = 'issued' AND grand_total - amount_paid > 0.005 ORDER BY COALESCE(due_date, invoice_date) LIMIT 2000`,
          p,
        ).then((list) => {
          snap.receivables = list.map((r) => {
            const due = isoOf(r.due_date ?? r.invoice_date);
            return { no: r.invoice_no, party: r.customer_name, total: money(r.grand_total), paid: money(r.amount_paid), balance: round2(money(r.grand_total) - money(r.amount_paid)), due, daysLate: daysBetween(due, today), status: "issued" };
          });
        })
      : null,
    parts.has("ap")
      ? rows<{ bill_no: string; supplier_name: string; grand_total: string; amount_paid: string; bill_date: string; due_date: string | null; status: string }>(
          db,
          `SELECT bill_no, supplier_name, grand_total, amount_paid, bill_date, due_date, status FROM ims_bills
           WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005 ORDER BY COALESCE(due_date, bill_date) LIMIT 2000`,
          p,
        ).then((list) => {
          snap.payables = list.map((r) => {
            const due = isoOf(r.due_date ?? r.bill_date);
            return { no: r.bill_no, party: r.supplier_name, total: money(r.grand_total), paid: money(r.amount_paid), balance: round2(money(r.grand_total) - money(r.amount_paid)), due, daysLate: daysBetween(due, today), status: r.status };
          });
        })
      : null,
    parts.has("po")
      ? rows<{ po_no: string; supplier_name: string; status: string; order_date: string; grand_total: string }>(
          db,
          `SELECT po_no, supplier_name, status, order_date, grand_total FROM ims_purchase_orders
           WHERE tenant_id = :tenantId AND order_date >= :since180 ORDER BY order_date DESC LIMIT 1000`,
          p,
        ).then((list) => {
          snap.pos = list.map((r) => ({ no: r.po_no, supplier: r.supplier_name, status: r.status, date: isoOf(r.order_date), total: money(r.grand_total) }));
        })
      : null,
  ]);
  return snap;
}

const PART_PERMS: Record<AssistantPart, ReadonlyArray<Parameters<typeof can>[1]> | null> = {
  inv: null,
  ar: ["receivables"],
  ap: ["payables"],
  po: ["po", "approvals"],
};

const AskInput = z.object({
  page: z.enum(Object.keys(ASSISTANT_PAGES) as [AssistantPage, ...AssistantPage[]]),
  question: z.string().trim().max(500).optional(),
});

export function registerAssistant(router: Router, deps: ImsDeps): void {
  /** Built-in answer (if any) plus the data summary an optional LLM may use. Read-only. */
  router.post("/assistant/ask", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(AskInput, req.body);
    const page = ASSISTANT_PAGES[input.page];
    const parts = new Set<AssistantPart>(page.parts.filter((part) => PART_PERMS[part]?.some((perm) => can(res, perm)) ?? true));
    const settings = await getSettings(deps, actor.tenantId);
    const snap = await loadSnapshot(deps.db, actor.tenantId, settings.businessName || "this business", parts);
    res.json({
      page: input.page,
      title: page.title,
      suggestions: page.suggestions,
      answer: input.question ? assistantAnswer(input.question, snap) : null,
      context: assistantContext(snap),
      business: settings.businessName || null,
    });
  });
}
