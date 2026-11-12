/**
 * Extra BOM routes for Phases 1–4 MVP.
 * Loaders are injected to avoid a circular import with bom.ts.
 */
import type { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyPartialIssue,
  computeAsBuiltVariance,
  computeCostRollup,
  defaultVariablesFromCapacity,
  diffBomLines,
  diffKeyOf,
  evalQtyFormula,
  evaluateConfirmGates,
  FORMULA_PRESETS,
  proposalWhatsAppUrl,
  type GateLine,
} from "./bom-enhance.js";
import { actorOf, optText, parse, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, notFound } from "./host.js";

export type BomEnhanceDoc = {
  id: string;
  docNo: string;
  status: string;
  customerName: string;
  capacityLabel: string | null;
  marginPct: number;
  revision?: number;
  lines?: BomEnhanceDocLine[];
};

export type BomEnhanceDocLine = {
  id: string;
  section: string;
  sortNo: number;
  lineKind: string;
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  scaleByCapacity: boolean;
  costRate?: number | null;
  scrapPct?: number;
  issuedQty?: number;
  serviceSpare?: boolean;
};

export type BomEnhancePackage = {
  id: string;
  lines?: Array<{
    id: string;
    section: string;
    sortNo: number;
    description: string;
    qty: number;
    unit: string;
    defaultRate: number;
    itemId: string | null;
    lineKind: string;
    serviceSpare?: boolean;
  }>;
};

export type BomEnhanceLoaders = {
  loadDoc: (db: Queryable, tenantId: number, id: string) => Promise<BomEnhanceDoc | null>;
  loadPackage: (db: Queryable, tenantId: number, id: string) => Promise<BomEnhancePackage | null>;
};

async function saveRevision(
  db: Queryable,
  args: {
    tenantId: number;
    entityType: "package" | "doc";
    entityId: string;
    revision: number;
    snapshot: unknown;
    actorId: number | null;
    actorName: string | null;
  },
) {
  await exec(
    db,
    `INSERT INTO ims_bom_revisions
      (id, tenant_id, entity_type, entity_id, revision, snapshot_json, created_by, created_by_name)
     VALUES
      (:id, :tenantId, :entityType, :entityId, :revision, CAST(:snapshot AS JSON), :createdBy, :createdByName)
     ON DUPLICATE KEY UPDATE snapshot_json = VALUES(snapshot_json)`,
    {
      id: randomUUID(),
      tenantId: args.tenantId,
      entityType: args.entityType,
      entityId: args.entityId,
      revision: args.revision,
      snapshot: JSON.stringify(args.snapshot),
      createdBy: args.actorId,
      createdByName: args.actorName,
    },
  );
}

export async function buildGateLines(
  db: Queryable,
  tenantId: number,
  lines: ReadonlyArray<BomEnhanceDocLine>,
): Promise<GateLine[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const active = new Map<string, boolean>();
  if (itemIds.length) {
    const params: Record<string, unknown> = { tenantId };
    const inList = itemIds.map((id, i) => {
      params[`i${i}`] = id;
      return `:i${i}`;
    });
    const items = await rows<{ id: string; active: number }>(
      db,
      `SELECT id, active FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
      params,
    );
    for (const it of items) active.set(it.id, Boolean(it.active));
  }
  return lines.map((l) => ({
    id: l.id,
    section: l.section,
    lineKind: l.lineKind,
    itemId: l.itemId,
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    rate: l.rate,
    scaleByCapacity: l.scaleByCapacity,
    itemActive: l.itemId ? (active.get(l.itemId) ?? false) : null,
  }));
}

export async function enrichDocCosts(db: Queryable, tenantId: number, doc: BomEnhanceDoc) {
  const lines = doc.lines ?? [];
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const costs = new Map<string, number>();
  if (itemIds.length) {
    const params: Record<string, unknown> = { tenantId };
    const inList = itemIds.map((id, i) => {
      params[`i${i}`] = id;
      return `:i${i}`;
    });
    const items = await rows<{ id: string; purchase_price: string }>(
      db,
      `SELECT id, purchase_price FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
      params,
    );
    for (const it of items) costs.set(it.id, money(it.purchase_price));
  }
  const rollup = computeCostRollup(
    lines.map((l) => ({
      qty: l.qty,
      rate: l.rate,
      costRate: l.costRate ?? (l.itemId ? costs.get(l.itemId) ?? 0 : 0),
      scrapPct: l.scrapPct ?? 0,
    })),
    doc.marginPct,
  );
  return { materialsCost: rollup.materialsCost, rollup };
}

