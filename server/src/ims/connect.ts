import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, parse, qint, qstr, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, notFound, type ImsActor } from "./host.js";
import { addDaysISO, computeTotals, isIntraState, mobileKey, nameKey, round2, todayISO, type ImsLineInput, type ImsTotals } from "./logic.js";
import { getSettings, type ImsSettings } from "./settings.js";
import type { CatalogItem, CatalogParty, ImsCatalogSource, ImsDocumentSource, SourceParty, SourceRecord } from "./sources/types.js";

export type LinkTarget = "invoice" | "party" | "item";
type Links = Partial<Record<LinkTarget, string>>;

const isMissingTable = (err: unknown) => (err as { code?: string }).code === "ER_NO_SUCH_TABLE";

async function linksFor(db: Queryable, tenantId: number, tool: string): Promise<Map<string, Links>> {
  const list = await rows<{ source_ref: string; target_type: LinkTarget; target_id: string }>(
    db,
    `SELECT source_ref, target_type, target_id FROM ims_links WHERE tenant_id = :tenantId AND source_tool = :tool AND target_id <> ''`,
    { tenantId, tool },
  );
  const map = new Map<string, Links>();
  for (const l of list) map.set(l.source_ref, { ...(map.get(l.source_ref) ?? {}), [l.target_type]: l.target_id });
  return map;
}

/**
 * Reserve the (tool, ref, target) link inside the transaction. Returns the existing target id when it was already
 * imported; a concurrent importer blocks on the primary key and then sees the finished link.
 */
async function claimLink(conn: PoolConnection, tenantId: number, tool: string, ref: string, target: LinkTarget): Promise<string | null> {
  const sql = `SELECT target_id FROM ims_links WHERE tenant_id = :tenantId AND source_tool = :tool AND source_ref = :ref AND target_type = :target FOR UPDATE`;
  const params = { tenantId, tool, ref, target };
  const existing = await one<{ target_id: string }>(conn, sql, params);
  if (existing) return existing.target_id || null;
  try {
    await exec(conn, `INSERT INTO ims_links (tenant_id, source_tool, source_ref, target_type, target_id) VALUES (:tenantId, :tool, :ref, :target, '')`, params);
    return null;
  } catch (err) {
    if ((err as { code?: string }).code !== "ER_DUP_ENTRY") throw err;
    return (await one<{ target_id: string }>(conn, sql, params))?.target_id || null;
  }
}

const setLink = (conn: PoolConnection, tenantId: number, tool: string, ref: string, target: LinkTarget, id: string) =>
  exec(conn, `UPDATE ims_links SET target_id = :id WHERE tenant_id = :tenantId AND source_tool = :tool AND source_ref = :ref AND target_type = :target`, { id, tenantId, tool, ref, target });

/* ---------- Shared writers (also used by the POS ingest) ---------- */

export type PartyUpsert = {
  kind: "customer" | "supplier" | "both";
  name: string;
  contactPerson?: string | null;
  mobile?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
};

