import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import type { BosConnector, ConnectorRecord, ConnectorTarget } from "./connectors/types.js";
import { actorOf, parse, recordEvent, type BosDeps } from "./context.js";
import { exec, one, rows, tx } from "./db.js";
import { BosError, notFound, type BosActor } from "./host.js";
import { addDaysISO, todayISO } from "./logic.js";
import { createInvoice, createParty, findParty } from "./finance.js";
import { createProject, getSettings } from "./workspace.js";

type Links = Partial<Record<ConnectorTarget, string>>;

const SYNC_THROTTLE_MS = 30_000;
const lastSync = new Map<number, number>();

async function linksFor(deps: BosDeps, tenantId: number, tool: string): Promise<Map<string, Links>> {
  const list = await rows<{ source_ref: string; target_type: ConnectorTarget; target_id: string }>(
    deps.db,
    `SELECT source_ref, target_type, target_id FROM bos_links WHERE tenant_id = :tenantId AND source_tool = :tool AND target_id <> ''`,
    { tenantId, tool },
  );
  const map = new Map<string, Links>();
  for (const l of list) map.set(l.source_ref, { ...(map.get(l.source_ref) ?? {}), [l.target_type]: l.target_id });
  return map;
}

/**
 * Reserve the (tool, ref, target) link inside the transaction. Returns the existing
 * target id when already imported; concurrent importers block on the PK and then see it.
 */
async function claimLink(conn: PoolConnection, tenantId: number, tool: string, ref: string, target: ConnectorTarget): Promise<string | null> {
  const sql = `SELECT target_id FROM bos_links WHERE tenant_id = :tenantId AND source_tool = :tool AND source_ref = :ref AND target_type = :target`;
  const params = { tenantId, tool, ref, target };
  const existing = await one<{ target_id: string }>(conn, sql, params);
  if (existing?.target_id) return existing.target_id;
  if (existing) return null;
  try {
    await exec(conn, `INSERT INTO bos_links (tenant_id, source_tool, source_ref, target_type, target_id) VALUES (:tenantId, :tool, :ref, :target, '')`, params);
    return null;
  } catch (err) {
    if ((err as { code?: string }).code !== "ER_DUP_ENTRY") throw err;
    return (await one<{ target_id: string }>(conn, sql, params))?.target_id || null;
  }
}

const setLink = (conn: PoolConnection, tenantId: number, tool: string, ref: string, target: ConnectorTarget, id: string) =>
  exec(conn, `UPDATE bos_links SET target_id = :id WHERE tenant_id = :tenantId AND source_tool = :tool AND source_ref = :ref AND target_type = :target`, {
    id,
    tenantId,
    tool,
    ref,
    target,
  });

type Imported = { tool: string; ref: string; docNo: string; target: ConnectorTarget; id: string; label: string; created: boolean };

async function importParty(deps: BosDeps, actor: BosActor, c: BosConnector, r: ConnectorRecord, conn: PoolConnection): Promise<Imported> {
  const existing = await claimLink(conn, actor.tenantId, c.id, r.ref, "party");
  if (existing) return { tool: c.id, ref: r.ref, docNo: r.docNo, target: "party", id: existing, label: r.party.name, created: false };
  let id = await findParty(deps, actor.tenantId, { name: r.party.name, phone: r.party.phone }, conn);
  const created = !id;
  if (!id) {
    id = await createParty(
      deps,
      actor,
      {
        kind: "customer",
        name: r.party.name,
        company: r.party.company ?? null,
        gstin: r.party.gstin ?? null,
        email: r.party.email ?? null,
        phone: r.party.phone ?? null,
        address: r.party.address ?? null,
        city: r.party.city ?? null,
        state: r.party.state ?? null,
        notes: null,
        sourceTool: c.id,
        sourceRef: r.ref,
      },
      conn,
    );
  }
  await setLink(conn, actor.tenantId, c.id, r.ref, "party", id);
  return { tool: c.id, ref: r.ref, docNo: r.docNo, target: "party", id, label: r.party.name, created };
}

