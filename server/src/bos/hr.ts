import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorOf, isoDate as iso, optText, parse, recordEvent, type BosDeps } from "./context.js";
import { exec, json, money, nextSequence, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import {
  addDaysISO,
  countLeaveDays,
  daysBetween,
  eachDate,
  LEAVE_TYPES,
  leaveBalances,
  maskAccount,
  todayISO,
  weekdayOf,
} from "./logic.js";
import { getSettings, type BosSettings } from "./workspace.js";

export const EMPLOYEE_STATUSES = ["active", "probation", "notice", "exited"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "wfh", "leave", "holiday"] as const;

export const PERSONAL_FIELDS = ["fatherName", "mobile", "personalEmail", "bloodGroup", "address", "emergencyName", "emergencyRelation", "emergencyPhone"] as const;
type PersonalField = (typeof PERSONAL_FIELDS)[number];
type Personal = Partial<Record<PersonalField, string>>;
type Bank = { name?: string; holder?: string; account?: string; ifsc?: string; branch?: string };

const PersonalInput = z.object(Object.fromEntries(PERSONAL_FIELDS.map((k) => [k, z.string().trim().max(300).optional()])) as Record<PersonalField, z.ZodOptional<z.ZodString>>);
const BankInput = z.object({
  name: z.string().trim().max(120).optional(),
  holder: z.string().trim().max(120).optional(),
  account: z.string().trim().max(34).regex(/^[0-9A-Za-z ]*$/, "Digits only").optional(),
  ifsc: z.string().trim().max(11).optional(),
  branch: z.string().trim().max(120).optional(),
});

const EmployeeInput = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: optText(80),
  workEmail: z.string().trim().max(180).email("Enter a valid email").nullable().optional().or(z.literal("")),
  phone: optText(40),
  designation: optText(120),
  departmentId: z.string().max(36).nullable().optional(),
  managerId: z.string().max(36).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  status: z.enum(EMPLOYEE_STATUSES).default("active"),
  joinDate: iso,
  exitDate: iso.nullable().optional(),
  location: optText(120),
  dob: iso.nullable().optional(),
  ctcAnnual: z.coerce.number().min(0).max(1e11).nullable().optional(),
  userId: z.coerce.number().int().positive().nullable().optional(),
  personal: PersonalInput.optional(),
  bank: BankInput.optional(),
});

type EmployeeRow = {
  id: string;
  emp_code: string;
  first_name: string;
  last_name: string | null;
  work_email: string | null;
  phone: string | null;
  designation: string | null;
  department_id: string | null;
  department_name?: string | null;
  manager_id: string | null;
  manager_first?: string | null;
  manager_last?: string | null;
  employment_type: string;
  status: string;
  join_date: string;
  exit_date: string | null;
  location: string | null;
  dob: string | null;
  ctc_annual: string | number | null;
  personal: unknown;
  bank: unknown;
  user_id: number | null;
};

const fullName = (first: string | null | undefined, last: string | null | undefined) => [first, last].filter(Boolean).join(" ");

function mapEmployee(r: EmployeeRow, opts: { canSeePay: boolean }) {
  const bank = json<Bank>(r.bank, {});
  return {
    id: r.id,
    empCode: r.emp_code,
    firstName: r.first_name,
    lastName: r.last_name,
    name: fullName(r.first_name, r.last_name),
    workEmail: r.work_email,
    phone: r.phone,
    designation: r.designation,
    departmentId: r.department_id,
    departmentName: r.department_name ?? null,
    managerId: r.manager_id,
    managerName: r.manager_first ? fullName(r.manager_first, r.manager_last) : null,
    employmentType: r.employment_type,
    status: r.status,
    joinDate: r.join_date,
    exitDate: r.exit_date,
    location: r.location,
    dob: r.dob,
    ctcAnnual: opts.canSeePay && r.ctc_annual !== null ? money(r.ctc_annual) : null,
    personal: json<Personal>(r.personal, {}),
    bank: { name: bank.name ?? "", holder: bank.holder ?? "", account: maskAccount(bank.account), ifsc: bank.ifsc ?? "", branch: bank.branch ?? "" },
    userId: r.user_id,
  };
}
export type BosEmployee = ReturnType<typeof mapEmployee>;

const EMPLOYEE_SELECT = `
  SELECT e.*, d.name AS department_name, m.first_name AS manager_first, m.last_name AS manager_last
  FROM bos_employees e
  LEFT JOIN bos_departments d ON d.id = e.department_id
  LEFT JOIN bos_employees m ON m.id = e.manager_id`;

async function loadEmployee(deps: BosDeps, tenantId: number, id: string): Promise<EmployeeRow> {
  const row = await one<EmployeeRow>(deps.db, `${EMPLOYEE_SELECT} WHERE e.id = :id AND e.tenant_id = :tenantId`, { id, tenantId });
  if (!row) throw notFound("Employee");
  return row;
}

