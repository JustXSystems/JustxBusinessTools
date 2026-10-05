import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, parsePatch, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, one, rows } from "./db.js";
import { forbidden, isManager, notFound, type BosActor } from "./host.js";
import { normalizeLeavePolicy, parseWeekendDays, type LeavePolicy } from "./logic.js";

/* ---------- Settings ---------- */

export type BosSettings = {
  companyName: string;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  invoicePrefix: string;
  employeePrefix: string;
  fiscalYearStart: number;
  defaultTaxRate: number;
  paymentTermsDays: number;
  invoiceNotes: string | null;
  weekendDays: number[];
  leavePolicy: LeavePolicy;
  autoSync: boolean;
};

type SettingsRow = {
  company_name: string | null;
  gstin: string | null;
  state: string | null;
  state_code: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  invoice_prefix: string;
  employee_prefix: string;
  fiscal_year_start: number;
  default_tax_rate: string | number;
  payment_terms_days: number;
  invoice_notes: string | null;
  weekend_days: string;
  leave_policy: unknown;
  auto_sync: number;
};

const mapSettings = (r: SettingsRow): BosSettings => ({
  companyName: r.company_name ?? "",
  gstin: r.gstin,
  state: r.state,
  stateCode: r.state_code,
  address: r.address,
  email: r.email,
  phone: r.phone,
  invoicePrefix: r.invoice_prefix,
  employeePrefix: r.employee_prefix,
  fiscalYearStart: Number(r.fiscal_year_start) || 4,
  defaultTaxRate: money(r.default_tax_rate),
  paymentTermsDays: Number(r.payment_terms_days) || 0,
  invoiceNotes: r.invoice_notes,
  weekendDays: parseWeekendDays(r.weekend_days),
  leavePolicy: normalizeLeavePolicy(json(r.leave_policy, {})),
  autoSync: Boolean(r.auto_sync),
});

/** Settings for a tenant, seeded from the host brand (business profile) on first use. */
export async function getSettings(deps: BosDeps, tenantId: number): Promise<BosSettings> {
  const sql = `SELECT * FROM bos_settings WHERE tenant_id = :tenantId LIMIT 1`;
  const existing = await one<SettingsRow>(deps.db, sql, { tenantId });
  if (existing) return mapSettings(existing);
  const brand = await deps.host.brand(tenantId).catch(() => null);
  /* Automatic sync starts off: its first run imports every eligible past quotation and survey,
     so a manager opts in from Settings → Integrations. */
  await exec(
    deps.db,
    `INSERT IGNORE INTO bos_settings (tenant_id, company_name, gstin, state, state_code, address, email, phone, auto_sync)
     VALUES (:tenantId, :name, :gstin, :state, :stateCode, :address, :email, :phone, 0)`,
    {
      tenantId,
      name: brand?.name || null,
      gstin: brand?.gstin ?? null,
      state: brand?.state ?? null,
      stateCode: brand?.stateCode ?? null,
      address: brand?.address ?? null,
      email: brand?.email ?? null,
      phone: brand?.phone ?? null,
    },
  );
  return mapSettings((await one<SettingsRow>(deps.db, sql, { tenantId }))!);
}

const SettingsInput = z.object({
  companyName: z.string().trim().max(200).optional(),
  gstin: optText(20),
  state: optText(80),
  stateCode: optText(4),
  address: optText(500),
  email: optText(180),
  phone: optText(40),
  invoicePrefix: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only").optional(),
  employeePrefix: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only").optional(),
  fiscalYearStart: z.coerce.number().int().min(1).max(12).optional(),
  defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  invoiceNotes: optText(2000),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(6).optional(),
  leavePolicy: z.record(z.string(), z.coerce.number().min(0).max(366)).optional(),
  autoSync: z.boolean().optional(),
});

const COLUMN: Record<string, string> = {
  companyName: "company_name",
  gstin: "gstin",
  state: "state",
  stateCode: "state_code",
  address: "address",
  email: "email",
  phone: "phone",
  invoicePrefix: "invoice_prefix",
  employeePrefix: "employee_prefix",
  fiscalYearStart: "fiscal_year_start",
  defaultTaxRate: "default_tax_rate",
  paymentTermsDays: "payment_terms_days",
  invoiceNotes: "invoice_notes",
  weekendDays: "weekend_days",
  leavePolicy: "leave_policy",
  autoSync: "auto_sync",
};

/* ---------- Projects ---------- */

export const PROJECT_STATUSES = ["lead", "planned", "active", "on_hold", "completed", "cancelled"] as const;

type ProjectRow = {
  id: string;
  name: string;
  party_id: string | null;
  party_name: string | null;
  status: string;
  site_address: string | null;
  value_estimate: string | number;
  start_date: string | null;
  due_date: string | null;
  notes: string | null;
  source_tool: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

const mapProject = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  partyId: r.party_id,
  partyName: r.party_name,
  status: r.status,
  siteAddress: r.site_address,
  valueEstimate: money(r.value_estimate),
  startDate: r.start_date,
  dueDate: r.due_date,
  notes: r.notes,
  sourceTool: r.source_tool,
  sourceRef: r.source_ref,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  partyId: z.string().max(36).nullable().optional(),
  partyName: optText(200),
  status: z.enum(PROJECT_STATUSES).default("lead"),
  siteAddress: optText(500),
  valueEstimate: z.coerce.number().min(0).max(1e12).default(0),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  notes: optText(4000),
});