async function importRecord(deps: BosDeps, actor: BosActor, c: BosConnector, r: ConnectorRecord, target: ConnectorTarget): Promise<Imported[]> {
  if (!c.targets.includes(target)) throw new BosError(400, `${c.label} records can't become a ${target}`);
  return tx(deps.db, async (conn) => {
    const party = await importParty(deps, actor, c, r, conn);
    if (target === "party") return [party];

    const existing = await claimLink(conn, actor.tenantId, c.id, r.ref, target);
    if (existing) return [party, { tool: c.id, ref: r.ref, docNo: r.docNo, target, id: existing, label: r.docNo, created: false }];

    if (target === "invoice") {
      if (!r.lines?.length) throw new BosError(400, `${r.docNo} has no line items to invoice`);
      const settings = await getSettings(deps, actor.tenantId);
      const today = todayISO();
      const address = [r.party.address, r.party.city, r.party.state].filter(Boolean).join(", ");
      const inv = await createInvoice(
        deps,
        actor,
        {
          partyId: party.id,
          partyName: r.party.company || r.party.name,
          partyGstin: r.party.gstin ?? null,
          partyAddress: address || null,
          issueDate: today,
          dueDate: addDaysISO(today, settings.paymentTermsDays),
          placeOfSupply: r.placeOfSupply ?? null,
          lines: r.lines.map((l) => ({ ...l, hsn: l.hsn ?? null, unit: l.unit ?? null, discountPct: l.discountPct ?? 0 })),
          notes: [r.notes, settings.invoiceNotes].filter(Boolean).join("\n"),
          sourceTool: c.id,
          sourceRef: r.ref,
        },
        conn,
      );
      await setLink(conn, actor.tenantId, c.id, r.ref, "invoice", inv.id);
      return [party, { tool: c.id, ref: r.ref, docNo: r.docNo, target, id: inv.id, label: inv.invoiceNo, created: true }];
    }

    const projectId = await createProject(
      deps,
      actor,
      {
        name: `${r.party.name} — ${r.title}`.slice(0, 200),
        partyId: party.id,
        partyName: r.party.name,
        status: "lead",
        siteAddress: r.siteAddress ?? null,
        valueEstimate: Math.max(0, r.amount),
        startDate: null,
        dueDate: null,
        notes: r.notes ?? null,
        sourceTool: c.id,
        sourceRef: r.ref,
      },
      conn,
    );
    await setLink(conn, actor.tenantId, c.id, r.ref, "project", projectId);
    return [party, { tool: c.id, ref: r.ref, docNo: r.docNo, target, id: projectId, label: r.title, created: true }];
  });
}

const TARGET_LABEL: Record<ConnectorTarget, string> = { party: "customer", invoice: "draft invoice", project: "project lead" };
const TARGET_PATH: Record<ConnectorTarget, string> = { party: "?ws=finance&m=customers", invoice: "?ws=finance&m=invoices", project: "?ws=projects" };

async function announce(deps: BosDeps, actor: BosActor, c: BosConnector, items: Imported[], ip?: string, quiet = false): Promise<void> {
  for (const it of items.filter((i) => i.created)) {
    await recordEvent(deps, actor, {
      type: `connect.${it.target}`,
      entityType: it.target,
      entityId: it.id,
      summary: `${c.label} ${it.docNo} → BOS ${TARGET_LABEL[it.target]} ${it.target === "invoice" ? it.label : ""}`.trim(),
      payload: { sourceTool: c.id, sourceRef: it.ref },
      notice: !quiet && it.target !== "party"
        ? { kind: "workflow", title: `${c.label} synced to BOS`, body: `${it.docNo} became a ${TARGET_LABEL[it.target]}${it.target === "invoice" ? ` (${it.label})` : ""}.`, path: TARGET_PATH[it.target], dedupeKey: `bos-connect:${c.id}:${it.ref}:${it.target}` }
        : undefined,
      ip,
    });
  }
}

function connectorOr404(deps: BosDeps, id: string): BosConnector {
  const c = deps.connectors.find((x) => x.id === id);
  if (!c) throw notFound("Connected tool");
  return c;
}

