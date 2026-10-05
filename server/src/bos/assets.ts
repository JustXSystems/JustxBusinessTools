import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ASSET_CATEGORIES, bookValue, DEPRECIATION_METHODS, depreciationSchedule, yearFigures, type AssetStatus, type DepreciableAsset, type DepreciationMethod } from "./asset-logic.js";
import { actorOf, isoDate, optText, parse, recordEvent, type BosDeps } from "./context.js";
import { exec, money, nextSequence, one, rows } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { addDaysISO, fiscalYearLabel, fiscalYearStart, round2, todayISO } from "./logic.js";
import { getSettings } from "./workspace.js";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Assets are available to owners and admins");
};

/** Blank strings from forms mean "not set". */
const blank = <S extends z.ZodType>(schema: S) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

/* ---------- Inputs ---------- */

const AssetFields = {
  tag: blank(z.string().trim().max(40)),
  name: z.string().trim().min(1, "Required").max(160),
  category: z.string().trim().min(1, "Choose a category").max(60),
  serialNo: blank(z.string().trim().max(80)),
  vendorName: blank(z.string().trim().max(200)),
  billId: blank(z.string().max(36)),
  purchaseDate: isoDate,
  cost: z.coerce.number().positive("Cost must be more than zero").max(1e12),
  salvageValue: z.coerce.number().min(0, "Can't be negative").max(1e12),
  method: z.enum(DEPRECIATION_METHODS),
  rate: z.coerce.number().min(0).max(100, "Use a yearly rate up to 100%"),
  warrantyUntil: blank(isoDate),
  notes: blank(z.string().trim().max(2000)),
};
const AssetInput = z
  .object({
    ...AssetFields,
    salvageValue: AssetFields.salvageValue.default(0),
    method: AssetFields.method.default("slm"),
    rate: AssetFields.rate.default(0),
    location: blank(z.string().trim().max(120)),
    departmentId: blank(z.string().max(36)),
    employeeId: blank(z.string().max(36)),
  })
  .refine((a) => a.salvageValue <= a.cost, { path: ["salvageValue"], message: "Salvage value can't be more than the cost" });
const AssetPatch = z.object(AssetFields).partial();

const actionDate = { date: isoDate, note: optText(300) };
const AssignInput = z.object({ employeeId: z.string().max(36).nullable(), ...actionDate });
const TransferInput = z.object({ departmentId: blank(z.string().max(36)), location: blank(z.string().trim().max(120)), ...actionDate });
const MaintenanceInput = z.object({ action: z.enum(["start", "end"]), cost: z.coerce.number().min(0).max(1e12).optional(), ...actionDate });
const DisposeInput = z.object({ amount: z.coerce.number().min(0, "Can't be negative").max(1e12).default(0), ...actionDate });

/* ---------- Rows ---------- */

type AssetRow = {
  id: string;
  tag: string;
  name: string;
  category: string;
  serial_no: string | null;
  location: string | null;
  department_id: string | null;
  department_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  vendor_name: string | null;
  bill_id: string | null;
  purchase_date: string;
  cost: string | number;
  salvage_value: string | number;
  method: DepreciationMethod;
  rate: string | number;
  status: AssetStatus;
  warranty_until: string | null;
  disposed_on: string | null;
  disposal_amount: string | number | null;
  disposal_note: string | null;
  notes: string | null;
  created_at: string;
};
type EventRow = {
  id: string;
  kind: string;
  event_date: string;
  employee_name: string | null;
  department_name: string | null;
  location: string | null;
  amount: string | number | null;
  note: string | null;
  created_at: string;
};

const ASSET_SELECT = `
  SELECT a.*, NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), '') AS employee_name, d.name AS department_name
  FROM bos_assets a
  LEFT JOIN bos_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
  LEFT JOIN bos_departments d ON d.id = a.department_id AND d.tenant_id = a.tenant_id`;

const depreciable = (r: AssetRow): DepreciableAsset => ({
  cost: money(r.cost),
  salvage: money(r.salvage_value),
  method: r.method,
  rate: money(r.rate),
  purchaseDate: r.purchase_date,
  disposedOn: r.disposed_on,
});