export async function createProject(
  deps: BosDeps,
  actor: BosActor,
  input: z.infer<typeof ProjectInput> & { sourceTool?: string | null; sourceRef?: string | null },
  conn?: PoolConnection,
): Promise<string> {
  const id = randomUUID();
  await exec(
    conn ?? deps.db,
    `INSERT INTO bos_projects (id, tenant_id, name, party_id, party_name, status, site_address, value_estimate,
       start_date, due_date, notes, source_tool, source_ref, created_by)
     VALUES (:id, :tenantId, :name, :partyId, :partyName, :status, :siteAddress, :valueEstimate,
       :startDate, :dueDate, :notes, :sourceTool, :sourceRef, :userId)`,
    {
      id,
      tenantId: actor.tenantId,
      name: input.name,
      partyId: input.partyId ?? null,
      partyName: input.partyName ?? null,
      status: input.status,
      siteAddress: input.siteAddress ?? null,
      valueEstimate: input.valueEstimate,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      sourceTool: input.sourceTool ?? null,
      sourceRef: input.sourceRef ?? null,
      userId: actor.userId,
    },
  );
  return id;
}

/* ---------- Routes ---------- */

export function registerWorkspace(router: Router, deps: BosDeps): void {
  /** Bootstrap for both the JBT tool and the standalone app. */
  router.get("/session", async (_req, res) => {
    const actor = actorOf(res);
    const [settings, brand] = await Promise.all([getSettings(deps, actor.tenantId), deps.host.brand(actor.tenantId).catch(() => null)]);
    res.json({
      host: deps.host.id,
      actor: { name: actor.name, email: actor.email, role: actor.role, canManage: isManager(actor), userId: actor.userId },
      tenantId: actor.tenantId,
      settings,
      brand,
      connectors: deps.connectors.map((c) => ({ id: c.id, label: c.label, icon: c.icon, href: c.href })),
    });
  });

  router.get("/settings", async (_req, res) => {
    res.json({ settings: await getSettings(deps, actorOf(res).tenantId) });
  });

  router.put("/settings", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    await getSettings(deps, actor.tenantId);
    const input = parse(SettingsInput, req.body);
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || !COLUMN[key]) continue;
      sets.push(`${COLUMN[key]} = :${key}`);
      if (key === "weekendDays") params[key] = (value as number[]).join(",") || "0";
      else if (key === "leavePolicy") params[key] = JSON.stringify(normalizeLeavePolicy(value));
      else if (key === "autoSync") params[key] = value ? 1 : 0;
      else if (key === "invoicePrefix" || key === "employeePrefix") params[key] = String(value).toUpperCase();
      else params[key] = value;
    }
    if (sets.length) await exec(deps.db, `UPDATE bos_settings SET ${sets.join(", ")} WHERE tenant_id = :tenantId`, params);
    await recordEvent(deps, actor, { type: "settings.update", entityType: "settings", entityId: String(actor.tenantId), summary: "Updated BOS settings", payload: { fields: Object.keys(input) }, ip: req.ip });
    res.json({ settings: await getSettings(deps, actor.tenantId) });
  });

  router.get("/events", async (req, res) => {
    const actor = actorOf(res);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
    const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;
    const list = await rows<Record<string, unknown>>(
      deps.db,
      `SELECT id, actor_name, event_type, entity_type, entity_id, summary, created_at
       FROM bos_events
       WHERE tenant_id = :tenantId
         ${entityType ? "AND entity_type = :entityType" : ""}
         ${entityId ? "AND entity_id = :entityId" : ""}
       ORDER BY id DESC LIMIT ${limit}`,
      { tenantId: actor.tenantId, entityType, entityId },
    );
    res.json({
      events: list.map((e) => ({
        id: Number(e.id),
        actorName: e.actor_name,
        type: e.event_type,
        entityType: e.entity_type,
        entityId: e.entity_id,
        summary: e.summary,
        createdAt: e.created_at,
      })),
    });
  });

  router.get("/projects", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<ProjectRow>(deps.db, `SELECT * FROM bos_projects WHERE tenant_id = :tenantId ORDER BY updated_at DESC LIMIT 500`, { tenantId: actor.tenantId });
    res.json({ projects: list.map(mapProject) });
  });

  router.post("/projects", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(ProjectInput, req.body);
    const id = await createProject(deps, actor, input);
    await recordEvent(deps, actor, { type: "project.create", entityType: "project", entityId: id, summary: `Created project ${input.name}`, ip: req.ip });
    const row = await one<ProjectRow>(deps.db, `SELECT * FROM bos_projects WHERE id = :id`, { id });
    res.status(201).json({ project: mapProject(row!) });
  });

  router.patch("/projects/:id", async (req, res) => {
    const actor = actorOf(res);
    const input = parsePatch(ProjectInput, req.body);
    const existing = await one<ProjectRow>(deps.db, `SELECT * FROM bos_projects WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!existing) throw notFound("Project");
    const merged = { ...mapProject(existing), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    await exec(
      deps.db,
      `UPDATE bos_projects SET name = :name, party_id = :partyId, party_name = :partyName, status = :status,
         site_address = :siteAddress, value_estimate = :valueEstimate, start_date = :startDate, due_date = :dueDate, notes = :notes
       WHERE id = :id AND tenant_id = :tenantId`,
      { ...merged, id: existing.id, tenantId: actor.tenantId },
    );
    if (input.status && input.status !== existing.status) {
      await recordEvent(deps, actor, {
        type: "project.status",
        entityType: "project",
        entityId: existing.id,
        summary: `${existing.name}: ${existing.status} → ${input.status}`,
        notice: { kind: "workflow", title: "Project stage changed", body: `${existing.name} moved to ${input.status.replace("_", " ")}`, path: "?ws=projects" },
        ip: req.ip,
      });
    }
    const row = await one<ProjectRow>(deps.db, `SELECT * FROM bos_projects WHERE id = :id`, { id: existing.id });
    res.json({ project: mapProject(row!) });
  });
}
