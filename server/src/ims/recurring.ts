import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, isoDate, optText, parse, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, notFound, type ImsActor } from "./host.js";
import { advanceRecurringDate, dueDateFor, todayISO } from "./logic.js";
import { createLinkedInvoice, LineInput } from "./sales.js";
import { getSettings } from "./settings.js";

const FREQUENCIES = ["days", "weeks", "months", "years"] as const;

const RecurringInput = z.object({
  profileName: z.string().trim().min(1, "Name this recurring profile").max(160),
  frequency: z.enum(FREQUENCIES).default("months"),
  repeatEvery: z.coerce.number().int().min(1).max(120).default(1),
  startOn: isoDate.optional(),
  endOn: isoDate.nullable().optional(),
  autoIssue: z.boolean().default(false),
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().trim().min(1).max(200),
  customerGstin: optText(20),
  customerAddress: optText(500),
  customerMobile: optText(40),
  placeOfSupply: optText(80),
  customerPoNo: optText(64),
  shipToName: optText(200),
  shipToGstin: optText(20),
  shipToAddress: optText(500),
  shipToState: optText(80),
  shipToMobile: optText(40),
  lines: z.array(LineInput).min(1).max(300),
  shippingCharges: z.coerce.number().min(0).max(1e10).optional(),
  shippingGstRate: z.coerce.number().min(0).max(100).optional(),
  roundToRupee: z.boolean().default(true),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  accountManagerId: z.coerce.number().int().positive().nullable().optional(),
  accountManagerName: optText(120),
  notes: optText(4000),
  terms: optText(4000),
  status: z.enum(["active", "paused", "ended"]).optional(),
});