function mapAsset(r: AssetRow, today: string, fyMonth: number) {
  const d = depreciable(r);
  const fyStart = fiscalYearStart(today, fyMonth);
  const schedule = depreciationSchedule(d, today, fyMonth);
  const book = schedule.length ? schedule[schedule.length - 1].closing : d.cost;
  return {
    id: r.id,
    tag: r.tag,
    name: r.name,
    category: r.category,
    serialNo: r.serial_no,
    location: r.location,
    departmentId: r.department_id,
    departmentName: r.department_name,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    vendorName: r.vendor_name,
    billId: r.bill_id,
    purchaseDate: r.purchase_date,
    cost: d.cost,
    salvageValue: d.salvage,
    method: r.method,
    rate: d.rate,
    status: r.status,
    warrantyUntil: r.warranty_until,
    disposedOn: r.disposed_on,
    disposalAmount: r.disposal_amount === null ? null : money(r.disposal_amount),
    disposalNote: r.disposal_note,
    notes: r.notes,
    bookValue: book,
    accumulated: round2(d.cost - book),
    depreciationThisFy: schedule.find((s) => s.fyStart === fyStart)?.depreciation ?? 0,
    createdAt: r.created_at,
  };
}
export type BosAsset = ReturnType<typeof mapAsset>;

const mapEvent = (r: EventRow) => ({
  id: r.id,
  kind: r.kind,
  date: r.event_date,
  employeeName: r.employee_name,
  departmentName: r.department_name,
  location: r.location,
  amount: r.amount === null ? null : money(r.amount),
  note: r.note,
  createdAt: r.created_at,
});

async function loadAsset(db: BosDeps["db"], tenantId: number, id: string): Promise<AssetRow> {
  const row = await one<AssetRow>(db, `${ASSET_SELECT} WHERE a.id = :id AND a.tenant_id = :t`, { id, t: tenantId });
  if (!row) throw notFound("Asset");
  return row;
}

async function employeeOf(db: BosDeps["db"], tenantId: number, id: string) {
  const e = await one<{ id: string; name: string; status: string }>(
    db,
    `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, status FROM bos_employees WHERE id = :id AND tenant_id = :t`,
    { id, t: tenantId },
  );
  if (!e) throw notFound("Employee");
  if (e.status === "exited") throw new BosError(409, `${e.name} has left — assign the asset to someone else`);
  return e;
}

