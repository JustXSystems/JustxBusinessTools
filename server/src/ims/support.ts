import type { Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { accessOf, actorName, actorOf, can, isOwner, parse, qstr, recordEvent, type ImsDeps } from "./context.js";
import { exec, json, likeOf, one, rows, tsOf, tx } from "./db.js";
import { ImsError, forbidden, notFound, type ImsActor } from "./host.js";
import { IMS_ROLE_LABELS, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, appendThread, todayISO, type ThreadEntry } from "./logic.js";
import { getSettings } from "./settings.js";
import { nextDocNo } from "./stock.js";

type TicketRow = {
  id: string;
  ticket_no: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  description: string | null;
  thread: unknown;
  raised_by: number | null;
  raised_by_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const mapTicket = (r: TicketRow, withThread: boolean) => {
  const thread = json<ThreadEntry[]>(r.thread, []);
  return {
    id: r.id,
    ticketNo: r.ticket_no,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    description: r.description,
    raisedBy: r.raised_by === null ? null : Number(r.raised_by),
    raisedByName: r.raised_by_name,
    assignedTo: r.assigned_to === null ? null : Number(r.assigned_to),
    assignedToName: r.assigned_to_name,
    replies: thread.length,
    lastReplyAt: thread.length ? thread[thread.length - 1].at : null,
    resolvedAt: tsOf(r.resolved_at),
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    ...(withThread ? { thread } : {}),
  };
};

/** Owners and settings managers see and run every ticket; everyone else sees their own. */
const managesTickets = (res: Response) => isOwner(res) || can(res, "settings");

const categoryKeys = TICKET_CATEGORIES.map((c) => c.key) as [string, ...string[]];

const TicketInput = z.object({
  subject: z.string().trim().min(4, "Add a short subject").max(255),
  category: z.enum(categoryKeys).default("general"),
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
  description: z.string().trim().min(10, "Describe what happened (at least 10 characters)").max(8000),
});

const TicketPatch = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
  assignedToName: z.string().trim().max(120).nullable().optional(),
});

const entryFor = (actor: ImsActor, res: Response, text: string): ThreadEntry => ({
  id: randomUUID(),
  authorId: actor.userId,
  author: actorName(actor) ?? "Someone",
  role: IMS_ROLE_LABELS[accessOf(res).role] ?? null,
  at: new Date().toISOString(),
  text,
});