type RecurringRow = {
  id: string;
  profile_name: string;
  status: string;
  frequency: string;
  repeat_every: number;
  start_on: unknown;
  next_run_on: unknown;
  end_on: unknown;
  auto_issue: number;
  customer_id: string | null;
  customer_name: string;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_mobile: string | null;
  place_of_supply: string | null;
  intra_state: number;
  customer_po_no: string | null;
  ship_to_name: string | null;
  ship_to_gstin: string | null;
  ship_to_address: string | null;
  ship_to_state: string | null;
  ship_to_mobile: string | null;
  lines: unknown;
  shipping_charges: string;
  shipping_gst_rate: string;
  round_to_rupee: number;
  payment_terms_days: number | null;
  account_manager_id: number | null;
  account_manager_name: string | null;
  notes: string | null;
  terms: string | null;
  last_run_on: unknown;
  last_invoice_id: string | null;
  last_invoice_no: string | null;
  run_count: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const mapRecurring = (r: RecurringRow) => ({
  id: r.id,
  profileName: r.profile_name,
  status: r.status as "active" | "paused" | "ended",
  frequency: r.frequency as (typeof FREQUENCIES)[number],
  repeatEvery: Number(r.repeat_every) || 1,
  startOn: isoOf(r.start_on),
  nextRunOn: isoOf(r.next_run_on),
  endOn: r.end_on ? isoOf(r.end_on) : null,
  autoIssue: Boolean(r.auto_issue),
  customerId: r.customer_id,
  customerName: r.customer_name,
  customerGstin: r.customer_gstin,
  customerAddress: r.customer_address,
  customerMobile: r.customer_mobile,
  placeOfSupply: r.place_of_supply,
  intraState: Boolean(r.intra_state),
  customerPoNo: r.customer_po_no,
  shipToName: r.ship_to_name,
  shipToGstin: r.ship_to_gstin,
  shipToAddress: r.ship_to_address,
  shipToState: r.ship_to_state,
  shipToMobile: r.ship_to_mobile,
  lines: json(r.lines, []),
  shippingCharges: Number(r.shipping_charges) || 0,
  shippingGstRate: Number(r.shipping_gst_rate) || 0,
  roundToRupee: Boolean(r.round_to_rupee),
  paymentTermsDays: r.payment_terms_days == null ? null : Number(r.payment_terms_days),
  accountManagerId: r.account_manager_id == null ? null : Number(r.account_manager_id),
  accountManagerName: r.account_manager_name,
  notes: r.notes,
  terms: r.terms,
  lastRunOn: r.last_run_on ? isoOf(r.last_run_on) : null,
  lastInvoiceId: r.last_invoice_id,
  lastInvoiceNo: r.last_invoice_no,
  runCount: Number(r.run_count) || 0,
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
  updatedAt: tsOf(r.updated_at),
});

async function loadRecurring(db: Queryable, tenantId: number, id: string, lock = false): Promise<RecurringRow> {
  const r = lock
    ? await one<RecurringRow>(db, `SELECT * FROM ims_recurring_invoices WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id })
    : await one<RecurringRow>(db, `SELECT * FROM ims_recurring_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  if (!r) throw notFound("Recurring invoice");
  return r;
}

async function generateFromProfile(deps: ImsDeps, actor: ImsActor, profile: RecurringRow, opts: { issue: boolean }) {
  const settings = await getSettings(deps, actor.tenantId);
  const lines = json<Array<{ itemId?: string | null; name: string; sku?: string | null; hsn?: string | null; unit?: string | null; qty: number; rate: number; discountPct?: number; gstRate: number }>>(
    profile.lines,
    [],
  );
  if (!lines.length) throw badRequest("Add at least one line to the recurring profile");
  const invoiceDate = todayISO();
  const termsDays = profile.payment_terms_days ?? settings.paymentTermsDays;
  const dueDate = dueDateFor(invoiceDate, termsDays, settings.paymentTermsDays);
  const detail = await createLinkedInvoice(
    deps,
    actor,
    {
      customerId: profile.customer_id,
      customerName: profile.customer_name,
      customerGstin: profile.customer_gstin,
      customerAddress: profile.customer_address,
      customerMobile: profile.customer_mobile,
      customerPoNo: profile.customer_po_no,
      shipToName: profile.ship_to_name,
      shipToGstin: profile.ship_to_gstin,
      shipToAddress: profile.ship_to_address,
      shipToState: profile.ship_to_state,
      shipToMobile: profile.ship_to_mobile,
      placeOfSupply: profile.place_of_supply,
      invoiceDate,
      dueDate,
      docKind: "tax_invoice",
      shippingCharges: Number(profile.shipping_charges) || 0,
      shippingGstRate: Number(profile.shipping_gst_rate) || 0,
      lines: lines.map((l) => ({
        itemId: l.itemId ?? null,
        name: l.name,
        sku: l.sku ?? null,
        hsn: l.hsn ?? null,
        unit: l.unit ?? null,
        qty: l.qty,
        rate: l.rate,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
      })),
      roundToRupee: Boolean(profile.round_to_rupee),
      notes: profile.notes,
      terms: profile.terms,
      accountManagerId: profile.account_manager_id,
      accountManagerName: profile.account_manager_name,
      issue: opts.issue,
      sourceTool: "recurring",
      sourceRef: profile.id,
    },
    {
      after: async (conn, invoiceId) => {
        await exec(conn, `UPDATE ims_invoices SET recurring_id = :rid WHERE tenant_id = :tenantId AND id = :id`, {
          tenantId: actor.tenantId,
          rid: profile.id,
          id: invoiceId,
        });
      },
    },
  );
  return detail;
}

export function registerRecurring(deps: ImsDeps, router: Router): void {
  router.get("/recurring-invoices", async (_req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const list = await rows<RecurringRow>(
      deps.db,
      `SELECT * FROM ims_recurring_invoices WHERE tenant_id = :tenantId ORDER BY status ASC, next_run_on ASC, updated_at DESC LIMIT 500`,
      { tenantId: actor.tenantId },
    );
    res.json({ profiles: list.map(mapRecurring) });
  });

  router.get("/recurring-invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    res.json({ profile: mapRecurring(await loadRecurring(deps.db, actor.tenantId, req.params.id)) });
  });

  router.post("/recurring-invoices", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(RecurringInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const startOn = input.startOn ?? todayISO();
    if (input.endOn && input.endOn < startOn) throw badRequest("End date can't be before the start date");
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_recurring_invoices
         (id, tenant_id, profile_name, status, frequency, repeat_every, start_on, next_run_on, end_on, auto_issue,
          customer_id, customer_name, customer_gstin, customer_address, customer_mobile, place_of_supply, intra_state,
          customer_po_no, ship_to_name, ship_to_gstin, ship_to_address, ship_to_state, ship_to_mobile,
          \`lines\`, shipping_charges, shipping_gst_rate, round_to_rupee, payment_terms_days,
          account_manager_id, account_manager_name, notes, terms, created_by, created_by_name)
       VALUES
         (:id, :tenantId, :profileName, 'active', :frequency, :repeatEvery, :startOn, :nextRunOn, :endOn, :autoIssue,
          :customerId, :customerName, :customerGstin, :customerAddress, :customerMobile, :placeOfSupply, 1,
          :customerPoNo, :shipToName, :shipToGstin, :shipToAddress, :shipToState, :shipToMobile,
          :lines, :shippingCharges, :shippingGstRate, :roundToRupee, :paymentTermsDays,
          :accountManagerId, :accountManagerName, :notes, :terms, :userId, :userName)`,
      {
        id,
        tenantId: actor.tenantId,
        profileName: input.profileName,
        frequency: input.frequency,
        repeatEvery: input.repeatEvery,
        startOn,
        nextRunOn: startOn,
        endOn: input.endOn ?? null,
        autoIssue: input.autoIssue ? 1 : 0,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerGstin: input.customerGstin ?? null,
        customerAddress: input.customerAddress ?? null,
        customerMobile: input.customerMobile ?? null,
        placeOfSupply: input.placeOfSupply ?? settings.state,
        customerPoNo: input.customerPoNo ?? null,
        shipToName: input.shipToName ?? null,
        shipToGstin: input.shipToGstin ?? null,
        shipToAddress: input.shipToAddress ?? null,
        shipToState: input.shipToState ?? null,
        shipToMobile: input.shipToMobile ?? null,
        lines: JSON.stringify(input.lines),
        shippingCharges: input.shippingCharges ?? 0,
        shippingGstRate: input.shippingGstRate ?? 0,
        roundToRupee: input.roundToRupee ? 1 : 0,
        paymentTermsDays: input.paymentTermsDays ?? settings.paymentTermsDays,
        accountManagerId: input.accountManagerId ?? null,
        accountManagerName: input.accountManagerName ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? settings.terms ?? null,
        userId: actor.userId,
        userName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, {
      type: "recurring.created",
      entityType: "recurring_invoice",
      entityId: id,
      summary: `Recurring profile “${input.profileName}” for ${input.customerName}`,
    });
    res.status(201).json({ profile: mapRecurring(await loadRecurring(deps.db, actor.tenantId, id)) });
  });

  router.patch("/recurring-invoices/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(RecurringInput.partial().extend({ nextRunOn: isoDate.optional() }), req.body);
    await tx(deps.db, async (conn) => {
      const existing = await loadRecurring(conn, actor.tenantId, req.params.id, true);
      if (existing.status === "ended" && input.status !== "active") throw conflict("This recurring profile has ended");
      const next = {
        profileName: input.profileName ?? existing.profile_name,
        frequency: input.frequency ?? existing.frequency,
        repeatEvery: input.repeatEvery ?? existing.repeat_every,
        endOn: input.endOn !== undefined ? input.endOn : existing.end_on ? isoOf(existing.end_on) : null,
        autoIssue: input.autoIssue !== undefined ? (input.autoIssue ? 1 : 0) : existing.auto_issue,
        customerId: input.customerId !== undefined ? input.customerId : existing.customer_id,
        customerName: input.customerName ?? existing.customer_name,
        customerGstin: input.customerGstin !== undefined ? input.customerGstin : existing.customer_gstin,
        customerAddress: input.customerAddress !== undefined ? input.customerAddress : existing.customer_address,
        customerMobile: input.customerMobile !== undefined ? input.customerMobile : existing.customer_mobile,
        placeOfSupply: input.placeOfSupply !== undefined ? input.placeOfSupply : existing.place_of_supply,
        customerPoNo: input.customerPoNo !== undefined ? input.customerPoNo : existing.customer_po_no,
        shipToName: input.shipToName !== undefined ? input.shipToName : existing.ship_to_name,
        shipToGstin: input.shipToGstin !== undefined ? input.shipToGstin : existing.ship_to_gstin,
        shipToAddress: input.shipToAddress !== undefined ? input.shipToAddress : existing.ship_to_address,
        shipToState: input.shipToState !== undefined ? input.shipToState : existing.ship_to_state,
        shipToMobile: input.shipToMobile !== undefined ? input.shipToMobile : existing.ship_to_mobile,
        lines: input.lines ? JSON.stringify(input.lines) : existing.lines,
        shippingCharges: input.shippingCharges ?? Number(existing.shipping_charges),
        shippingGstRate: input.shippingGstRate ?? Number(existing.shipping_gst_rate),
        roundToRupee: input.roundToRupee !== undefined ? (input.roundToRupee ? 1 : 0) : existing.round_to_rupee,
        paymentTermsDays: input.paymentTermsDays !== undefined ? input.paymentTermsDays : existing.payment_terms_days,
        accountManagerId: input.accountManagerId !== undefined ? input.accountManagerId : existing.account_manager_id,
        accountManagerName: input.accountManagerName !== undefined ? input.accountManagerName : existing.account_manager_name,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        terms: input.terms !== undefined ? input.terms : existing.terms,
        status: input.status ?? existing.status,
        nextRunOn: input.nextRunOn ?? isoOf(existing.next_run_on),
      };
      await exec(
        conn,
        `UPDATE ims_recurring_invoices SET profile_name = :profileName, frequency = :frequency, repeat_every = :repeatEvery, end_on = :endOn, auto_issue = :autoIssue,
           customer_id = :customerId, customer_name = :customerName, customer_gstin = :customerGstin, customer_address = :customerAddress, customer_mobile = :customerMobile,
           place_of_supply = :placeOfSupply, customer_po_no = :customerPoNo,
           ship_to_name = :shipToName, ship_to_gstin = :shipToGstin, ship_to_address = :shipToAddress, ship_to_state = :shipToState, ship_to_mobile = :shipToMobile,
           \`lines\` = :lines, shipping_charges = :shippingCharges, shipping_gst_rate = :shippingGstRate, round_to_rupee = :roundToRupee,
           payment_terms_days = :paymentTermsDays, account_manager_id = :accountManagerId, account_manager_name = :accountManagerName,
           notes = :notes, terms = :terms, status = :status, next_run_on = :nextRunOn
         WHERE tenant_id = :tenantId AND id = :id`,
        { ...next, tenantId: actor.tenantId, id: existing.id },
      );
    });
    res.json({ profile: mapRecurring(await loadRecurring(deps.db, actor.tenantId, req.params.id)) });
  });

  /** Generate the next invoice now (does not wait for next_run_on). */
  router.post("/recurring-invoices/:id/run", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const body = parse(z.object({ issue: z.boolean().optional() }), req.body ?? {});
    const today = todayISO();
    const out = await tx(deps.db, async (conn) => {
      const profile = await loadRecurring(conn, actor.tenantId, req.params.id, true);
      if (profile.status !== "active") throw conflict("Only active recurring profiles can generate invoices");
      if (profile.end_on && isoOf(profile.end_on) < today) {
        await exec(conn, `UPDATE ims_recurring_invoices SET status = 'ended' WHERE tenant_id = :tenantId AND id = :id`, {
          tenantId: actor.tenantId,
          id: profile.id,
        });
        throw conflict("This recurring profile has reached its end date");
      }
      return { profile, issue: body.issue ?? Boolean(profile.auto_issue) };
    });
    const detail = await generateFromProfile(deps, actor, out.profile, { issue: out.issue });
    const nextRun = advanceRecurringDate(today, out.profile.frequency as "days" | "weeks" | "months" | "years", out.profile.repeat_every);
    const ended = out.profile.end_on && isoOf(out.profile.end_on) < nextRun;
    await exec(
      deps.db,
      `UPDATE ims_recurring_invoices SET last_run_on = :today, last_invoice_id = :invId, last_invoice_no = :invNo, run_count = run_count + 1,
         next_run_on = :nextRun, status = IF(:ended, 'ended', status)
       WHERE tenant_id = :tenantId AND id = :id`,
      {
        tenantId: actor.tenantId,
        id: out.profile.id,
        today,
        invId: detail.invoice.id,
        invNo: detail.invoice.invoiceNo,
        nextRun,
        ended: ended ? 1 : 0,
      },
    );
    await recordEvent(deps, actor, {
      type: "recurring.run",
      entityType: "recurring_invoice",
      entityId: out.profile.id,
      summary: `Generated ${detail.invoice.invoiceNo} from “${out.profile.profile_name}”`,
      payload: { invoiceId: detail.invoice.id, issued: out.issue },
    });
    res.status(201).json({ invoice: detail, profile: mapRecurring(await loadRecurring(deps.db, actor.tenantId, out.profile.id)) });
  });

  /** Process all due active profiles (scheduler / manual tick). */
  router.post("/recurring-invoices/tick", async (_req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const today = todayISO();
    const due = await rows<RecurringRow>(
      deps.db,
      `SELECT * FROM ims_recurring_invoices WHERE tenant_id = :tenantId AND status = 'active' AND next_run_on <= :today
         AND (end_on IS NULL OR end_on >= :today) ORDER BY next_run_on ASC LIMIT 100`,
      { tenantId: actor.tenantId, today },
    );
    const created: Array<{ profileId: string; invoiceId: string; invoiceNo: string }> = [];
    const errors: Array<{ profileId: string; error: string }> = [];
    for (const profile of due) {
      try {
        const detail = await generateFromProfile(deps, actor, profile, { issue: Boolean(profile.auto_issue) });
        const nextRun = advanceRecurringDate(today, profile.frequency as "days" | "weeks" | "months" | "years", profile.repeat_every);
        const ended = profile.end_on && isoOf(profile.end_on) < nextRun;
        await exec(
          deps.db,
          `UPDATE ims_recurring_invoices SET last_run_on = :today, last_invoice_id = :invId, last_invoice_no = :invNo, run_count = run_count + 1,
             next_run_on = :nextRun, status = IF(:ended, 'ended', status)
           WHERE tenant_id = :tenantId AND id = :id`,
          {
            tenantId: actor.tenantId,
            id: profile.id,
            today,
            invId: detail.invoice.id,
            invNo: detail.invoice.invoiceNo,
            nextRun,
            ended: ended ? 1 : 0,
          },
        );
        created.push({ profileId: profile.id, invoiceId: detail.invoice.id, invoiceNo: detail.invoice.invoiceNo });
      } catch (err) {
        errors.push({ profileId: profile.id, error: err instanceof Error ? err.message : "Failed" });
      }
    }
    res.json({ today, due: due.length, created, errors });
  });
}