async function departmentOf(db: BosDeps["db"], tenantId: number, id: string) {
  const d = await one<{ id: string; name: string }>(db, `SELECT id, name FROM bos_departments WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!d) throw notFound("Department");
  return d;
}

async function billOf(db: BosDeps["db"], tenantId: number, id: string) {
  const b = await one<{ id: string }>(db, `SELECT id FROM bos_bills WHERE id = :id AND tenant_id = :t`, { id, t: tenantId });
  if (!b) throw notFound("Bill");
}

async function newTag(db: BosDeps["db"], tenantId: number): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const tag = `AST-${String(await nextSequence(db, tenantId, "asset", "all")).padStart(4, "0")}`;
    if (!(await one(db, `SELECT id FROM bos_assets WHERE tenant_id = :t AND tag = :tag`, { t: tenantId, tag }))) return tag;
  }
  throw new BosError(409, "Couldn't pick a free asset tag — enter one");
}

async function addEvent(
  db: BosDeps["db"],
  actor: BosActor,
  assetId: string,
  kind: string,
  date: string,
  extra: { employeeId?: string | null; employeeName?: string | null; departmentName?: string | null; location?: string | null; amount?: number | null; note?: string | null } = {},
) {
  await exec(
    db,
    `INSERT INTO bos_asset_events (id, tenant_id, asset_id, kind, event_date, employee_id, employee_name, department_name, location, amount, note, created_by)
     VALUES (:id, :t, :assetId, :kind, :date, :employeeId, :employeeName, :departmentName, :location, :amount, :note, :userId)`,
    {
      id: randomUUID(),
      t: actor.tenantId,
      assetId,
      kind,
      date,
      employeeId: extra.employeeId ?? null,
      employeeName: extra.employeeName ?? null,
      departmentName: extra.departmentName ?? null,
      location: extra.location ?? null,
      amount: extra.amount ?? null,
      note: extra.note ?? null,
      userId: actor.userId,
    },
  );
}

/** Action dates sit between the purchase date and today. */
function checkDate(date: string, a: AssetRow, today: string) {
  if (date > today) throw new BosError(400, "The date can't be in the future");
  if (date < a.purchase_date) throw new BosError(400, `The date can't be before the purchase date (${a.purchase_date})`);
}

function notDisposed(a: AssetRow) {
  if (a.status === "disposed") throw new BosError(409, "This asset has been disposed of — reinstate it first");
}

/* ---------- Routes ---------- */

export function registerAssets(router: Router, deps: BosDeps): void {
  const context = async (tenantId: number) => {
    const settings = await getSettings(deps, tenantId);
    return { today: todayISO(), fyMonth: settings.fiscalYearStart };
  };

  router.get("/assets", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { today, fyMonth } = await context(actor.tenantId);
    const fyStart = fiscalYearStart(today, fyMonth);
    const [list, transfers] = await Promise.all([
      rows<AssetRow>(deps.db, `${ASSET_SELECT} WHERE a.tenant_id = :t ORDER BY a.status = 'disposed', a.purchase_date DESC, a.tag`, { t: actor.tenantId }),
      one<{ n: number }>(deps.db, `SELECT COUNT(*) AS n FROM bos_asset_events WHERE tenant_id = :t AND kind = 'transfer' AND event_date BETWEEN :from AND :today`, {
        t: actor.tenantId,
        from: `${today.slice(0, 7)}-01`,
        today,
      }),
    ]);
    const assets = list.map((r) => mapAsset(r, today, fyMonth));
    const held = assets.filter((a) => a.status !== "disposed");
    const soon = addDaysISO(today, 30);
    res.json({
      today,
      fiscalYearStart: fyMonth,
      currentYear: Number(fyStart.slice(0, 4)),
      fyLabel: `FY ${fiscalYearLabel(fyStart, fyMonth)}`,
      categories: ASSET_CATEGORIES,
      assets,
      totals: {
        count: held.length,
        cost: round2(held.reduce((s, a) => s + a.cost, 0)),
        bookValue: round2(held.reduce((s, a) => s + a.bookValue, 0)),
        depreciationFy: round2(assets.reduce((s, a) => s + a.depreciationThisFy, 0)),
        maintenance: held.filter((a) => a.status === "maintenance").length,
        transfersMtd: Number(transfers?.n ?? 0),
        disposedFy: assets.filter((a) => a.disposedOn && a.disposedOn >= fyStart).length,
        warrantySoon: held.filter((a) => a.warrantyUntil && a.warrantyUntil >= today && a.warrantyUntil <= soon).length,
      },
    });
  });

  router.get("/assets/depreciation", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { today, fyMonth } = await context(actor.tenantId);
    const current = Number(fiscalYearStart(today, fyMonth).slice(0, 4));
    const year = typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year) ? Number(req.query.year) : current;
    if (year < current - 10 || year > current) throw new BosError(400, `Pick a financial year from ${current - 10} to ${current}`);
    const fyStart = `${year}-${String(fyMonth).padStart(2, "0")}-01`;
    const fyEnd = addDaysISO(`${year + 1}-${String(fyMonth).padStart(2, "0")}-01`, -1);
    const list = await rows<AssetRow>(
      deps.db,
      `${ASSET_SELECT} WHERE a.tenant_id = :t AND a.purchase_date <= :fyEnd AND (a.disposed_on IS NULL OR a.disposed_on >= :fyStart) ORDER BY a.category, a.purchase_date, a.tag`,
      { t: actor.tenantId, fyStart, fyEnd },
    );
    const lines = list.map((r) => ({
      id: r.id,
      tag: r.tag,
      name: r.name,
      category: r.category,
      method: r.method,
      rate: money(r.rate),
      purchaseDate: r.purchase_date,
      disposedOn: r.disposed_on,
      cost: money(r.cost),
      ...yearFigures(depreciable(r), fyStart, fyMonth),
    }));
    type Sums = { opening: number; additions: number; depreciation: number; disposals: number; closing: number };
    const add = (into: Sums, l: Sums) => {
      for (const k of ["opening", "additions", "depreciation", "disposals", "closing"] as const) into[k] = round2(into[k] + l[k]);
      return into;
    };
    const zero = (): Sums => ({ opening: 0, additions: 0, depreciation: 0, disposals: 0, closing: 0 });
    const byCategory = new Map<string, Sums & { category: string; count: number }>();
    for (const l of lines) {
      const c = byCategory.get(l.category) ?? { category: l.category, count: 0, ...zero() };
      c.count += 1;
      byCategory.set(l.category, add(c, l) as typeof c);
    }
    res.json({
      year,
      fyStart,
      fyEnd,
      fyLabel: `FY ${fiscalYearLabel(fyStart, fyMonth)}`,
      complete: fyEnd < today,
      lines,
      byCategory: [...byCategory.values()],
      totals: lines.reduce(add, zero()),
    });
  });

  router.post("/assets", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AssetInput, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    if (input.purchaseDate > today) throw new BosError(400, "The purchase date can't be in the future");
    const [employee, department] = await Promise.all([
      input.employeeId ? employeeOf(deps.db, t, input.employeeId) : null,
      input.departmentId ? departmentOf(deps.db, t, input.departmentId) : null,
      input.billId ? billOf(deps.db, t, input.billId) : null,
    ]);
    if (input.tag && (await one(deps.db, `SELECT id FROM bos_assets WHERE tenant_id = :t AND tag = :tag`, { t, tag: input.tag }))) {
      throw new BosError(409, `Tag ${input.tag} is already used by another asset`);
    }
    const tag = input.tag ?? (await newTag(deps.db, t));
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_assets (id, tenant_id, tag, name, category, serial_no, location, department_id, employee_id, vendor_name, bill_id, purchase_date, cost,
         salvage_value, method, rate, warranty_until, notes, created_by)
       VALUES (:id, :t, :tag, :name, :category, :serialNo, :location, :departmentId, :employeeId, :vendorName, :billId, :purchaseDate, :cost,
         :salvage, :method, :rate, :warrantyUntil, :notes, :userId)`,
      {
        id,
        t,
        tag,
        name: input.name,
        category: input.category,
        serialNo: input.serialNo ?? null,
        location: input.location ?? null,
        departmentId: department?.id ?? null,
        employeeId: employee?.id ?? null,
        vendorName: input.vendorName ?? null,
        billId: input.billId ?? null,
        purchaseDate: input.purchaseDate,
        cost: input.cost,
        salvage: input.salvageValue,
        method: input.method,
        rate: input.method === "none" ? 0 : input.rate,
        warrantyUntil: input.warrantyUntil ?? null,
        notes: input.notes ?? null,
        userId: actor.userId,
      },
    );
    if (employee) await addEvent(deps.db, actor, id, "assign", input.purchaseDate, { employeeId: employee.id, employeeName: employee.name, note: "Assigned when added" });
    await recordEvent(deps, actor, { type: "asset.create", entityType: "asset", entityId: id, summary: `Added asset ${tag} · ${input.name} (${inr(input.cost)})`, ip: req.ip });
    res.status(201).json({ asset: mapAsset(await loadAsset(deps.db, t, id), today, fyMonth) });
  });

  router.get("/assets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { today, fyMonth } = await context(actor.tenantId);
    const a = await loadAsset(deps.db, actor.tenantId, req.params.id);
    const [events, bill] = await Promise.all([
      rows<EventRow>(deps.db, `SELECT * FROM bos_asset_events WHERE asset_id = :id ORDER BY event_date DESC, seq DESC LIMIT 500`, { id: a.id }),
      a.bill_id
        ? one<{ id: string; bill_no: string | null; party_name: string; bill_date: string; total: string | number }>(
            deps.db,
            `SELECT id, bill_no, party_name, bill_date, total FROM bos_bills WHERE id = :id AND tenant_id = :t`,
            { id: a.bill_id, t: actor.tenantId },
          )
        : null,
    ]);
    const d = depreciable(a);
    const disposal = a.disposed_on ? { bookValue: bookValue(d, a.disposed_on, fyMonth), gainLoss: round2(money(a.disposal_amount) - bookValue(d, a.disposed_on, fyMonth)) } : null;
    res.json({
      asset: mapAsset(a, today, fyMonth),
      schedule: depreciationSchedule(d, today, fyMonth),
      events: events.map(mapEvent),
      bill: bill ? { id: bill.id, billNo: bill.bill_no, partyName: bill.party_name, date: bill.bill_date, total: money(bill.total) } : null,
      disposal,
      categories: ASSET_CATEGORIES,
    });
  });

  router.patch("/assets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AssetPatch, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    const purchaseDate = input.purchaseDate ?? a.purchase_date;
    const cost = input.cost ?? money(a.cost);
    const salvage = input.salvageValue ?? money(a.salvage_value);
    if (purchaseDate > today) throw new BosError(400, "The purchase date can't be in the future");
    if (a.disposed_on && purchaseDate > a.disposed_on) throw new BosError(400, "The purchase date can't be after the disposal date");
    if (salvage > cost) throw new BosError(400, "Salvage value can't be more than the cost");
    if (input.billId) await billOf(deps.db, t, input.billId);
    if (input.tag && input.tag !== a.tag && (await one(deps.db, `SELECT id FROM bos_assets WHERE tenant_id = :t AND tag = :tag`, { t, tag: input.tag }))) {
      throw new BosError(409, `Tag ${input.tag} is already used by another asset`);
    }
    const col = {
      tag: "tag",
      name: "name",
      category: "category",
      serialNo: "serial_no",
      vendorName: "vendor_name",
      billId: "bill_id",
      purchaseDate: "purchase_date",
      cost: "cost",
      salvageValue: "salvage_value",
      method: "method",
      rate: "rate",
      warrantyUntil: "warranty_until",
      notes: "notes",
    } as const;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id: a.id };
    for (const [key, column] of Object.entries(col) as Array<[keyof typeof col, string]>) {
      if (input[key] === undefined || (key === "tag" && !input.tag)) continue;
      sets.push(`${column} = :${key}`);
      params[key] = input[key];
    }
    if ((input.method ?? a.method) === "none") {
      if (!sets.includes("rate = :rate")) sets.push("rate = :rate");
      params.rate = 0;
    }
    if (sets.length) await exec(deps.db, `UPDATE bos_assets SET ${sets.join(", ")} WHERE id = :id`, params);
    await recordEvent(deps, actor, { type: "asset.update", entityType: "asset", entityId: a.id, summary: `Updated asset ${input.tag || a.tag} · ${input.name ?? a.name}`, ip: req.ip });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth) });
  });

  router.delete("/assets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const a = await loadAsset(deps.db, actor.tenantId, req.params.id);
    await exec(deps.db, `DELETE FROM bos_assets WHERE id = :id AND tenant_id = :t`, { id: a.id, t: actor.tenantId });
    await recordEvent(deps, actor, { type: "asset.delete", entityType: "asset", entityId: a.id, summary: `Deleted asset ${a.tag} · ${a.name} from the register`, ip: req.ip });
    res.status(204).end();
  });

  router.post("/assets/:id/assign", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AssignInput, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    notDisposed(a);
    checkDate(input.date, a, today);
    let summary: string;
    if (input.employeeId) {
      if (input.employeeId === a.employee_id) throw new BosError(409, `${a.name} is already with ${a.employee_name}`);
      const e = await employeeOf(deps.db, t, input.employeeId);
      await exec(deps.db, `UPDATE bos_assets SET employee_id = :e WHERE id = :id`, { e: e.id, id: a.id });
      await addEvent(deps.db, actor, a.id, "assign", input.date, { employeeId: e.id, employeeName: e.name, note: input.note });
      summary = `Assigned ${a.tag} · ${a.name} to ${e.name}`;
    } else {
      if (!a.employee_id) throw new BosError(409, "This asset isn't assigned to anyone");
      await exec(deps.db, `UPDATE bos_assets SET employee_id = NULL WHERE id = :id`, { id: a.id });
      await addEvent(deps.db, actor, a.id, "return", input.date, { employeeId: a.employee_id, employeeName: a.employee_name, note: input.note });
      summary = `${a.employee_name ?? "Someone"} returned ${a.tag} · ${a.name}`;
    }
    await recordEvent(deps, actor, { type: input.employeeId ? "asset.assign" : "asset.return", entityType: "asset", entityId: a.id, summary, ip: req.ip });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth) });
  });

  router.post("/assets/:id/transfer", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(TransferInput, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    notDisposed(a);
    checkDate(input.date, a, today);
    const departmentId = input.departmentId === undefined ? a.department_id : input.departmentId;
    const location = input.location === undefined ? a.location : input.location;
    if (departmentId === a.department_id && (location ?? null) === (a.location ?? null)) throw new BosError(400, "Choose a different department or location");
    const department = departmentId ? await departmentOf(deps.db, t, departmentId) : null;
    await exec(deps.db, `UPDATE bos_assets SET department_id = :d, location = :l WHERE id = :id`, { d: department?.id ?? null, l: location ?? null, id: a.id });
    await addEvent(deps.db, actor, a.id, "transfer", input.date, { departmentName: department?.name ?? null, location: location ?? null, note: input.note });
    const to = [department?.name, location].filter(Boolean).join(" · ") || "no department or location";
    await recordEvent(deps, actor, { type: "asset.transfer", entityType: "asset", entityId: a.id, summary: `Moved ${a.tag} · ${a.name} to ${to}`, ip: req.ip });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth) });
  });

  router.post("/assets/:id/maintenance", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(MaintenanceInput, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    notDisposed(a);
    checkDate(input.date, a, today);
    if (input.action === "start" && a.status !== "in_use") throw new BosError(409, "This asset is already under maintenance");
    if (input.action === "end" && a.status !== "maintenance") throw new BosError(409, "This asset isn't under maintenance");
    await exec(deps.db, `UPDATE bos_assets SET status = :s WHERE id = :id`, { s: input.action === "start" ? "maintenance" : "in_use", id: a.id });
    await addEvent(deps.db, actor, a.id, input.action === "start" ? "maintenance_start" : "maintenance_end", input.date, { amount: input.action === "end" ? (input.cost ?? null) : null, note: input.note });
    await recordEvent(deps, actor, {
      type: `asset.maintenance_${input.action}`,
      entityType: "asset",
      entityId: a.id,
      summary: input.action === "start" ? `Sent ${a.tag} · ${a.name} for maintenance` : `${a.tag} · ${a.name} is back in use${input.cost ? ` (maintenance ${inr(input.cost)})` : ""}`,
      ip: req.ip,
    });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth) });
  });

  router.post("/assets/:id/dispose", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(DisposeInput, req.body);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    notDisposed(a);
    checkDate(input.date, a, today);
    const book = bookValue({ ...depreciable(a), disposedOn: input.date }, input.date, fyMonth);
    const gainLoss = round2(input.amount - book);
    await exec(deps.db, `UPDATE bos_assets SET status = 'disposed', disposed_on = :date, disposal_amount = :amount, disposal_note = :note, employee_id = NULL WHERE id = :id`, {
      date: input.date,
      amount: input.amount,
      note: input.note ?? null,
      id: a.id,
    });
    await addEvent(deps.db, actor, a.id, "dispose", input.date, { employeeId: a.employee_id, employeeName: a.employee_name, amount: input.amount, note: input.note });
    await recordEvent(deps, actor, {
      type: "asset.dispose",
      entityType: "asset",
      entityId: a.id,
      summary: `Disposed of ${a.tag} · ${a.name}${input.amount ? ` for ${inr(input.amount)}` : ""} (${gainLoss >= 0 ? "gain" : "loss"} ${inr(Math.abs(gainLoss))})`,
      payload: { bookValue: book, amount: input.amount, gainLoss },
      ip: req.ip,
    });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth), disposal: { bookValue: book, gainLoss } });
  });

  router.post("/assets/:id/reinstate", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const t = actor.tenantId;
    const { today, fyMonth } = await context(t);
    const a = await loadAsset(deps.db, t, req.params.id);
    if (a.status !== "disposed") throw new BosError(409, "This asset hasn't been disposed of");
    await exec(deps.db, `UPDATE bos_assets SET status = 'in_use', disposed_on = NULL, disposal_amount = NULL, disposal_note = NULL WHERE id = :id`, { id: a.id });
    await addEvent(deps.db, actor, a.id, "reinstate", today, { note: `Disposal on ${a.disposed_on} undone` });
    await recordEvent(deps, actor, { type: "asset.reinstate", entityType: "asset", entityId: a.id, summary: `Reinstated ${a.tag} · ${a.name} (disposal undone)`, ip: req.ip });
    res.json({ asset: mapAsset(await loadAsset(deps.db, t, a.id), today, fyMonth) });
  });
}