const clip = (v: string | null | undefined, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Find a party by GSTIN, else by name + mobile (name alone when neither side has a mobile); create it otherwise. */
export async function upsertParty(conn: Queryable, actor: ImsActor, p: PartyUpsert): Promise<{ id: string; name: string; created: boolean }> {
  const name = clip(p.name, 200) ?? "Customer";
  const gstin = clip(p.gstin, 20)?.toUpperCase() ?? null;
  type Found = { id: string; kind: string; name: string; mobile: string | null };
  let found: Found | null = gstin
    ? await one<Found>(conn, `SELECT id, kind, name, mobile FROM ims_parties WHERE tenant_id = :tenantId AND gstin = :gstin ORDER BY active DESC LIMIT 1`, { tenantId: actor.tenantId, gstin })
    : null;
  if (!found) {
    const sameName = await rows<Found>(conn, `SELECT id, kind, name, mobile FROM ims_parties WHERE tenant_id = :tenantId AND LOWER(name) = LOWER(:name) ORDER BY active DESC LIMIT 20`, {
      tenantId: actor.tenantId,
      name,
    });
    const mobile = mobileKey(p.mobile);
    found = sameName.find((r) => (mobile ? mobileKey(r.mobile) === mobile || !mobileKey(r.mobile) : true)) ?? null;
  }
  if (found) {
    const kind = found.kind === p.kind || found.kind === "both" ? found.kind : "both";
    await exec(
      conn,
      `UPDATE ims_parties SET kind = :kind,
         gstin = COALESCE(NULLIF(gstin, ''), :gstin), mobile = COALESCE(NULLIF(mobile, ''), :mobile), email = COALESCE(NULLIF(email, ''), :email),
         address = COALESCE(NULLIF(address, ''), :address), city = COALESCE(NULLIF(city, ''), :city), state = COALESCE(NULLIF(state, ''), :state),
         contact_person = COALESCE(NULLIF(contact_person, ''), :contactPerson), active = 1
       WHERE tenant_id = :tenantId AND id = :id`,
      {
        tenantId: actor.tenantId,
        id: found.id,
        kind,
        gstin,
        mobile: clip(p.mobile, 40),
        email: clip(p.email, 180),
        address: clip(p.address, 500),
        city: clip(p.city, 80),
        state: clip(p.state, 80),
        contactPerson: clip(p.contactPerson, 120),
      },
    );
    return { id: found.id, name: found.name, created: false };
  }
  const id = randomUUID();
  await exec(
    conn,
    `INSERT INTO ims_parties (id, tenant_id, kind, name, contact_person, mobile, email, gstin, address, city, state, notes, created_by)
     VALUES (:id, :tenantId, :kind, :name, :contactPerson, :mobile, :email, :gstin, :address, :city, :state, :notes, :userId)`,
    {
      id,
      tenantId: actor.tenantId,
      kind: p.kind,
      name,
      contactPerson: clip(p.contactPerson, 120),
      mobile: clip(p.mobile, 40),
      email: clip(p.email, 180),
      gstin,
      address: clip(p.address, 500),
      city: clip(p.city, 80),
      state: clip(p.state, 80),
      notes: clip(p.notes, 2000),
      userId: actor.userId,
    },
  );
  return { id, name, created: true };
}

export type InvoiceInsert = {
  id?: string;
  status: "draft" | "issued";
  invoiceNo: string;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  customerMobile: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  invoiceDate: string;
  dueDate: string | null;
  totals: ImsTotals;
  amountPaid: number;
  payMode: string | null;
  stockPosted: boolean;
  sourceTool: string | null;
  sourceRef: string | null;
  notes: string | null;
  terms: string | null;
};

/** Drafts get a `DRAFT-XXXXXXXX` placeholder number; the sales module assigns the real series number on issue. */
export const draftInvoiceNo = (id: string): string => `DRAFT-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

export async function insertImsInvoice(conn: Queryable, actor: ImsActor, inv: InvoiceInsert): Promise<string> {
  const id = inv.id ?? randomUUID();
  const t = inv.totals;
  await exec(
    conn,
    `INSERT INTO ims_invoices
       (id, tenant_id, invoice_no, status, customer_id, customer_name, customer_gstin, customer_address, customer_mobile, place_of_supply, intra_state,
        invoice_date, due_date, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, round_off, grand_total, amount_paid, pay_mode, stock_posted,
        source_tool, source_ref, notes, terms, created_by, created_by_name)
     VALUES
       (:id, :tenantId, :invoiceNo, :status, :customerId, :customerName, :customerGstin, :customerAddress, :customerMobile, :placeOfSupply, :intraState,
        :invoiceDate, :dueDate, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :roundOff, :grandTotal, :amountPaid, :payMode, :stockPosted,
        :sourceTool, :sourceRef, :notes, :terms, :userId, :userName)`,
    {
      id,
      tenantId: actor.tenantId,
      invoiceNo: inv.invoiceNo.slice(0, 48),
      status: inv.status,
      customerId: inv.customerId,
      customerName: inv.customerName.slice(0, 200) || "Customer",
      customerGstin: clip(inv.customerGstin, 20)?.toUpperCase() ?? null,
      customerAddress: clip(inv.customerAddress, 500),
      customerMobile: clip(inv.customerMobile, 40),
      placeOfSupply: clip(inv.placeOfSupply, 80),
      intraState: inv.intraState ? 1 : 0,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      lines: JSON.stringify(t.lines),
      subtotal: t.subtotal,
      discountTotal: t.discountTotal,
      taxTotal: t.taxTotal,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      roundOff: t.roundOff,
      grandTotal: t.grandTotal,
      amountPaid: round2(inv.amountPaid),
      payMode: inv.payMode,
      stockPosted: inv.stockPosted ? 1 : 0,
      sourceTool: inv.sourceTool,
      sourceRef: inv.sourceRef ? inv.sourceRef.slice(0, 64) : null,
      notes: inv.notes,
      terms: inv.terms,
      userId: actor.userId,
      userName: actorName(actor),
    },
  );
  return id;
}

/* ---------- Matching against the item master ---------- */

type ItemRef = { id: string; name: string; sku: string | null; hsn: string | null; unit: string; gst_rate: string | number; selling_price: string | number };

async function itemIndex(db: Queryable, tenantId: number) {
  const list = await rows<ItemRef>(db, `SELECT id, name, sku, hsn, unit, gst_rate, selling_price FROM ims_items WHERE tenant_id = :tenantId AND active = 1 LIMIT 20000`, { tenantId });
  const bySku = new Map<string, ItemRef>();
  const byName = new Map<string, ItemRef>();
  for (const i of list) {
    if (i.sku) bySku.set(i.sku.trim().toLowerCase(), i);
    byName.set(nameKey(i.name), i);
  }
  return {
    find: (sku: string | null | undefined, name: string | null | undefined): ItemRef | null =>
      (sku ? bySku.get(sku.trim().toLowerCase()) : undefined) ?? (name ? byName.get(nameKey(name)) : undefined) ?? null,
  };
}

async function partyIndex(db: Queryable, tenantId: number) {
  const list = await rows<{ id: string; name: string; gstin: string | null; mobile: string | null; kind: string }>(
    db,
    `SELECT id, name, gstin, mobile, kind FROM ims_parties WHERE tenant_id = :tenantId LIMIT 20000`,
    { tenantId },
  );
  const byGstin = new Map<string, (typeof list)[number]>();
  const byName = new Map<string, Array<(typeof list)[number]>>();
  for (const p of list) {
    if (p.gstin) byGstin.set(p.gstin.trim().toUpperCase(), p);
    const k = nameKey(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  return {
    find: (p: SourceParty): (typeof list)[number] | null => {
      const g = p.gstin?.trim().toUpperCase();
      if (g && byGstin.has(g)) return byGstin.get(g)!;
      const candidates = byName.get(nameKey(p.company || p.name)) ?? [];
      const m = mobileKey(p.phone);
      return candidates.find((c) => (m ? mobileKey(c.mobile) === m || !mobileKey(c.mobile) : true)) ?? null;
    },
  };
}

/* ---------- Document sources (quotations → customer + draft invoice) ---------- */

export type DocImportResult = {
  ref: string;
  docNo: string;
  status: "imported" | "skipped" | "failed";
  message?: string;
  invoiceId?: string;
  invoiceNo?: string;
  partyId?: string;
  partyName?: string;
  partyCreated?: boolean;
  linkedLines?: number;
  freeLines?: number;
};

const partyFromSource = (p: SourceParty, kind: PartyUpsert["kind"]): PartyUpsert => ({
  kind,
  name: p.company || p.name,
  contactPerson: p.company ? p.name : null,
  mobile: p.phone ?? null,
  email: p.email ?? null,
  gstin: p.gstin ?? null,
  address: p.address ?? null,
  city: p.city ?? null,
  state: p.state ?? null,
});

async function importDocument(deps: ImsDeps, actor: ImsActor, source: ImsDocumentSource, r: SourceRecord, settings: ImsSettings): Promise<DocImportResult> {
  return tx(deps.db, async (conn) => {
    const existing = await claimLink(conn, actor.tenantId, source.id, r.ref, "invoice");
    if (existing) return { ref: r.ref, docNo: r.docNo, status: "skipped", message: "Already imported", invoiceId: existing };
    if (!r.lines?.length) throw badRequest(`${r.docNo} has no line items to invoice`);

    let partyId = await claimLink(conn, actor.tenantId, source.id, r.ref, "party");
    let partyCreated = false;
    const partyName = r.party.company || r.party.name || "Customer";
    if (!partyId) {
      const party = await upsertParty(conn, actor, { ...partyFromSource(r.party, "customer"), notes: `From ${source.label} ${r.docNo}` });
      partyId = party.id;
      partyCreated = party.created;
      await setLink(conn, actor.tenantId, source.id, r.ref, "party", party.id);
    }

    const items = await itemIndex(conn, actor.tenantId);
    let linked = 0;
    const lines: ImsLineInput[] = r.lines.map((l) => {
      const match = items.find(null, l.description);
      if (match) linked += 1;
      return {
        itemId: match?.id ?? null,
        name: l.description,
        sku: match?.sku ?? null,
        hsn: l.hsn || match?.hsn || null,
        unit: l.unit || match?.unit || null,
        qty: l.quantity,
        rate: l.rate,
        discountPct: l.discountPct ?? 0,
        gstRate: l.taxRate,
      };
    });
    const placeOfSupply = r.placeOfSupply || r.party.state || settings.state || null;
    const intraState = isIntraState(settings.state, placeOfSupply);
    const totals = computeTotals(lines, intraState);
    const id = randomUUID();
    const today = todayISO();
    const invoiceNo = draftInvoiceNo(id);
    await insertImsInvoice(conn, actor, {
      id,
      status: "draft",
      invoiceNo,
      customerId: partyId,
      customerName: partyName,
      customerGstin: r.party.gstin ?? null,
      customerAddress: [r.party.address, r.party.city, r.party.state].filter(Boolean).join(", ") || null,
      customerMobile: r.party.phone ?? null,
      placeOfSupply,
      intraState,
      invoiceDate: today,
      dueDate: addDaysISO(today, settings.paymentTermsDays),
      totals,
      amountPaid: 0,
      payMode: null,
      stockPosted: false,
      sourceTool: source.id,
      sourceRef: r.ref,
      notes: [r.notes || `From ${source.label} ${r.docNo}`, r.title].filter(Boolean).join(" · ").slice(0, 2000),
      terms: settings.terms,
    });
    await setLink(conn, actor.tenantId, source.id, r.ref, "invoice", id);
    return { ref: r.ref, docNo: r.docNo, status: "imported", invoiceId: id, invoiceNo, partyId, partyName, partyCreated, linkedLines: linked, freeLines: lines.length - linked };
  });
}

/* ---------- Catalog sources (BOS items & parties) ---------- */

type CatalogImportResult = { ref: string; name: string; status: "created" | "linked" | "skipped" | "failed"; id?: string; message?: string };

async function importCatalogItem(deps: ImsDeps, actor: ImsActor, catalog: ImsCatalogSource, item: CatalogItem, settings: ImsSettings): Promise<CatalogImportResult> {
  return tx(deps.db, async (conn) => {
    const existing = await claimLink(conn, actor.tenantId, catalog.id, item.ref, "item");
    if (existing) return { ref: item.ref, name: item.name, status: "skipped", id: existing, message: "Already imported" };
    const sku = clip(item.sku, 64);
    const match =
      (sku ? await one<{ id: string }>(conn, `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND sku = :sku LIMIT 1`, { tenantId: actor.tenantId, sku }) : null) ??
      (await one<{ id: string }>(conn, `SELECT id FROM ims_items WHERE tenant_id = :tenantId AND LOWER(name) = LOWER(:name) ORDER BY active DESC LIMIT 1`, { tenantId: actor.tenantId, name: item.name.trim() }));
    let id: string;
    let status: CatalogImportResult["status"];
    if (match) {
      id = match.id;
      status = "linked";
      await exec(
        conn,
        `UPDATE ims_items SET hsn = COALESCE(NULLIF(hsn, ''), :hsn), sku = COALESCE(NULLIF(sku, ''), :sku),
           selling_price = IF(selling_price = 0, :rate, selling_price)
         WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id, hsn: clip(item.hsn, 20), sku, rate: Math.max(0, round2(item.rate)) },
      );
    } else {
      id = randomUUID();
      status = "created";
      await exec(
        conn,
        `INSERT INTO ims_items (id, tenant_id, name, sku, unit, hsn, gst_rate, selling_price, notes, created_by)
         VALUES (:id, :tenantId, :name, :sku, :unit, :hsn, :gstRate, :rate, :notes, :userId)`,
        {
          id,
          tenantId: actor.tenantId,
          name: item.name.trim().slice(0, 200) || "Item",
          sku,
          unit: clip(item.unit, 20) ?? "pcs",
          hsn: clip(item.hsn, 20),
          gstRate: Number.isFinite(item.gstRate) ? Math.min(100, Math.max(0, item.gstRate)) : settings.defaultGstRate,
          rate: Math.max(0, round2(item.rate)),
          notes: `Imported from ${catalog.label}${item.kind === "service" ? " (service — no stock kept)" : ""}`,
          userId: actor.userId,
        },
      );
    }
    await setLink(conn, actor.tenantId, catalog.id, item.ref, "item", id);
    return { ref: item.ref, name: item.name, status, id };
  });
}

