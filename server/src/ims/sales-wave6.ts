/**
 * Wave 6 sales routes: invoice payment plans (installments), customer-portal links and multi-level dunning runs.
 * Registered from index.ts next to registerSales. Card auto-charge is intentionally not part of this wave.
 */
import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, one, rows, tx } from "./db.js";
import { badRequest, conflict, notFound } from "./host.js";
import { formatINR, round2, todayISO } from "./logic.js";
import { INVOICE_SELECT, addActivity, dateText, loadInvoiceRow, mapInvoice, type InvoiceRow } from "./sales.js";
import { getSettings } from "./settings.js";
import { listDunningRuns, loadInstallmentPlan, mapDunningRun, type DunningRunRow } from "./wave6-db.js";
import { dunningCopy, findDunningLevel, newPortalToken, pickDunningLevel, validateInstallments } from "./wave6-logic.js";

const portalPath = (token: string) => `/ims/portal/${token}`;

const InstallmentInput = z.object({
  label: optText(120),
  installments: z
    .array(
      z.object({
        dueOn: isoDate,
        amount: z.coerce.number().positive("Each installment needs an amount more than zero").max(1e12),
        label: optText(80),
      }),
    )
    .min(1, "Add at least one installment")
    .max(60),
});

const DunningRunInput = z
  .object({
    customerId: z.string().uuid().nullable().optional(),
    customerName: z.string().trim().max(200).optional(),
    levelKey: z.string().trim().min(1).max(24),
    invoiceIds: z.array(z.string().uuid()).max(500).optional(),
    notes: optText(500),
  })
  .refine((v) => Boolean(v.customerId) || Boolean(v.customerName?.trim()), { message: "Pick a customer", path: ["customerId"] });