async function loadTicket(deps: ImsDeps, tenantId: number, id: string): Promise<TicketRow> {
  const row = await one<TicketRow>(deps.db, `SELECT * FROM ims_tickets WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  if (!row) throw notFound("Ticket");
  return row;
}

function assertCanSee(res: Response, actor: ImsActor, row: TicketRow) {
  if (managesTickets(res)) return;
  if (row.raised_by !== null && Number(row.raised_by) === actor.userId) return;
  throw forbidden("You can only open tickets you raised");
}

export function registerSupport(router: Router, deps: ImsDeps): void {
  router.get("/tickets", async (req, res) => {
    const actor = actorOf(res);
    const manager = managesTickets(res);
    const scope = manager && qstr(req.query.scope, 8) === "all" ? "all" : "mine";
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, userId: actor.userId };
    if (scope === "mine") where.push("raised_by = :userId");
    const status = qstr(req.query.status, 12);
    if (status === "active") where.push("status IN ('open', 'in_progress', 'waiting')");
    else if ((TICKET_STATUSES as readonly string[]).includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(subject LIKE :q OR ticket_no LIKE :q OR description LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<TicketRow>(
      deps.db,
      `SELECT * FROM ims_tickets WHERE ${where.join(" AND ")}
       ORDER BY FIELD(status, 'open', 'in_progress', 'waiting', 'resolved', 'closed'), FIELD(priority, 'urgent', 'high', 'normal', 'low'), created_at DESC LIMIT 500`,
      params,
    );
    const counts = await rows<{ status: string; n: number }>(
      deps.db,
      `SELECT status, COUNT(*) AS n FROM ims_tickets WHERE tenant_id = :tenantId ${scope === "mine" ? "AND raised_by = :userId" : ""} GROUP BY status`,
      { tenantId: actor.tenantId, userId: actor.userId },
    );
    res.json({
      tickets: list.map((r) => mapTicket(r, false)),
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
      scope,
      canManage: manager,
      categories: TICKET_CATEGORIES,
      businessCode: `JBT-${String(actor.tenantId).padStart(4, "0")}`,
    });
  });

  router.get("/tickets/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await loadTicket(deps, actor.tenantId, req.params.id);
    assertCanSee(res, actor, row);
    res.json({ ticket: mapTicket(row, true) });
  });

  router.post("/tickets", async (req, res) => {
    const actor = actorOf(res);
    const input = parse(TicketInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const id = randomUUID();
    const ticketNo = await tx(deps.db, async (conn) => {
      const no = await nextDocNo(conn, actor.tenantId, "ticket", settings.ticketPrefix, todayISO(), settings.fiscalYearStart);
      await exec(
        conn,
        `INSERT INTO ims_tickets (id, tenant_id, ticket_no, subject, category, priority, status, description, thread, raised_by, raised_by_name)
         VALUES (:id, :tenantId, :ticketNo, :subject, :category, :priority, 'open', :description, :thread, :userId, :userName)`,
        { id, tenantId: actor.tenantId, ticketNo: no, ...input, thread: JSON.stringify([]), userId: actor.userId, userName: actorName(actor) },
      );
      return no;
    });
    await recordEvent(deps, actor, {
      type: "ticket.created",
      entityType: "ticket",
      entityId: id,
      summary: `Raised ticket ${ticketNo}: ${input.subject}`,
      notice:
        input.priority === "urgent" || input.priority === "high"
          ? { kind: "alert", title: `${input.priority === "urgent" ? "Urgent" : "High-priority"} ticket ${ticketNo}`, body: input.subject, path: `?m=helpdesk&open=${id}` }
          : undefined,
      ip: req.ip,
    });
    res.status(201).json({ ticket: mapTicket(await loadTicket(deps, actor.tenantId, id), true) });
  });

  router.post("/tickets/:id/reply", async (req, res) => {
    const actor = actorOf(res);
    const { text } = parse(z.object({ text: z.string().trim().min(1, "Write a reply").max(4000) }), req.body);
    const row = await loadTicket(deps, actor.tenantId, req.params.id);
    assertCanSee(res, actor, row);
    if (row.status === "closed") throw new ImsError(409, "This ticket is closed — reopen it to reply");
    const manager = managesTickets(res);
    const mine = row.raised_by !== null && Number(row.raised_by) === actor.userId;
    // A manager's answer waits on the raiser; the raiser's follow-up puts it back in the queue.
    const nextStatus = manager && !mine ? (row.status === "open" ? "in_progress" : row.status) : row.status === "waiting" || row.status === "resolved" ? "open" : row.status;
    await exec(deps.db, `UPDATE ims_tickets SET thread = :thread, status = :status, resolved_at = IF(:status IN ('resolved', 'closed'), resolved_at, NULL) WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      thread: JSON.stringify(appendThread(json(row.thread, []), entryFor(actor, res, text))),
      status: nextStatus,
    });
    await recordEvent(deps, actor, { type: "ticket.replied", entityType: "ticket", entityId: row.id, summary: `Replied on ticket ${row.ticket_no}`, ip: req.ip });
    res.json({ ticket: mapTicket(await loadTicket(deps, actor.tenantId, row.id), true) });
  });

  router.patch("/tickets/:id", async (req, res) => {
    const actor = actorOf(res);
    const patch = parse(TicketPatch, req.body);
    const row = await loadTicket(deps, actor.tenantId, req.params.id);
    assertCanSee(res, actor, row);
    const manager = managesTickets(res);
    if (!manager) {
      // The raiser may only close their ticket or reopen it.
      if (patch.priority !== undefined || patch.assignedTo !== undefined) throw forbidden("Only owners can change priority or assignment");
      if (patch.status && !["closed", "open"].includes(patch.status)) throw forbidden("You can close or reopen your own ticket; an owner updates its progress");
    }
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id: row.id };
    if (patch.status) {
      sets.push("status = :status", "resolved_at = IF(:status IN ('resolved', 'closed'), COALESCE(resolved_at, CURRENT_TIMESTAMP), NULL)");
      params.status = patch.status;
    }
    if (patch.priority) {
      sets.push("priority = :priority");
      params.priority = patch.priority;
    }
    if (patch.assignedTo !== undefined) {
      sets.push("assigned_to = :assignedTo", "assigned_to_name = :assignedToName");
      params.assignedTo = patch.assignedTo;
      params.assignedToName = patch.assignedTo === null ? null : (patch.assignedToName ?? null);
    }
    if (!sets.length) {
      res.json({ ticket: mapTicket(row, true) });
      return;
    }
    let thread = json<ThreadEntry[]>(row.thread, []);
    if (patch.status && patch.status !== row.status) {
      thread = appendThread(thread, { ...entryFor(actor, res, `Status changed to ${patch.status.replace("_", " ")}`), role: "system" });
      sets.push("thread = :thread");
      params.thread = JSON.stringify(thread);
    }
    await exec(deps.db, `UPDATE ims_tickets SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
    await recordEvent(deps, actor, {
      type: "ticket.updated",
      entityType: "ticket",
      entityId: row.id,
      summary: `Ticket ${row.ticket_no}${patch.status ? ` → ${patch.status.replace("_", " ")}` : ""}${patch.priority ? ` · priority ${patch.priority}` : ""}`,
      payload: patch,
      ip: req.ip,
    });
    res.json({ ticket: mapTicket(await loadTicket(deps, actor.tenantId, row.id), true) });
  });
}