async function importCatalogParty(deps: ImsDeps, actor: ImsActor, catalog: ImsCatalogSource, p: CatalogParty): Promise<CatalogImportResult> {
  return tx(deps.db, async (conn) => {
    const existing = await claimLink(conn, actor.tenantId, catalog.id, p.ref, "party");
    if (existing) return { ref: p.ref, name: p.name, status: "skipped", id: existing, message: "Already imported" };
    const party = await upsertParty(conn, actor, { ...partyFromSource(p, p.kind), notes: `Imported from ${catalog.label}` });
    await setLink(conn, actor.tenantId, catalog.id, p.ref, "party", party.id);
    return { ref: p.ref, name: p.company || p.name, status: party.created ? "created" : "linked", id: party.id };
  });
}

function sourceOr404(deps: ImsDeps, id: string): ImsDocumentSource {
  const s = deps.sources.find((x) => x.id === id);
  if (!s) throw notFound("Connected tool");
  return s;
}

function catalogOr404(deps: ImsDeps, id: string): ImsCatalogSource {
  const c = deps.catalogs.find((x) => x.id === id);
  if (!c) throw notFound("Connected catalog");
  return c;
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : "Import failed");

const RefsInput = z.object({ refs: z.array(z.string().trim().min(1).max(64)).max(2000).optional(), all: z.boolean().optional() });