export function registerSalesWave6(router: Router, deps: ImsDeps): void {
  /* ---------- Installment plans ---------- */

  router.get("/invoices/:id/installments", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "receivables"]);
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    const today = todayISO();
    const inv = mapInvoice(row, today);
    res.json({ plan: await loadInstallmentPlan(deps.db, actor.tenantId, row.id, today), balance: inv.balance });
  });

  router.post("/invoices/:id/installments", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(InstallmentInput, req.body);
    const today = todayISO();
    const { maxInstallments } = await getSettings(deps, actor.tenantId);
    const planId = randomUUID();
    const invoiceNo = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "issued") throw conflict("Payment plans can only be set on issued invoices");
      if ((r.doc_kind || "tax_invoice") !== "tax_invoice") throw conflict("Payment plans are for tax invoices");
      const balance = mapInvoice(r, today).balance;
      if (balance <= 0.005) throw conflict("This invoice is already settled — nothing left to schedule");
      const existing = await one<{ id: string }>(conn, `SELECT id FROM ims_installment_plans WHERE tenant_id = :tenantId AND invoice_id = :invoiceId LIMIT 1 FOR UPDATE`, {
        tenantId: actor.tenantId,
        invoiceId: r.id,
      });
      if (existing) throw conflict("This invoice already has a payment plan. Remove it first to create a new one.");
      const checked = validateInstallments(input.installments, balance, maxInstallments);
      if (!checked.ok) throw badRequest(checked.error);
      await exec(
        conn,
        `INSERT INTO ims_installment_plans (id, tenant_id, invoice_id, label, status, created_by, created_by_name)
         VALUES (:id, :tenantId, :invoiceId, :label, 'active', :userId, :userName)`,
        { id: planId, tenantId: actor.tenantId, invoiceId: r.id, label: input.label?.trim() || null, userId: actor.userId, userName: actorName(actor) },
      );
      for (const [i, it] of checked.items.entries()) {
        await exec(
          conn,
          `INSERT INTO ims_installment_schedule (id, tenant_id, plan_id, seq_no, due_on, amount, amount_paid, status, label)
           VALUES (:id, :tenantId, :planId, :seqNo, :dueOn, :amount, 0, 'pending', :label)`,
          { id: randomUUID(), tenantId: actor.tenantId, planId, seqNo: i + 1, dueOn: it.dueOn, amount: it.amount, label: it.label },
        );
      }
      await addActivity(conn, actor, {
        invoiceId: r.id,
        partyId: r.customer_id,
        partyName: r.customer_name,
        kind: "note",
        message: `Payment plan created: ${checked.items.length} installment${checked.items.length === 1 ? "" : "s"} totalling ${formatINR(checked.total)}`,
      });
      return r.invoice_no;
    });
    await recordEvent(deps, actor, {
      type: "invoice.installments_created",
      entityType: "invoice",
      entityId: req.params.id,
      summary: `Created a payment plan (${input.installments.length} installments) on ${invoiceNo}`,
    });
    res.status(201).json({ plan: await loadInstallmentPlan(deps.db, actor.tenantId, req.params.id, today) });
  });

  router.delete("/invoices/:id/installments", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const invoiceNo = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      const plan = await one<{ id: string }>(conn, `SELECT id FROM ims_installment_plans WHERE tenant_id = :tenantId AND invoice_id = :invoiceId LIMIT 1 FOR UPDATE`, {
        tenantId: actor.tenantId,
        invoiceId: r.id,
      });
      if (!plan) throw notFound("Payment plan");
      const paid = await one<{ total: string | null }>(conn, `SELECT SUM(amount_paid) AS total FROM ims_installment_schedule WHERE tenant_id = :tenantId AND plan_id = :planId`, {
        tenantId: actor.tenantId,
        planId: plan.id,
      });
      if (Number(paid?.total ?? 0) > 0.005) throw conflict("Payments are already allocated to this plan. Void those payments first, then remove the plan.");
      await exec(conn, `DELETE FROM ims_installment_schedule WHERE tenant_id = :tenantId AND plan_id = :planId`, { tenantId: actor.tenantId, planId: plan.id });
      await exec(conn, `DELETE FROM ims_installment_plans WHERE tenant_id = :tenantId AND id = :planId`, { tenantId: actor.tenantId, planId: plan.id });
      await addActivity(conn, actor, { invoiceId: r.id, partyId: r.customer_id, partyName: r.customer_name, kind: "note", message: "Payment plan removed" });
      return r.invoice_no;
    });
    await recordEvent(deps, actor, { type: "invoice.installments_removed", entityType: "invoice", entityId: req.params.id, summary: `Removed the payment plan on ${invoiceNo}` });
    res.status(204).end();
  });

  /* ---------- Customer portal (magic link, view + UPI QR — no payment capture) ---------- */

  const portalState = (token: string | null) => ({ enabled: Boolean(token), token: token ?? null, path: token ? portalPath(token) : null });

  router.get("/invoices/:id/portal", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["sales", "receivables"]);
    const row = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    res.json(portalState(row.portal_token ?? null));
  });

  router.post("/invoices/:id/portal/enable", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const input = parse(z.object({ regenerate: z.boolean().optional() }), req.body ?? {});
    const out = await tx(deps.db, async (conn) => {
      const r = await loadInvoiceRow(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "issued") throw conflict("The customer portal link is available once the invoice is issued");
      if ((r.doc_kind || "tax_invoice") === "proforma") throw conflict("Proforma invoices can't be shared through the portal");
      if (r.portal_token && !input.regenerate) return { token: r.portal_token, invoiceNo: r.invoice_no, created: false };
      const token = newPortalToken();
      await exec(conn, `UPDATE ims_invoices SET portal_token = :token WHERE tenant_id = :tenantId AND id = :id`, { token, tenantId: actor.tenantId, id: r.id });
      await addActivity(conn, actor, { invoiceId: r.id, partyId: r.customer_id, partyName: r.customer_name, kind: "note", message: r.portal_token ? "Customer portal link regenerated" : "Customer portal link enabled" });
      return { token, invoiceNo: r.invoice_no, created: true };
    });
    if (out.created) {
      await recordEvent(deps, actor, { type: "invoice.portal_enabled", entityType: "invoice", entityId: req.params.id, summary: `Enabled the customer portal link for ${out.invoiceNo}` });
    }
    res.json(portalState(out.token));
  });

  router.post("/invoices/:id/portal/disable", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "sales");
    const r = await loadInvoiceRow(deps.db, actor.tenantId, req.params.id);
    if (r.portal_token) {
      await exec(deps.db, `UPDATE ims_invoices SET portal_token = NULL WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: r.id });
      await addActivity(deps.db, actor, { invoiceId: r.id, partyId: r.customer_id, partyName: r.customer_name, kind: "note", message: "Customer portal link disabled" });
      await recordEvent(deps, actor, { type: "invoice.portal_disabled", entityType: "invoice", entityId: r.id, summary: `Disabled the customer portal link for ${r.invoice_no}` });
    }
    res.json(portalState(null));
  });

  /* ---------- Dunning sequences ---------- */

  router.get("/receivables/dunning-runs", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const customerId = qstr(req.query.customerId, 36) || null;
    const customerName = qstr(req.query.customerName, 200) || null;
    const runs = await listDunningRuns(deps.db, actor.tenantId, { customerId, customerName, limit: qint(req.query.limit, 20, 1, 200) });
    const settings = await getSettings(deps, actor.tenantId);
    res.json({ runs, levels: settings.dunningSequences });
  });

  router.post("/receivables/dunning-runs", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "receivables");
    const input = parse(DunningRunInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const level = findDunningLevel(settings.dunningSequences, input.levelKey);
    if (!level) throw badRequest(`Unknown dunning level “${input.levelKey}”. Configure levels in Settings → Reminders.`);
    const today = todayISO();
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    let who: string;
    if (input.customerId) {
      who = "i.customer_id = :customerId";
      params.customerId = input.customerId;
    } else {
      who = "i.customer_id IS NULL AND i.customer_name = :customerName";
      params.customerName = input.customerName!.trim();
    }
    if (input.invoiceIds?.length) params.ids = input.invoiceIds;
    const open = (
      await rows<InvoiceRow>(
        deps.db,
        `${INVOICE_SELECT}
         WHERE i.tenant_id = :tenantId AND i.status = 'issued' AND COALESCE(i.doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note') AND ${who}
           ${input.invoiceIds?.length ? "AND i.id IN (:ids)" : ""}
         ORDER BY i.due_date ASC, i.invoice_date ASC LIMIT 500`,
        params,
      )
    )
      .map((r) => mapInvoice(r, today))
      .filter((i) => i.balance > 0.005);
    if (!open.length) throw notFound("Open invoice for this customer");
    const overdue = open.filter((i) => i.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);
    const list = input.invoiceIds?.length ? open : overdue.length ? overdue : open;
    const customerName = list[0]!.customerName;
    const customerId = list[0]!.customerId;
    // Base-currency equivalent so a customer with USD + INR invoices gets one honest total.
    const totalDue = round2(list.reduce((s, i) => s + i.balance * (i.fxRate || 1), 0));
    const maxDays = list.reduce((m, i) => Math.max(m, i.daysOverdue), 0);
    const id = randomUUID();
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `INSERT INTO ims_dunning_runs (id, tenant_id, customer_id, customer_name, level_key, level_label, letter_tone, total_due, invoice_ids, status, prepared_by, prepared_by_name, notes)
         VALUES (:id, :tenantId, :customerId, :customerName, :levelKey, :levelLabel, :tone, :totalDue, :invoiceIds, 'prepared', :userId, :userName, :notes)`,
        {
          id,
          tenantId: actor.tenantId,
          customerId,
          customerName: customerName.slice(0, 200),
          levelKey: level.key,
          levelLabel: level.label,
          tone: level.tone,
          totalDue,
          invoiceIds: JSON.stringify(list.map((i) => i.id)),
          userId: actor.userId,
          userName: actorName(actor),
          notes: input.notes?.trim() || null,
        },
      );
      // A letter is a follow-up: show it on each invoice's activity and in "Last follow-up".
      for (const inv of list) {
        await addActivity(conn, actor, {
          invoiceId: inv.id,
          partyId: inv.customerId,
          partyName: inv.customerName,
          kind: "reminder",
          channel: "letter",
          templateKey: level.key,
          message: `Dunning ${level.key} · ${level.label} letter prepared`,
          status: "sent",
        });
        await exec(conn, `UPDATE ims_invoices SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, {
          tenantId: actor.tenantId,
          id: inv.id,
        });
      }
    });
    const run = await one<DunningRunRow>(deps.db, `SELECT * FROM ims_dunning_runs WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    await recordEvent(deps, actor, {
      type: "ar.dunning",
      entityType: "receivables",
      entityId: customerId ?? customerName,
      summary: `Prepared ${level.key} · ${level.label} letter for ${customerName} (${formatINR(totalDue)})`,
      payload: { levelKey: level.key, invoices: list.map((i) => i.invoiceNo) },
    });
    const business = settings.businessName || "Accounts team";
    const copy = dunningCopy(level.tone, { customer: customerName, total: formatINR(totalDue), asOf: dateText(today), count: list.length, business, payWithinDays: settings.dunningFirmPayWithinDays });
    res.status(201).json({
      run: run ? mapDunningRun(run) : null,
      suggestedLevelKey: pickDunningLevel(settings.dunningSequences, maxDays)?.key ?? settings.dunningSequences[0]?.key ?? null,
      letter: {
        levelKey: level.key,
        levelLabel: level.label,
        tone: level.tone,
        subject: copy.subject,
        intro: copy.intro,
        closing: copy.closing,
        asOf: today,
        customerName,
        businessName: business,
        totalDue,
        invoices: list.map((i) => ({
          invoiceNo: i.invoiceNo,
          invoiceDate: i.invoiceDate,
          dueDate: i.dueDate,
          daysOverdue: i.daysOverdue,
          balance: i.balance,
          currencyCode: i.currencyCode,
        })),
      },
    });
  });
}