export async function confirmBomDoc(
  deps: ImsDeps,
  actor: { tenantId: number; userId: number | null; name: string | null },
  doc: BomEnhanceDoc,
  acknowledgeWarnings: boolean,
) {
  const gateLines = await buildGateLines(deps.db, actor.tenantId, doc.lines ?? []);
  const gates = evaluateConfirmGates({
    customerName: doc.customerName,
    capacityLabel: doc.capacityLabel,
    lines: gateLines,
    acknowledgeWarnings,
  });
  if (!gates.ok) {
    const msg = gates.errors[0]?.message || gates.warnings[0]?.message || "Confirm blocked by quality gates";
    const err = conflict(msg) as Error & { gates?: typeof gates; status?: number; body?: unknown };
    // Attach gates for the route handler to return structured JSON
    (err as { gates?: typeof gates }).gates = gates;
    throw Object.assign(err, { gates });
  }
  const { materialsCost } = await enrichDocCosts(deps.db, actor.tenantId, doc);
  const revision = Number(doc.revision ?? 1);
  await tx(deps.db, async (conn) => {
    await saveRevision(conn, {
      tenantId: actor.tenantId,
      entityType: "doc",
      entityId: doc.id,
      revision,
      snapshot: doc,
      actorId: actor.userId,
      actorName: actor.name,
    });
    await exec(
      conn,
      `UPDATE ims_bom_docs SET status = 'confirmed', materials_cost = :materialsCost
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { tenantId: actor.tenantId, id: doc.id, materialsCost },
    );
  });
  await recordEvent(deps, actor as never, {
    type: "bom.doc.confirmed",
    entityType: "bom_doc",
    entityId: doc.id,
    summary: `Confirmed ${doc.docNo} (rev ${revision})`,
    payload: { docNo: doc.docNo, revision, materialsCost },
  });
  return { gates, materialsCost, revision };
}

export async function reopenBomDoc(
  deps: ImsDeps,
  actor: { tenantId: number; userId: number | null; name: string | null },
  doc: BomEnhanceDoc,
) {
  const nextRev = Number(doc.revision ?? 1) + 1;
  await exec(
    deps.db,
    `UPDATE ims_bom_docs SET status = 'draft', revision = :revision
     WHERE tenant_id = :tenantId AND id = :id AND status = 'confirmed'`,
    { tenantId: actor.tenantId, id: doc.id, revision: nextRev },
  );
  await recordEvent(deps, actor as never, {
    type: "bom.doc.reopened",
    entityType: "bom_doc",
    entityId: doc.id,
    summary: `Reopened ${doc.docNo} as draft rev ${nextRev}`,
    payload: { docNo: doc.docNo, revision: nextRev },
  });
  return nextRev;
}

export function registerBomEnhance(router: Router, deps: ImsDeps, loaders: BomEnhanceLoaders): void {
  router.get("/bom/formula-presets", (_req, res) => {
    requirePerm(res, "bom");
    res.json({ presets: FORMULA_PRESETS });
  });

  router.post("/bom/formula/eval", (req, res) => {
    requirePerm(res, "bom");
    const body = parse(
      z.object({
        formula: z.string().trim().min(1).max(240),
        variables: z.record(z.string(), z.coerce.number()).default({}),
        capacityLabel: optText(120),
      }),
      req.body,
    );
    const vars = { ...defaultVariablesFromCapacity(body.capacityLabel), ...body.variables };
    try {
      res.json({ qty: evalQtyFormula(body.formula, vars), variables: vars });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : "Invalid formula");
    }
  });

  router.get("/bom/docs/:id/gates", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    const gates = evaluateConfirmGates({
      customerName: doc.customerName,
      capacityLabel: doc.capacityLabel,
      lines: await buildGateLines(deps.db, actor.tenantId, doc.lines ?? []),
      acknowledgeWarnings: false,
    });
    res.json({ gates });
  });

  router.get("/bom/docs/:id/cost", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    const { materialsCost, rollup } = await enrichDocCosts(deps.db, actor.tenantId, doc);
    res.json({
      materialsCost,
      materialsSell: rollup.materialsSell,
      marginAmount: rollup.marginAmount,
      marginPctOfSell: rollup.marginPctOfSell,
      lines: (doc.lines ?? []).map((l, i) => ({ id: l.id, description: l.description, ...rollup.lineMargins[i] })),
    });
  });

  router.get("/bom/revisions", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const entityType = String(req.query.entityType || "");
    const entityId = String(req.query.entityId || "");
    if (entityType !== "package" && entityType !== "doc") throw badRequest("entityType must be package or doc");
    if (!entityId) throw badRequest("entityId is required");
    const list = await rows<{ id: string; revision: number; created_by_name: string | null; created_at: string }>(
      deps.db,
      `SELECT id, revision, created_by_name, created_at FROM ims_bom_revisions
       WHERE tenant_id = :tenantId AND entity_type = :entityType AND entity_id = :entityId
       ORDER BY revision DESC`,
      { tenantId: actor.tenantId, entityType, entityId },
    );
    res.json({
      revisions: list.map((r) => ({
        id: r.id,
        revision: Number(r.revision),
        createdByName: r.created_by_name,
        createdAt: tsOf(r.created_at),
      })),
    });
  });

  router.get("/bom/revisions/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const r = await one<{
      id: string;
      entity_type: string;
      entity_id: string;
      revision: number;
      snapshot_json: unknown;
      created_by_name: string | null;
      created_at: string;
    }>(
      deps.db,
      `SELECT id, entity_type, entity_id, revision, snapshot_json, created_by_name, created_at
       FROM ims_bom_revisions WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
      { tenantId: actor.tenantId, id: String(req.params.id) },
    );
    if (!r) throw notFound("Revision not found");
    const snapshot = typeof r.snapshot_json === "string" ? JSON.parse(r.snapshot_json) : r.snapshot_json;
    res.json({
      revision: {
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        revision: Number(r.revision),
        snapshot,
        createdByName: r.created_by_name,
        createdAt: tsOf(r.created_at),
      },
    });
  });

  router.post("/bom/docs/:id/pdf", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ pdfBase64: z.string().min(16).max(12_000_000) }), req.body);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    const buf = Buffer.from(body.pdfBase64.replace(/^data:application\/pdf;base64,/, ""), "base64");
    if (buf.length < 5 || buf.subarray(0, 4).toString() !== "%PDF") throw badRequest("Invalid PDF payload");
    const sha = createHash("sha256").update(buf).digest("hex");
    const artifactId = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_bom_pdf_blobs (id, tenant_id, doc_id, sha256, pdf_base64)
       VALUES (:id, :tenantId, :docId, :sha, :pdf)`,
      { id: artifactId, tenantId: actor.tenantId, docId: id, sha, pdf: buf.toString("base64") },
    );
    await exec(
      deps.db,
      `UPDATE ims_bom_docs SET pdf_artifact_id = :artifactId, pdf_sha256 = :sha, pdf_generated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id, artifactId, sha },
    );
    await recordEvent(deps, actor, {
      type: "bom.doc.pdf",
      entityType: "bom_doc",
      entityId: id,
      summary: `Stored PDF for ${doc.docNo}`,
      payload: { sha256: sha, bytes: buf.length },
    });
    res.json({ sha256: sha, artifactId, doc: await loaders.loadDoc(deps.db, actor.tenantId, id) });
  });

  router.get("/bom/docs/:id/pdf", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    const blob = await one<{ pdf_base64: string; sha256: string }>(
      deps.db,
      `SELECT pdf_base64, sha256 FROM ims_bom_pdf_blobs WHERE tenant_id = :tenantId AND doc_id = :docId ORDER BY created_at DESC LIMIT 1`,
      { tenantId: actor.tenantId, docId: id },
    );
    if (!blob) throw notFound("No PDF stored for this BOM");
    res.json({ sha256: blob.sha256, pdfBase64: blob.pdf_base64 });
  });

  router.post("/bom/docs/:id/proposal", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before sharing a proposal");
    const token = randomBytes(24).toString("hex");
    await exec(
      deps.db,
      `UPDATE ims_bom_docs SET proposal_token = :token, proposal_status = 'sent', proposal_sent_at = CURRENT_TIMESTAMP,
        proposal_responded_at = NULL, proposal_response_note = NULL
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id, token },
    );
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    const proposalPath = `/bom/proposal/${token}`;
    const proposalUrl = origin ? `${origin}${proposalPath}` : proposalPath;
    await recordEvent(deps, actor, {
      type: "bom.doc.proposal_sent",
      entityType: "bom_doc",
      entityId: id,
      summary: `Proposal link created for ${doc.docNo}`,
      payload: { token },
    });
    res.json({
      token,
      proposalPath,
      proposalUrl,
      whatsappUrl: proposalWhatsAppUrl(proposalUrl, doc.customerName),
      doc: await loaders.loadDoc(deps.db, actor.tenantId, id),
    });
  });

  router.post("/bom/docs/:id/proposal/revoke", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    if (!(await loaders.loadDoc(deps.db, actor.tenantId, id))) throw notFound("BOM document not found");
    await exec(
      deps.db,
      `UPDATE ims_bom_docs SET proposal_status = 'revoked' WHERE tenant_id = :tenantId AND id = :id AND proposal_token IS NOT NULL`,
      { tenantId: actor.tenantId, id },
    );
    res.json({ doc: await loaders.loadDoc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/diff", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const body = parse(
      z.object({
        leftDocId: z.string().uuid().optional(),
        rightDocId: z.string().uuid().optional(),
        leftPackageId: z.string().uuid().optional(),
        rightPackageId: z.string().uuid().optional(),
      }),
      req.body,
    );
    const loadLines = async (docId?: string, packageId?: string) => {
      if (docId) {
        const d = await loaders.loadDoc(deps.db, actor.tenantId, docId);
        if (!d) throw notFound("BOM not found");
        return (d.lines ?? []).map((l) => ({
          key: diffKeyOf(l),
          description: l.description,
          section: l.section,
          qty: l.qty,
          rate: l.rate,
          unit: l.unit,
        }));
      }
      if (packageId) {
        const p = await loaders.loadPackage(deps.db, actor.tenantId, packageId);
        if (!p) throw notFound("Package not found");
        return (p.lines ?? []).map((l) => ({
          key: diffKeyOf(l),
          description: l.description,
          section: l.section,
          qty: l.qty,
          rate: l.defaultRate,
          unit: l.unit,
        }));
      }
      throw badRequest("Provide left/right doc or package ids");
    };
    res.json({
      diff: diffBomLines(await loadLines(body.leftDocId, body.leftPackageId), await loadLines(body.rightDocId, body.rightPackageId)),
    });
  });

  router.post("/bom/docs/:id/as-built", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM first");
    const variance = computeAsBuiltVariance(
      (doc.lines ?? []).map((l) => ({
        lineId: l.id,
        description: l.description,
        soldQty: l.qty,
        issuedQty: l.issuedQty ?? 0,
        unit: l.unit,
      })),
    );
    await exec(
      deps.db,
      `UPDATE ims_bom_docs SET as_built_at = CURRENT_TIMESTAMP, as_built_json = CAST(:json AS JSON)
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id, json: JSON.stringify({ variance, frozenAt: new Date().toISOString() }) },
    );
    await recordEvent(deps, actor, {
      type: "bom.doc.as_built",
      entityType: "bom_doc",
      entityId: id,
      summary: `As-built frozen for ${doc.docNo}`,
      payload: { lines: variance.length },
    });
    res.json({ variance, doc: await loaders.loadDoc(deps.db, actor.tenantId, id) });
  });

  router.get("/bom/docs/:id/service-kit", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    const lines = (doc.lines ?? []).filter((l) => l.serviceSpare || l.lineKind === "service");
    res.json({ lines, count: lines.length });
  });

  router.get("/bom/packages/:id/service-kit", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const pkg = await loaders.loadPackage(deps.db, actor.tenantId, String(req.params.id));
    if (!pkg) throw notFound("Package not found");
    const lines = (pkg.lines ?? []).filter((l) => l.serviceSpare || l.lineKind === "service");
    res.json({ lines, count: lines.length });
  });

  // Keep applyPartialIssue referenced for upcoming partial-issue route wiring.
  void applyPartialIssue;
}