/** The employee record for the signed-in user: linked by user id, else by work email (and linked then). */
export async function employeeForActor(deps: BosDeps, actor: BosActor): Promise<EmployeeRow | null> {
  if (actor.userId) {
    const linked = await one<EmployeeRow>(deps.db, `${EMPLOYEE_SELECT} WHERE e.tenant_id = :tenantId AND e.user_id = :userId LIMIT 1`, { tenantId: actor.tenantId, userId: actor.userId });
    if (linked) return linked;
  }
  if (actor.email) {
    const byEmail = await one<EmployeeRow>(deps.db, `${EMPLOYEE_SELECT} WHERE e.tenant_id = :tenantId AND e.user_id IS NULL AND LOWER(e.work_email) = LOWER(:email) LIMIT 1`, { tenantId: actor.tenantId, email: actor.email });
    if (byEmail && actor.userId) {
      await exec(deps.db, `UPDATE bos_employees SET user_id = :userId WHERE id = :id`, { userId: actor.userId, id: byEmail.id });
      byEmail.user_id = actor.userId;
    }
    return byEmail;
  }
  return null;
}

function fiscalStart(today: string, startMonth: number): string {
  const [y, m] = today.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

async function leaveUsed(deps: BosDeps, tenantId: number, employeeId: string, from: string, statuses: string[]): Promise<Record<string, number>> {
  const list = await rows<{ leave_type: string; days: string | number }>(
    deps.db,
    `SELECT leave_type, SUM(days) AS days FROM bos_leave_requests
     WHERE tenant_id = :tenantId AND employee_id = :employeeId AND from_date >= :from AND status IN (${statuses.map((s) => `'${s}'`).join(",")})
     GROUP BY leave_type`,
    { tenantId, employeeId, from },
  );
  return Object.fromEntries(list.map((r) => [r.leave_type, money(r.days)]));
}

async function holidaySet(deps: BosDeps, tenantId: number, from: string, to: string): Promise<Set<string>> {
  const list = await rows<{ holiday_date: string }>(deps.db, `SELECT holiday_date FROM bos_holidays WHERE tenant_id = :tenantId AND holiday_date BETWEEN :from AND :to`, { tenantId, from, to });
  return new Set(list.map((h) => h.holiday_date));
}

async function monthAttendance(deps: BosDeps, tenantId: number, employeeId: string, month: string) {
  const list = await rows<{ work_date: string; status: string; check_in: string | null; check_out: string | null }>(
    deps.db,
    `SELECT work_date, status, check_in, check_out FROM bos_attendance
     WHERE tenant_id = :tenantId AND employee_id = :employeeId AND work_date BETWEEN :from AND :to ORDER BY work_date DESC`,
    { tenantId, employeeId, from: `${month}-01`, to: `${month}-31` },
  );
  const count = (s: string) => list.filter((a) => a.status === s).length;
  return {
    month,
    present: count("present") + count("wfh") + count("half_day") * 0.5,
    absent: count("absent") + count("half_day") * 0.5,
    leave: count("leave"),
    wfh: count("wfh"),
    records: list.map((a) => ({ date: a.work_date, status: a.status, checkIn: a.check_in, checkOut: a.check_out })),
  };
}

type LeaveRow = {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string | null;
  user_id: number | null;
  leave_type: string;
  from_date: string;
  to_date: string;
  half_day: number;
  days: string | number;
  reason: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
};

const mapLeave = (r: LeaveRow) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: fullName(r.first_name, r.last_name),
  leaveType: r.leave_type,
  fromDate: r.from_date,
  toDate: r.to_date,
  halfDay: Boolean(r.half_day),
  days: money(r.days),
  reason: r.reason,
  status: r.status,
  decisionNote: r.decision_note,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

const LEAVE_SELECT = `SELECT l.*, e.first_name, e.last_name, e.user_id FROM bos_leave_requests l JOIN bos_employees e ON e.id = l.employee_id`;

const LeaveInput = z.object({
  employeeId: z.string().max(36).optional(),
  leaveType: z.enum(LEAVE_TYPES),
  fromDate: iso,
  toDate: iso,
  halfDay: z.boolean().default(false),
  reason: optText(500),
});

/** Working days (as attendance rows) covered by an approved leave. */
async function writeLeaveAttendance(deps: BosDeps, tenantId: number, settings: BosSettings, leave: { employee_id: string; from_date: string; to_date: string; half_day: number }): Promise<void> {
  const holidays = await holidaySet(deps, tenantId, leave.from_date, leave.to_date);
  const weekend = new Set(settings.weekendDays);
  const days = eachDate(leave.from_date, leave.to_date).filter((d) => !weekend.has(weekdayOf(d)) && !holidays.has(d));
  for (const d of days) {
    await exec(
      deps.db,
      `INSERT INTO bos_attendance (tenant_id, employee_id, work_date, status, source)
       VALUES (:tenantId, :employeeId, :d, :status, 'leave')
       ON DUPLICATE KEY UPDATE status = VALUES(status), source = 'leave'`,
      { tenantId, employeeId: leave.employee_id, d, status: leave.half_day ? "half_day" : "leave" },
    );
  }
}

const personalLabel: Record<PersonalField, string> = {
  fatherName: "Father's Name",
  mobile: "Mobile Number",
  personalEmail: "Personal Email ID",
  bloodGroup: "Blood Group",
  address: "Address",
  emergencyName: "Emergency Contact Name",
  emergencyRelation: "Emergency Contact Relation",
  emergencyPhone: "Emergency Contact Phone",
};

export function registerHr(router: Router, deps: BosDeps): void {
  /* ----- Departments ----- */

  router.get("/hr/departments", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<{ id: string; name: string; code: string | null; head_employee_id: string | null; headcount: number }>(
      deps.db,
      `SELECT d.id, d.name, d.code, d.head_employee_id,
         (SELECT COUNT(*) FROM bos_employees e WHERE e.department_id = d.id AND e.status <> 'exited') AS headcount
       FROM bos_departments d WHERE d.tenant_id = :tenantId ORDER BY d.name`,
      { tenantId: actor.tenantId },
    );
    res.json({ departments: list.map((d) => ({ id: d.id, name: d.name, code: d.code, headEmployeeId: d.head_employee_id, headcount: Number(d.headcount) })) });
  });

  router.post("/hr/departments", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const input = parse(z.object({ name: z.string().trim().min(1, "Required").max(120), code: optText(20) }), req.body);
    const id = randomUUID();
    try {
      await exec(deps.db, `INSERT INTO bos_departments (id, tenant_id, name, code) VALUES (:id, :tenantId, :name, :code)`, { id, tenantId: actor.tenantId, name: input.name, code: input.code ?? null });
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new BosError(409, "A department with this name already exists");
      throw err;
    }
    await recordEvent(deps, actor, { type: "department.create", entityType: "department", entityId: id, summary: `Created department ${input.name}`, ip: req.ip });
    res.status(201).json({ department: { id, name: input.name, code: input.code ?? null, headEmployeeId: null, headcount: 0 } });
  });

  router.delete("/hr/departments/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    await exec(deps.db, `UPDATE bos_employees SET department_id = NULL WHERE tenant_id = :tenantId AND department_id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    const r = await exec(deps.db, `DELETE FROM bos_departments WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!r.affectedRows) throw notFound("Department");
    await recordEvent(deps, actor, { type: "department.delete", entityType: "department", entityId: req.params.id, summary: "Deleted a department", ip: req.ip });
    res.status(204).end();
  });

  /* ----- Employees ----- */

  router.get("/hr/employees", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<EmployeeRow>(deps.db, `${EMPLOYEE_SELECT} WHERE e.tenant_id = :tenantId ORDER BY e.first_name, e.last_name LIMIT 5000`, { tenantId: actor.tenantId });
    const canSeePay = isManager(actor);
    res.json({ employees: list.map((r) => mapEmployee(r, { canSeePay })) });
  });

  router.get("/hr/employees/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadEmployee(deps, actor.tenantId, req.params.id);
    const isSelf = Boolean(actor.userId && row.user_id === actor.userId);
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const fyFrom = fiscalStart(today, settings.fiscalYearStart);
    const [used, attendance, pendingChange, leaves] = await Promise.all([
      leaveUsed(deps, actor.tenantId, row.id, fyFrom, ["approved"]),
      monthAttendance(deps, actor.tenantId, row.id, today.slice(0, 7)),
      one<{ id: string; changes: unknown; created_at: string }>(deps.db, `SELECT id, changes, created_at FROM bos_profile_changes WHERE tenant_id = :tenantId AND employee_id = :id AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, { tenantId: actor.tenantId, id: row.id }),
      rows<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.tenant_id = :tenantId AND l.employee_id = :id ORDER BY l.from_date DESC LIMIT 20`, { tenantId: actor.tenantId, id: row.id }),
    ]);
    res.json({
      employee: mapEmployee(row, { canSeePay: isManager(actor) || isSelf }),
      isSelf,
      balances: leaveBalances(settings.leavePolicy, used),
      attendance,
      leaves: leaves.map(mapLeave),
      pendingChange: pendingChange ? { id: pendingChange.id, changes: json<Personal>(pendingChange.changes, {}), createdAt: pendingChange.created_at } : null,
    });
  });

  router.post("/hr/employees", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can add employees");
    const input = parse(EmployeeInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const id = randomUUID();
    const empCode = await tx(deps.db, async (conn) => {
      const seq = await nextSequence(conn, actor.tenantId, "employee", "all");
      const code = `${settings.employeePrefix}-${String(seq).padStart(4, "0")}`;
      await exec(
        conn,
        `INSERT INTO bos_employees (id, tenant_id, emp_code, first_name, last_name, work_email, phone, designation, department_id, manager_id,
           employment_type, status, join_date, exit_date, location, dob, ctc_annual, personal, bank, user_id)
         VALUES (:id, :tenantId, :code, :firstName, :lastName, :workEmail, :phone, :designation, :departmentId, :managerId,
           :employmentType, :status, :joinDate, :exitDate, :location, :dob, :ctcAnnual, :personal, :bank, :userId)`,
        {
          id,
          tenantId: actor.tenantId,
          code,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          workEmail: input.workEmail || null,
          phone: input.phone ?? null,
          designation: input.designation ?? null,
          departmentId: input.departmentId || null,
          managerId: input.managerId || null,
          employmentType: input.employmentType,
          status: input.status,
          joinDate: input.joinDate,
          exitDate: input.exitDate ?? null,
          location: input.location ?? null,
          dob: input.dob ?? null,
          ctcAnnual: input.ctcAnnual ?? null,
          personal: JSON.stringify(input.personal ?? {}),
          bank: JSON.stringify(input.bank ?? {}),
          userId: input.userId ?? null,
        },
      );
      return code;
    });
    await recordEvent(deps, actor, {
      type: "employee.create",
      entityType: "employee",
      entityId: id,
      summary: `Onboarded ${fullName(input.firstName, input.lastName)} (${empCode})`,
      notice: { kind: "activity", title: "New employee onboarded", body: `${fullName(input.firstName, input.lastName)} · ${input.designation ?? "Team member"}`, path: "?ws=hr&m=employees" },
      ip: req.ip,
    });
    res.status(201).json({ employee: mapEmployee(await loadEmployee(deps, actor.tenantId, id), { canSeePay: true }) });
  });

  router.patch("/hr/employees/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can edit employee records");
    const existing = await loadEmployee(deps, actor.tenantId, req.params.id);
    const input = parse(EmployeeInput.partial(), req.body);
    if (input.managerId && input.managerId === existing.id) throw new BosError(400, "An employee cannot report to themselves");
    const cur = mapEmployee(existing, { canSeePay: true });
    const bankNow = json<Bank>(existing.bank, {});
    const next = {
      firstName: input.firstName ?? cur.firstName,
      lastName: input.lastName !== undefined ? input.lastName : cur.lastName,
      workEmail: input.workEmail !== undefined ? input.workEmail || null : cur.workEmail,
      phone: input.phone !== undefined ? input.phone : cur.phone,
      designation: input.designation !== undefined ? input.designation : cur.designation,
      departmentId: input.departmentId !== undefined ? input.departmentId || null : cur.departmentId,
      managerId: input.managerId !== undefined ? input.managerId || null : cur.managerId,
      employmentType: input.employmentType ?? cur.employmentType,
      status: input.status ?? cur.status,
      joinDate: input.joinDate ?? cur.joinDate,
      exitDate: input.exitDate !== undefined ? input.exitDate : cur.exitDate,
      location: input.location !== undefined ? input.location : cur.location,
      dob: input.dob !== undefined ? input.dob : cur.dob,
      ctcAnnual: input.ctcAnnual !== undefined ? input.ctcAnnual : cur.ctcAnnual,
      userId: input.userId !== undefined ? input.userId : cur.userId,
      personal: JSON.stringify({ ...cur.personal, ...(input.personal ?? {}) }),
      bank: JSON.stringify({ ...bankNow, ...Object.fromEntries(Object.entries(input.bank ?? {}).filter(([k, v]) => !(k === "account" && String(v).includes("•")))) }),
    };
    await exec(
      deps.db,
      `UPDATE bos_employees SET first_name = :firstName, last_name = :lastName, work_email = :workEmail, phone = :phone, designation = :designation,
         department_id = :departmentId, manager_id = :managerId, employment_type = :employmentType, status = :status, join_date = :joinDate,
         exit_date = :exitDate, location = :location, dob = :dob, ctc_annual = :ctcAnnual, user_id = :userId, personal = :personal, bank = :bank
       WHERE id = :id AND tenant_id = :tenantId`,
      { ...next, id: existing.id, tenantId: actor.tenantId },
    );
    await recordEvent(deps, actor, {
      type: input.status && input.status !== existing.status ? "employee.status" : "employee.update",
      entityType: "employee",
      entityId: existing.id,
      summary: input.status && input.status !== existing.status ? `${cur.name}: ${existing.status} → ${input.status}` : `Updated ${cur.name}'s record`,
      payload: { fields: Object.keys(input).filter((k) => k !== "bank") },
      ip: req.ip,
    });
    res.json({ employee: mapEmployee(await loadEmployee(deps, actor.tenantId, existing.id), { canSeePay: true }) });
  });

  router.get("/hr/employees/:id/bank", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadEmployee(deps, actor.tenantId, req.params.id);
    const isSelf = Boolean(actor.userId && row.user_id === actor.userId);
    if (!isManager(actor) && !isSelf) throw forbidden("Bank details are visible to the employee, HR and payroll only");
    await recordEvent(deps, actor, { type: "employee.bank_view", entityType: "employee", entityId: row.id, summary: `Viewed bank details of ${fullName(row.first_name, row.last_name)}`, ip: req.ip });
    res.json({ bank: json<Bank>(row.bank, {}) });
  });

  /* ----- Self-service profile changes (HR approval) ----- */

  router.post("/hr/employees/:id/profile-changes", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadEmployee(deps, actor.tenantId, req.params.id);
    const isSelf = Boolean(actor.userId && row.user_id === actor.userId);
    if (!isSelf && !isManager(actor)) throw forbidden("You can only update your own details");
    const changes = parse(PersonalInput, req.body?.changes);
    const current = json<Personal>(row.personal, {});
    const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== undefined && v !== (current[k as PersonalField] ?? "")));
    if (!Object.keys(diff).length) throw new BosError(400, "Nothing changed");
    await exec(deps.db, `UPDATE bos_profile_changes SET status = 'superseded' WHERE tenant_id = :tenantId AND employee_id = :id AND status = 'pending'`, { tenantId: actor.tenantId, id: row.id });
    const id = randomUUID();
    await exec(deps.db, `INSERT INTO bos_profile_changes (id, tenant_id, employee_id, changes, requested_by) VALUES (:id, :tenantId, :employeeId, :changes, :userId)`, {
      id,
      tenantId: actor.tenantId,
      employeeId: row.id,
      changes: JSON.stringify(diff),
      userId: actor.userId,
    });
    const name = fullName(row.first_name, row.last_name);
    await recordEvent(deps, actor, {
      type: "employee.profile_change_request",
      entityType: "employee",
      entityId: row.id,
      summary: `${name} requested changes: ${Object.keys(diff).map((k) => personalLabel[k as PersonalField]).join(", ")}`,
      notice: { kind: "approval_requested", title: "Profile change awaiting HR review", body: `${name} · ${Object.keys(diff).length} field(s)`, path: "?ws=hr&m=employees", dedupeKey: `bos-profile:${id}` },
      ip: req.ip,
    });
    res.status(201).json({ pendingChange: { id, changes: diff } });
  });

  router.get("/hr/profile-changes", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<{ id: string; employee_id: string; first_name: string; last_name: string | null; changes: unknown; created_at: string }>(
      deps.db,
      `SELECT c.id, c.employee_id, e.first_name, e.last_name, c.changes, c.created_at FROM bos_profile_changes c JOIN bos_employees e ON e.id = c.employee_id
       WHERE c.tenant_id = :tenantId AND c.status = 'pending' ORDER BY c.created_at`,
      { tenantId: actor.tenantId },
    );
    res.json({ changes: list.map((c) => ({ id: c.id, employeeId: c.employee_id, employeeName: fullName(c.first_name, c.last_name), changes: json<Personal>(c.changes, {}), createdAt: c.created_at })) });
  });

  router.post("/hr/profile-changes/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only HR (owners and admins) can review profile changes");
    const { decision } = parse(z.object({ decision: z.enum(["approved", "rejected"]) }), req.body);
    const change = await one<{ id: string; employee_id: string; changes: unknown; status: string; requested_by: number | null }>(
      deps.db,
      `SELECT id, employee_id, changes, status, requested_by FROM bos_profile_changes WHERE id = :id AND tenant_id = :tenantId`,
      { id: req.params.id, tenantId: actor.tenantId },
    );
    if (!change) throw notFound("Change request");
    if (change.status !== "pending") throw new BosError(409, "This request has already been reviewed");
    const emp = await loadEmployee(deps, actor.tenantId, change.employee_id);
    if (decision === "approved") {
      const merged = { ...json<Personal>(emp.personal, {}), ...json<Personal>(change.changes, {}) };
      await exec(deps.db, `UPDATE bos_employees SET personal = :personal WHERE id = :id`, { personal: JSON.stringify(merged), id: emp.id });
    }
    await exec(deps.db, `UPDATE bos_profile_changes SET status = :decision, decided_by = :userId, decided_at = CURRENT_TIMESTAMP WHERE id = :id`, { decision, userId: actor.userId, id: change.id });
    const name = fullName(emp.first_name, emp.last_name);
    await recordEvent(deps, actor, {
      type: `employee.profile_change_${decision}`,
      entityType: "employee",
      entityId: emp.id,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} ${name}'s profile changes`,
      notice: change.requested_by && change.requested_by !== actor.userId
        ? { kind: "approval_decided", title: `Profile changes ${decision}`, body: `Your personal details update was ${decision} by HR.`, path: "?ws=home", targetUserId: change.requested_by }
        : undefined,
      ip: req.ip,
    });
    res.json({ ok: true, employee: mapEmployee(await loadEmployee(deps, actor.tenantId, emp.id), { canSeePay: true }) });
  });

  /* ----- Leave ----- */

  router.get("/hr/leave", async (req, res) => {
    const actor = actorOf(res);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const list = await rows<LeaveRow>(
      deps.db,
      `${LEAVE_SELECT} WHERE l.tenant_id = :tenantId ${status ? "AND l.status = :status" : ""} ORDER BY l.created_at DESC LIMIT 1000`,
      { tenantId: actor.tenantId, status },
    );
    res.json({ leave: list.map(mapLeave) });
  });

  router.post("/hr/leave", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(LeaveInput, req.body);
    if (input.toDate < input.fromDate) throw new BosError(400, "The end date is before the start date");
    if (input.halfDay && input.toDate !== input.fromDate) throw new BosError(400, "A half day must start and end on the same date");
    let employee: EmployeeRow | null;
    if (input.employeeId) {
      employee = await loadEmployee(deps, actor.tenantId, input.employeeId);
      const isSelf = Boolean(actor.userId && employee.user_id === actor.userId);
      if (!isSelf && !isManager(actor)) throw forbidden("You can only apply leave for yourself");
    } else {
      employee = await employeeForActor(deps, actor);
      if (!employee) throw new BosError(400, "Your login isn't linked to an employee record yet — ask HR to link it");
    }
    if (employee.status === "exited") throw new BosError(409, "This employee has exited");
    const settings = await getSettings(deps, actor.tenantId);
    const holidays = await holidaySet(deps, actor.tenantId, input.fromDate, input.toDate);
    const days = countLeaveDays(input.fromDate, input.toDate, { halfDay: input.halfDay, weekendDays: settings.weekendDays, holidays });
    if (days <= 0) throw new BosError(400, "Those dates are all weekends or holidays");
    const overlap = await one<{ id: string }>(
      deps.db,
      `SELECT id FROM bos_leave_requests WHERE tenant_id = :tenantId AND employee_id = :employeeId AND status IN ('pending','approved')
       AND from_date <= :toDate AND to_date >= :fromDate LIMIT 1`,
      { tenantId: actor.tenantId, employeeId: employee.id, fromDate: input.fromDate, toDate: input.toDate },
    );
    if (overlap) throw new BosError(409, "There is already a leave request covering these dates");
    if (input.leaveType !== "lop") {
      const used = await leaveUsed(deps, actor.tenantId, employee.id, fiscalStart(input.fromDate, settings.fiscalYearStart), ["approved", "pending"]);
      const remaining = settings.leavePolicy[input.leaveType] - (used[input.leaveType] ?? 0);
      if (days > remaining) throw new BosError(400, `Only ${Math.max(0, remaining)} ${input.leaveType} leave day(s) left this year`);
    }
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO bos_leave_requests (id, tenant_id, employee_id, leave_type, from_date, to_date, half_day, days, reason, created_by)
       VALUES (:id, :tenantId, :employeeId, :leaveType, :fromDate, :toDate, :halfDay, :days, :reason, :userId)`,
      { ...input, id, tenantId: actor.tenantId, employeeId: employee.id, halfDay: input.halfDay ? 1 : 0, days, reason: input.reason ?? null, userId: actor.userId },
    );
    const name = fullName(employee.first_name, employee.last_name);
    await recordEvent(deps, actor, {
      type: "leave.request",
      entityType: "leave",
      entityId: id,
      summary: `${name} applied for ${days} day(s) ${input.leaveType} leave (${input.fromDate} → ${input.toDate})`,
      notice: { kind: "approval_requested", title: "Leave request awaiting approval", body: `${name} · ${days} day(s) ${input.leaveType} · from ${input.fromDate}`, path: "?ws=hr&m=leave", dedupeKey: `bos-leave:${id}` },
      ip: req.ip,
    });
    const row = await one<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.id = :id`, { id });
    res.status(201).json({ leave: mapLeave(row!) });
  });

  router.post("/hr/leave/:id/decision", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can approve leave");
    const { decision, note } = parse(z.object({ decision: z.enum(["approved", "rejected"]), note: optText(500) }), req.body);
    const leave = await one<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.id = :id AND l.tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!leave) throw notFound("Leave request");
    if (leave.status !== "pending") throw new BosError(409, "This request has already been decided");
    await exec(deps.db, `UPDATE bos_leave_requests SET status = :decision, decision_note = :note, decided_by = :userId, decided_at = CURRENT_TIMESTAMP WHERE id = :id`, {
      decision,
      note: note ?? null,
      userId: actor.userId,
      id: leave.id,
    });
    if (decision === "approved") await writeLeaveAttendance(deps, actor.tenantId, await getSettings(deps, actor.tenantId), leave);
    const name = fullName(leave.first_name, leave.last_name);
    await recordEvent(deps, actor, {
      type: `leave.${decision}`,
      entityType: "leave",
      entityId: leave.id,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} ${name}'s ${leave.leave_type} leave (${money(leave.days)} day(s))`,
      notice: leave.user_id && leave.user_id !== actor.userId
        ? { kind: "approval_decided", title: `Leave ${decision}`, body: `${leave.leave_type} leave ${leave.from_date} → ${leave.to_date}${note ? ` · ${note}` : ""}`, path: "?ws=home", targetUserId: leave.user_id }
        : undefined,
      ip: req.ip,
    });
    const row = await one<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.id = :id`, { id: leave.id });
    res.json({ leave: mapLeave(row!) });
  });

  router.post("/hr/leave/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    const leave = await one<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.id = :id AND l.tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!leave) throw notFound("Leave request");
    const isSelf = Boolean(actor.userId && leave.user_id === actor.userId);
    if (!isSelf && !isManager(actor)) throw forbidden();
    if (leave.status !== "pending" && !(leave.status === "approved" && leave.from_date > todayISO())) {
      throw new BosError(409, "Only pending or upcoming approved leave can be cancelled");
    }
    await exec(deps.db, `UPDATE bos_leave_requests SET status = 'cancelled' WHERE id = :id`, { id: leave.id });
    await exec(deps.db, `DELETE FROM bos_attendance WHERE tenant_id = :tenantId AND employee_id = :employeeId AND source = 'leave' AND work_date BETWEEN :from AND :to`, {
      tenantId: actor.tenantId,
      employeeId: leave.employee_id,
      from: leave.from_date,
      to: leave.to_date,
    });
    await recordEvent(deps, actor, { type: "leave.cancel", entityType: "leave", entityId: leave.id, summary: `Cancelled ${fullName(leave.first_name, leave.last_name)}'s leave`, ip: req.ip });
    res.json({ ok: true });
  });

  /* ----- Attendance ----- */

  router.get("/hr/attendance", async (req, res) => {
    const actor = actorOf(res);
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayISO();
    const [list, holiday] = await Promise.all([
      rows<{ id: string; first_name: string; last_name: string | null; designation: string | null; department_name: string | null; status: string | null; check_in: string | null; check_out: string | null; source: string | null }>(
        deps.db,
        `SELECT e.id, e.first_name, e.last_name, e.designation, d.name AS department_name, a.status, a.check_in, a.check_out, a.source
         FROM bos_employees e
         LEFT JOIN bos_departments d ON d.id = e.department_id
         LEFT JOIN bos_attendance a ON a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.work_date = :date
         WHERE e.tenant_id = :tenantId AND e.status <> 'exited' AND e.join_date <= :date
         ORDER BY e.first_name, e.last_name`,
        { tenantId: actor.tenantId, date },
      ),
      one<{ name: string }>(deps.db, `SELECT name FROM bos_holidays WHERE tenant_id = :tenantId AND holiday_date = :date LIMIT 1`, { tenantId: actor.tenantId, date }),
    ]);
    const settings = await getSettings(deps, actor.tenantId);
    res.json({
      date,
      holiday: holiday?.name ?? null,
      weekend: settings.weekendDays.includes(weekdayOf(date)),
      roster: list.map((r) => ({
        employeeId: r.id,
        name: fullName(r.first_name, r.last_name),
        designation: r.designation,
        departmentName: r.department_name,
        status: r.status,
        checkIn: r.check_in ? r.check_in.slice(0, 5) : null,
        checkOut: r.check_out ? r.check_out.slice(0, 5) : null,
        source: r.source,
      })),
    });
  });

  router.put("/hr/attendance", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden("Only owners and admins can mark attendance");
    const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional();
    const input = parse(
      z.object({
        date: iso,
        entries: z.array(z.object({ employeeId: z.string().max(36), status: z.enum(ATTENDANCE_STATUSES), checkIn: time, checkOut: time })).min(1).max(2000),
      }),
      req.body,
    );
    if (input.date > todayISO()) throw new BosError(400, "Attendance can't be marked for a future date");
    const ids = new Set((await rows<{ id: string }>(deps.db, `SELECT id FROM bos_employees WHERE tenant_id = :tenantId`, { tenantId: actor.tenantId })).map((r) => r.id));
    let saved = 0;
    await tx(deps.db, async (conn) => {
      for (const e of input.entries) {
        if (!ids.has(e.employeeId)) continue;
        await exec(
          conn,
          `INSERT INTO bos_attendance (tenant_id, employee_id, work_date, status, check_in, check_out, source)
           VALUES (:tenantId, :employeeId, :date, :status, :checkIn, :checkOut, 'manual')
           ON DUPLICATE KEY UPDATE status = VALUES(status), check_in = VALUES(check_in), check_out = VALUES(check_out), source = 'manual'`,
          { tenantId: actor.tenantId, employeeId: e.employeeId, date: input.date, status: e.status, checkIn: e.checkIn ?? null, checkOut: e.checkOut ?? null },
        );
        saved++;
      }
    });
    await recordEvent(deps, actor, { type: "attendance.mark", entityType: "attendance", entityId: input.date, summary: `Marked attendance for ${saved} employee(s) on ${input.date}`, ip: req.ip });
    res.json({ ok: true, saved });
  });

  /* ----- Holidays ----- */

  router.get("/hr/holidays", async (req, res) => {
    const actor = actorOf(res);
    const year = /^\d{4}$/.test(String(req.query.year ?? "")) ? String(req.query.year) : todayISO().slice(0, 4);
    const list = await rows<{ id: string; holiday_date: string; name: string; kind: string }>(
      deps.db,
      `SELECT id, holiday_date, name, kind FROM bos_holidays WHERE tenant_id = :tenantId AND holiday_date BETWEEN :from AND :to ORDER BY holiday_date`,
      { tenantId: actor.tenantId, from: `${year}-01-01`, to: `${year}-12-31` },
    );
    res.json({ year: Number(year), holidays: list.map((h) => ({ id: h.id, date: h.holiday_date, name: h.name, kind: h.kind })) });
  });

  router.post("/hr/holidays", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const input = parse(z.object({ date: iso, name: z.string().trim().min(1, "Required").max(120), kind: z.enum(["public", "optional", "company"]).default("public") }), req.body);
    const id = randomUUID();
    try {
      await exec(deps.db, `INSERT INTO bos_holidays (id, tenant_id, holiday_date, name, kind) VALUES (:id, :tenantId, :date, :name, :kind)`, { id, tenantId: actor.tenantId, ...input });
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new BosError(409, "That holiday already exists");
      throw err;
    }
    await recordEvent(deps, actor, { type: "holiday.create", entityType: "holiday", entityId: id, summary: `Added holiday ${input.name} on ${input.date}`, ip: req.ip });
    res.status(201).json({ holiday: { id, date: input.date, name: input.name, kind: input.kind } });
  });

  router.delete("/hr/holidays/:id", async (req, res) => {
    const actor = actorOf(res);
    if (!isManager(actor)) throw forbidden();
    const r = await exec(deps.db, `DELETE FROM bos_holidays WHERE id = :id AND tenant_id = :tenantId`, { id: req.params.id, tenantId: actor.tenantId });
    if (!r.affectedRows) throw notFound("Holiday");
    await recordEvent(deps, actor, { type: "holiday.delete", entityType: "holiday", entityId: req.params.id, summary: "Removed a holiday", ip: req.ip });
    res.status(204).end();
  });

  /* ----- Dashboards ----- */

  router.get("/hr/overview", async (_req, res) => {
    const actor = actorOf(res);
    const t = actor.tenantId;
    const today = todayISO();
    const employees = await rows<{ id: string; first_name: string; last_name: string | null; status: string; join_date: string; exit_date: string | null; dob: string | null; department_name: string | null }>(
      deps.db,
      `SELECT e.id, e.first_name, e.last_name, e.status, e.join_date, e.exit_date, e.dob, d.name AS department_name
       FROM bos_employees e LEFT JOIN bos_departments d ON d.id = e.department_id WHERE e.tenant_id = :t`,
      { t },
    );
    const active = employees.filter((e) => e.status !== "exited");
    const counts = await one<Record<string, number>>(
      deps.db,
      `SELECT
         (SELECT COUNT(*) FROM bos_attendance WHERE tenant_id = :t AND work_date = :today AND status IN ('present','wfh','half_day')) AS present,
         (SELECT COUNT(DISTINCT employee_id) FROM bos_leave_requests WHERE tenant_id = :t AND status = 'approved' AND from_date <= :today AND to_date >= :today) AS on_leave,
         (SELECT COUNT(*) FROM bos_leave_requests WHERE tenant_id = :t AND status = 'pending') AS leave_pending,
         (SELECT COUNT(*) FROM bos_expenses WHERE tenant_id = :t AND status = 'submitted') AS expenses_pending,
         (SELECT COUNT(*) FROM bos_profile_changes WHERE tenant_id = :t AND status = 'pending') AS profile_pending,
         (SELECT COUNT(*) FROM bos_attendance WHERE tenant_id = :t AND work_date = :today) AS marked`,
      { t, today },
    );

    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const [y, m] = today.split("-").map(Number);
      months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
    }
    const monthEnd = (ym: string) => addDaysISO(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
    const trend = months.map((ym) => {
      const end = monthEnd(ym);
      return {
        month: ym,
        label: new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
        headcount: employees.filter((e) => e.join_date <= end && (!e.exit_date || e.exit_date > end)).length,
        joiners: employees.filter((e) => e.join_date.slice(0, 7) === ym).length,
      };
    });

    const byDept = new Map<string, number>();
    for (const e of active) byDept.set(e.department_name ?? "Unassigned", (byDept.get(e.department_name ?? "Unassigned") ?? 0) + 1);

    const upcoming = (mmdd: string) => {
      const year = Number(today.slice(0, 4));
      let next = `${year}-${mmdd}`;
      if (next < today) next = `${year + 1}-${mmdd}`;
      return daysBetween(today, next);
    };
    const celebrations: Array<{ employeeId: string; name: string; kind: "birthday" | "anniversary"; inDays: number; years?: number }> = [];
    for (const e of active) {
      if (e.dob) {
        const d = upcoming(e.dob.slice(5));
        if (d <= 14) celebrations.push({ employeeId: e.id, name: fullName(e.first_name, e.last_name), kind: "birthday", inDays: d });
      }
      const d = upcoming(e.join_date.slice(5));
      const years = Number(today.slice(0, 4)) - Number(e.join_date.slice(0, 4)) + (e.join_date.slice(5) < today.slice(5) ? 1 : 0);
      if (d <= 14 && years >= 1 && e.join_date < today) celebrations.push({ employeeId: e.id, name: fullName(e.first_name, e.last_name), kind: "anniversary", inDays: d, years });
    }
    celebrations.sort((a, b) => a.inDays - b.inDays);

    const [holidays, pendingLeave] = await Promise.all([
      rows<{ holiday_date: string; name: string }>(deps.db, `SELECT holiday_date, name FROM bos_holidays WHERE tenant_id = :t AND holiday_date >= :today ORDER BY holiday_date LIMIT 5`, { t, today }),
      rows<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.tenant_id = :t AND l.status = 'pending' ORDER BY l.from_date LIMIT 6`, { t }),
    ]);

    const n = (k: string) => Number(counts?.[k] ?? 0);
    res.json({
      today,
      kpis: {
        headcount: active.length,
        joinersThisMonth: employees.filter((e) => e.join_date.slice(0, 7) === today.slice(0, 7)).length,
        present: n("present"),
        attendanceMarked: n("marked"),
        onLeave: n("on_leave"),
        probation: active.filter((e) => e.status === "probation").length,
        notice: active.filter((e) => e.status === "notice").length,
      },
      pending: { leave: n("leave_pending"), expenses: n("expenses_pending"), profileChanges: n("profile_pending") },
      trend,
      byDepartment: [...byDept.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      celebrations: celebrations.slice(0, 8),
      holidays: holidays.map((h) => ({ date: h.holiday_date, name: h.name })),
      pendingLeave: pendingLeave.map(mapLeave),
    });
  });

  /** Self-service: the signed-in user's own employee record. */
  router.get("/hr/me", async (_req, res) => {
    const actor = actorOf(res);
    const row = await employeeForActor(deps, actor);
    if (!row) {
      res.json({ employee: null });
      return;
    }
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const [used, attendance, leaves] = await Promise.all([
      leaveUsed(deps, actor.tenantId, row.id, fiscalStart(today, settings.fiscalYearStart), ["approved"]),
      monthAttendance(deps, actor.tenantId, row.id, today.slice(0, 7)),
      rows<LeaveRow>(deps.db, `${LEAVE_SELECT} WHERE l.tenant_id = :tenantId AND l.employee_id = :id ORDER BY l.created_at DESC LIMIT 10`, { tenantId: actor.tenantId, id: row.id }),
    ]);
    res.json({ employee: mapEmployee(row, { canSeePay: true }), balances: leaveBalances(settings.leavePolicy, used), attendance, leaves: leaves.map(mapLeave) });
  });
}