function pickRefs<T extends { ref: string }>(list: ReadonlyArray<T>, input: z.infer<typeof RefsInput>): T[] {
  if (input.all) return [...list];
  const wanted = new Set(input.refs ?? []);
  if (!wanted.size) throw badRequest("Pick at least one record to import");
  return list.filter((r) => wanted.has(r.ref));
}

export function registerConnect(router: Router, deps: ImsDeps): void {
  router.get("/connect/overview", async (_req, res) => {
    const actor = actorOf(res);
    const t = actor.tenantId;
    const sources = await Promise.all(
      deps.sources.map(async (s) => {
        let records: SourceRecord[] = [];
        let error: string | null = null;
        try {
          records = await s.list(t);
        } catch (err) {
          error = isMissingTable(err) ? null : errMessage(err);
        }
        const links = await linksFor(deps.db, t, s.id);
        const imported = records.filter((r) => links.get(r.ref)?.invoice).length;
        return {
          id: s.id,
          label: s.label,
          icon: s.icon,
          description: s.description,
          href: s.href,
          total: records.length,
          imported,
          ready: records.filter((r) => r.status === "approved" && !links.get(r.ref)?.invoice).length,
          error,
        };
      }),
    );
    const catalogs = await Promise.all(
      deps.catalogs.map(async (c) => {
        const [items, parties, links] = await Promise.all([c.items(t).catch(() => [] as CatalogItem[]), c.parties(t).catch(() => [] as CatalogParty[]), linksFor(deps.db, t, c.id)]);
        return {
          id: c.id,
          label: c.label,
          icon: c.icon,
          description: c.description,
          href: c.href,
          items: items.length,
          itemsLinked: items.filter((i) => links.get(i.ref)?.item).length,
          parties: parties.length,
          partiesLinked: parties.filter((p) => links.get(p.ref)?.party).length,
        };
      }),
    );
    const issued = await one<{ n: number; value: string }>(deps.db, `SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS value FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued'`, { tenantId: t });
    const recent = await rows<{ id: number; actor_name: string | null; summary: string; created_at: string }>(
      deps.db,
      `SELECT id, actor_name, summary, created_at FROM ims_events WHERE tenant_id = :tenantId AND event_type LIKE 'connect.%' ORDER BY id DESC LIMIT 10`,
      { tenantId: t },
    );
    res.json({
      sources,
      catalogs,
      outbound: [{ id: "bos", label: "Justx BOS", icon: "🏢", href: "/tools/bos", description: "Issued IMS invoices appear in BOS → Connected tools, where they become BOS customers and GST invoices.", available: Number(issued?.n ?? 0), value: round2(money(issued?.value)) }],
      recent: recent.map((e) => ({ id: Number(e.id), actorName: e.actor_name, summary: e.summary, createdAt: tsOf(e.created_at) })),
      can: { importDocuments: can(res, "sales"), importItems: can(res, "items"), importParties: can(res, "suppliers") },
    });
  });

  router.get("/connect/sources/:id/records", async (req, res) => {
    const actor = actorOf(res);
    const s = sourceOr404(deps, req.params.id);
    const [records, links] = await Promise.all([s.list(actor.tenantId).catch((err: unknown) => (isMissingTable(err) ? ([] as SourceRecord[]) : Promise.reject(err))), linksFor(deps.db, actor.tenantId, s.id)]);
    const invoiceIds = [...new Set([...links.values()].map((l) => l.invoice).filter((x): x is string => Boolean(x)))];
    const invoices = invoiceIds.length
      ? await rows<{ id: string; invoice_no: string; status: string; grand_total: string }>(deps.db, `SELECT id, invoice_no, status, grand_total FROM ims_invoices WHERE tenant_id = :tenantId AND id IN (:ids)`, {
          tenantId: actor.tenantId,
          ids: invoiceIds,
        })
      : [];
    const invById = new Map(invoices.map((i) => [i.id, i]));
    res.json({
      source: { id: s.id, label: s.label, icon: s.icon, description: s.description, href: s.href },
      records: records.map((r) => {
        const l = links.get(r.ref) ?? {};
        const inv = l.invoice ? invById.get(l.invoice) : undefined;
        return {
          ref: r.ref,
          docNo: r.docNo,
          date: r.date,
          status: r.status,
          amount: r.amount,
          title: r.title,
          party: r.party,
          placeOfSupply: r.placeOfSupply ?? null,
          lineCount: r.lines?.length ?? 0,
          imported: Boolean(l.invoice),
          links: l,
          invoice: inv ? { id: inv.id, invoiceNo: inv.invoice_no, status: inv.status, grandTotal: round2(money(inv.grand_total)) } : null,
        };
      }),
    });
  });

  router.post("/connect/sources/:id/import", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales", "Importing documents creates draft sales invoices — your IMS role needs the Sales invoices permission.");
    const s = sourceOr404(deps, req.params.id);
    const input = parse(RefsInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const refs = input.all ? (await s.list(actor.tenantId)).map((r) => r.ref) : [...new Set(input.refs ?? [])];
    if (!refs.length) throw badRequest("Pick at least one record to import");
    if (refs.length > 200) throw badRequest("Import up to 200 records at a time");
    const results: DocImportResult[] = [];
    for (const ref of refs) {
      const record = await s.get(actor.tenantId, ref).catch(() => null);
      if (!record) {
        results.push({ ref, docNo: ref, status: "failed", message: `Not found in ${s.label}` });
        continue;
      }
      try {
        results.push(await importDocument(deps, actor, s, record, settings));
      } catch (err) {
        results.push({ ref, docNo: record.docNo, status: "failed", message: errMessage(err) });
      }
    }
    const imported = results.filter((r) => r.status === "imported");
    if (imported.length) {
      await recordEvent(deps, actor, {
        type: "connect.import",
        entityType: "invoice",
        entityId: imported[0].invoiceId ?? "batch",
        summary: `${s.label} → ${imported.length} draft invoice${imported.length === 1 ? "" : "s"} (${imported.map((r) => r.docNo).slice(0, 4).join(", ")}${imported.length > 4 ? "…" : ""})`,
        payload: { sourceTool: s.id, refs: imported.map((r) => r.ref) },
        notice: { kind: "activity", title: `${s.label} imported`, body: `${imported.length} draft invoice${imported.length === 1 ? "" : "s"} ready to review in Invoices & Billing.`, path: "?m=sales" },
        ip: req.ip,
      });
    }
    res.json({ results, summary: { imported: imported.length, skipped: results.filter((r) => r.status === "skipped").length, failed: results.filter((r) => r.status === "failed").length } });
  });

  router.get("/connect/catalogs/:id/items", async (req, res) => {
    const actor = actorOf(res);
    const c = catalogOr404(deps, req.params.id);
    const [list, links, items] = await Promise.all([c.items(actor.tenantId), linksFor(deps.db, actor.tenantId, c.id), itemIndex(deps.db, actor.tenantId)]);
    res.json({
      catalog: { id: c.id, label: c.label, icon: c.icon, description: c.description, href: c.href },
      items: list.map((i) => {
        const linkedId = links.get(i.ref)?.item ?? null;
        const match = linkedId ? null : items.find(i.sku, i.name);
        return { ...i, linkedId, matchId: match?.id ?? null, matchName: match?.name ?? null, state: linkedId ? "linked" : match ? "match" : "new" };
      }),
    });
  });

  router.get("/connect/catalogs/:id/parties", async (req, res) => {
    const actor = actorOf(res);
    const c = catalogOr404(deps, req.params.id);
    const [list, links, parties] = await Promise.all([c.parties(actor.tenantId), linksFor(deps.db, actor.tenantId, c.id), partyIndex(deps.db, actor.tenantId)]);
    res.json({
      catalog: { id: c.id, label: c.label, icon: c.icon, description: c.description, href: c.href },
      parties: list.map((p) => {
        const linkedId = links.get(p.ref)?.party ?? null;
        const match = linkedId ? null : parties.find(p);
        return { ...p, linkedId, matchId: match?.id ?? null, matchName: match?.name ?? null, state: linkedId ? "linked" : match ? "match" : "new" };
      }),
    });
  });

  router.post("/connect/catalogs/:id/import-items", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "items");
    const c = catalogOr404(deps, req.params.id);
    const picked = pickRefs(await c.items(actor.tenantId), parse(RefsInput, req.body));
    const settings = await getSettings(deps, actor.tenantId);
    const results: CatalogImportResult[] = [];
    for (const item of picked) {
      try {
        results.push(await importCatalogItem(deps, actor, c, item, settings));
      } catch (err) {
        results.push({ ref: item.ref, name: item.name, status: "failed", message: (err as { code?: string }).code === "ER_DUP_ENTRY" ? "Duplicate SKU" : errMessage(err) });
      }
    }
    const created = results.filter((r) => r.status === "created").length;
    const linked = results.filter((r) => r.status === "linked").length;
    if (created || linked) {
      await recordEvent(deps, actor, {
        type: "connect.items",
        entityType: "item",
        entityId: "bulk",
        summary: `${c.label} catalog → ${created} new item${created === 1 ? "" : "s"}, ${linked} linked to existing`,
        payload: { sourceTool: c.id, count: results.length },
        ip: req.ip,
      });
    }
    res.json({ results, summary: { created, linked, skipped: results.filter((r) => r.status === "skipped").length, failed: results.filter((r) => r.status === "failed").length } });
  });

  router.post("/connect/catalogs/:id/import-parties", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "suppliers");
    const c = catalogOr404(deps, req.params.id);
    const picked = pickRefs(await c.parties(actor.tenantId), parse(RefsInput, req.body));
    const results: CatalogImportResult[] = [];
    for (const p of picked) {
      try {
        results.push(await importCatalogParty(deps, actor, c, p));
      } catch (err) {
        results.push({ ref: p.ref, name: p.name, status: "failed", message: errMessage(err) });
      }
    }
    const created = results.filter((r) => r.status === "created").length;
    const linked = results.filter((r) => r.status === "linked").length;
    if (created || linked) {
      await recordEvent(deps, actor, {
        type: "connect.parties",
        entityType: "party",
        entityId: "bulk",
        summary: `${c.label} parties → ${created} new, ${linked} matched to existing`,
        payload: { sourceTool: c.id, count: results.length },
        ip: req.ip,
      });
    }
    res.json({ results, summary: { created, linked, skipped: results.filter((r) => r.status === "skipped").length, failed: results.filter((r) => r.status === "failed").length } });
  });

  /** Everything IMS made from other tools, newest first, with a label for each target. */
  router.get("/connect/links", async (req, res) => {
    const actor = actorOf(res);
    const tool = qstr(req.query.tool, 40);
    const type = qstr(req.query.type, 16);
    const list = await rows<{
      source_tool: string;
      source_ref: string;
      target_type: LinkTarget;
      target_id: string;
      created_at: string;
      inv_no: string | null;
      inv_status: string | null;
      inv_customer: string | null;
      inv_total: string | null;
      item_name: string | null;
      item_sku: string | null;
      party_name: string | null;
      party_kind: string | null;
    }>(
      deps.db,
      `SELECT l.source_tool, l.source_ref, l.target_type, l.target_id, l.created_at,
              i.invoice_no AS inv_no, i.status AS inv_status, i.customer_name AS inv_customer, i.grand_total AS inv_total,
              it.name AS item_name, it.sku AS item_sku, p.name AS party_name, p.kind AS party_kind
       FROM ims_links l
       LEFT JOIN ims_invoices i ON l.target_type = 'invoice' AND i.tenant_id = l.tenant_id AND i.id = l.target_id
       LEFT JOIN ims_items it ON l.target_type = 'item' AND it.tenant_id = l.tenant_id AND it.id = l.target_id
       LEFT JOIN ims_parties p ON l.target_type = 'party' AND p.tenant_id = l.tenant_id AND p.id = l.target_id
       WHERE l.tenant_id = :tenantId AND l.target_id <> '' ${tool ? "AND l.source_tool = :tool" : ""} ${type ? "AND l.target_type = :type" : ""}
       ORDER BY l.created_at DESC LIMIT :limit`,
      { tenantId: actor.tenantId, tool, type, limit: qint(req.query.limit, 200, 1, 1000) },
    );
    const toolLabel = new Map<string, string>([...deps.sources.map((s) => [s.id, s.label] as const), ...deps.catalogs.map((c) => [c.id, c.label] as const)]);
    res.json({
      links: list.map((l) => ({
        sourceTool: l.source_tool,
        toolLabel: toolLabel.get(l.source_tool) ?? l.source_tool,
        sourceRef: l.source_ref,
        targetType: l.target_type,
        targetId: l.target_id,
        label: l.target_type === "invoice" ? (l.inv_no ?? "Deleted invoice") : l.target_type === "item" ? (l.item_name ?? "Deleted item") : (l.party_name ?? "Deleted party"),
        sub:
          l.target_type === "invoice"
            ? [l.inv_customer, l.inv_status, l.inv_total !== null ? `₹${round2(money(l.inv_total)).toLocaleString("en-IN")}` : null].filter(Boolean).join(" · ")
            : l.target_type === "item"
              ? (l.item_sku ?? "")
              : (l.party_kind ?? ""),
        exists: Boolean(l.inv_no ?? l.item_name ?? l.party_name),
        createdAt: tsOf(l.created_at),
        date: isoOf(l.created_at),
      })),
    });
  });
}