export function registerConnect(router: Router, deps: BosDeps): void {
  router.get("/connect", async (_req, res) => {
    const actor = actorOf(res);
    const settings = await getSettings(deps, actor.tenantId);
    const connectors = await Promise.all(
      deps.connectors.map(async (c) => {
        const [records, links] = await Promise.all([c.list(actor.tenantId).catch(() => [] as ConnectorRecord[]), linksFor(deps, actor.tenantId, c.id)]);
        const pending = records.filter((r) => c.autoTargets(r).some((t) => !links.get(r.ref)?.[t])).length;
        return { id: c.id, label: c.label, icon: c.icon, description: c.description, href: c.href, targets: c.targets, total: records.length, linked: records.filter((r) => links.has(r.ref)).length, pending };
      }),
    );
    res.json({ autoSync: settings.autoSync, lastSyncAt: lastSync.get(actor.tenantId) ?? null, connectors });
  });

  router.get("/connect/:tool", async (req, res) => {
    const actor = actorOf(res);
    const c = connectorOr404(deps, req.params.tool);
    const [records, links] = await Promise.all([c.list(actor.tenantId), linksFor(deps, actor.tenantId, c.id)]);
    res.json({
      connector: { id: c.id, label: c.label, icon: c.icon, description: c.description, href: c.href, targets: c.targets },
      items: records.map((r) => ({
        ref: r.ref,
        docNo: r.docNo,
        date: r.date,
        status: r.status,
        amount: r.amount,
        title: r.title,
        party: r.party,
        lineCount: r.lines?.length ?? 0,
        suggested: c.autoTargets(r),
        links: links.get(r.ref) ?? {},
      })),
    });
  });

  router.post("/connect/:tool/:ref/import", async (req, res) => {
    const actor = actorOf(res);
    const c = connectorOr404(deps, req.params.tool);
    const { target } = parse(z.object({ target: z.enum(["party", "invoice", "project"]) }), req.body);
    const record = await c.get(actor.tenantId, req.params.ref);
    if (!record) throw notFound(`${c.label} record`);
    const items = await importRecord(deps, actor, c, record, target);
    await announce(deps, actor, c, items, req.ip);
    res.json({ imported: items, links: (await linksFor(deps, actor.tenantId, c.id)).get(record.ref) ?? {} });
  });

  /** Auto-sync: pull eligible records from every connected tool. Cheap, idempotent and throttled. */
  router.post("/connect/sync", async (req, res) => {
    const actor = actorOf(res);
    const force = Boolean(req.body?.force);
    const settings = await getSettings(deps, actor.tenantId);
    if (!settings.autoSync && !force) {
      res.json({ skipped: "disabled", imported: [] });
      return;
    }
    const last = lastSync.get(actor.tenantId) ?? 0;
    if (!force && Date.now() - last < SYNC_THROTTLE_MS) {
      res.json({ skipped: "throttled", imported: [], lastSyncAt: last });
      return;
    }
    lastSync.set(actor.tenantId, Date.now());
    const imported: Imported[] = [];
    const errors: string[] = [];
    for (const c of deps.connectors) {
      let records: ConnectorRecord[] = [];
      try {
        records = await c.list(actor.tenantId);
      } catch (err) {
        errors.push(`${c.label}: ${err instanceof Error ? err.message : "unavailable"}`);
        continue;
      }
      const links = await linksFor(deps, actor.tenantId, c.id);
      for (const r of records) {
        for (const target of c.autoTargets(r)) {
          if (links.get(r.ref)?.[target]) continue;
          try {
            const items = await importRecord(deps, actor, c, r, target);
            await announce(deps, actor, c, items, req.ip);
            imported.push(...items.filter((i) => i.created));
            links.set(r.ref, { ...(links.get(r.ref) ?? {}), ...Object.fromEntries(items.map((i) => [i.target, i.id])) });
          } catch (err) {
            errors.push(`${c.label} ${r.docNo}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }
      }
    }
    res.json({ imported, errors, lastSyncAt: lastSync.get(actor.tenantId) });
  });

  /** Reverse lookup for other tools: "what did BOS make from my record?" */
  router.get("/links", async (req, res) => {
    const actor = actorOf(res);
    const tool = String(req.query.sourceTool ?? "");
    const ref = String(req.query.sourceRef ?? "");
    if (!tool || !ref) throw new BosError(400, "sourceTool and sourceRef are required");
    const list = await rows<{ target_type: ConnectorTarget; target_id: string }>(
      deps.db,
      `SELECT target_type, target_id FROM bos_links WHERE tenant_id = :tenantId AND source_tool = :tool AND source_ref = :ref AND target_id <> ''`,
      { tenantId: actor.tenantId, tool, ref },
    );
    res.json({ links: Object.fromEntries(list.map((l) => [l.target_type, l.target_id])) });
  });
}
