/**
 * Extra BOM routes for Phases 1–4 MVP.
 * Loaders are injected to avoid a circular import with bom.ts.
 */
import type { Router } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyPartialIssue,
  applyRateCardRates,
  computeAsBuiltVariance,
  computeCostRollup,
  defaultVariablesFromCapacity,
  diffBomLines,
  diffKeyOf,
  evalQtyFormula,
  evaluateConfirmGates,
  explodeNestedPackageLines,
  FORMULA_PRESETS,
  isLegacyFullIssue,
  lineIncludedByOptions,
  matchRateCardToBomLines,
  mergeSerialNotes,
  normalizeOptionSelection,
  proposalWhatsAppUrl,
  remainingIssueQty,
  rotateAlternates,
  selectedOptionKeys,
  SERIAL_NOTES_MAX,
  suggestAlternatesForShortfall,
  type GateLine,
  type PackageLineLike,
} from "./bom-enhance.js";
import { actorName, actorOf, isoDate, optText, parse, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, notFound } from "./host.js";
import { computeTotals, formatINR, isIntraStateSupply, round2, round3, todayISO } from "./logic.js";
import { loadParty } from "./parties.js";
import { getSettings } from "./settings.js";
import { nextDocNo, postMovement } from "./stock.js";

export type BomEnhanceDoc = {
  id: string;
  docNo: string;
  status: string;
  customerName: string;
  capacityLabel: string | null;
  marginPct: number;
  taxPct?: number;
  revision?: number;
  rateCardId?: string | null;
  title?: string | null;
  partyId?: string | null;
  stockIssuedAt?: string | null;
  stockIssueCount?: number;
  invoiceId?: string | null;
  invoiceConvertMode?: string | null;
  variables?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  lines?: BomEnhanceDocLine[];
};

export type BomEnhanceDocLine = {
  id: string;
  section: string;
  sortNo: number;
  lineKind: string;
  itemId: string | null;
  itemSku?: string | null;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  amount?: number;
  scaleByCapacity: boolean;
  costRate?: number | null;
  scrapPct?: number;
  issuedQty?: number;
  serialNotes?: string | null;
  serviceSpare?: boolean;
  alternateItemIds?: string[];
  optionalFlag?: boolean;
  optionKey?: string | null;
};

export type BomEnhancePackage = {
  id: string;
  name?: string;
  capacityLabel?: string | null;
  active?: boolean;
  variables?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  lines?: Array<PackageLineLike & { id: string; sortNo: number; defaultRate: number }>;
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

  /* ---------- Rate cards ---------- */

  const rateCardLineInput = z.object({
    id: z.string().uuid().optional(),
    itemId: z.string().uuid().nullable().optional(),
    sku: optText(80),
    description: optText(500),
    unit: z.string().trim().min(1).max(24).default("nos"),
    rate: z.coerce.number().min(0).max(1e12),
    costRate: z.coerce.number().min(0).max(1e12).nullable().optional(),
    sortNo: z.coerce.number().int().min(0).max(99999).optional(),
    active: z.boolean().optional(),
  });

  const rateCardInput = z.object({
    code: optText(40),
    name: z.string().trim().min(1).max(200),
    currency: z.string().trim().min(1).max(8).default("INR"),
    validFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    validTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    active: z.boolean().optional(),
    notes: optText(4000),
    lines: z.array(rateCardLineInput).max(2000).default([]),
  });

  type RateCardRow = {
    id: string;
    code: string | null;
    name: string;
    currency: string;
    valid_from: string | null;
    valid_to: string | null;
    active: number;
    notes: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
  };

  type RateCardLineRow = {
    id: string;
    rate_card_id: string;
    item_id: string | null;
    sku: string | null;
    description: string | null;
    unit: string;
    rate: string;
    cost_rate: string | null;
    sort_no: number;
    active: number;
  };

  const mapRateCardLine = (r: RateCardLineRow) => ({
    id: r.id,
    rateCardId: r.rate_card_id,
    itemId: r.item_id,
    sku: r.sku,
    description: r.description,
    unit: r.unit,
    rate: round2(money(r.rate)),
    costRate: r.cost_rate == null ? null : round2(money(r.cost_rate)),
    sortNo: Number(r.sort_no),
    active: Boolean(r.active),
  });

  const mapRateCard = (r: RateCardRow, lines?: ReturnType<typeof mapRateCardLine>[]) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    currency: r.currency,
    validFrom: r.valid_from ? isoOf(r.valid_from) : null,
    validTo: r.valid_to ? isoOf(r.valid_to) : null,
    active: Boolean(r.active),
    notes: r.notes,
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    lines: lines ?? undefined,
    lineCount: lines?.length,
  });

  async function loadRateCardLines(db: Queryable, tenantId: number, rateCardId: string) {
    const list = await rows<RateCardLineRow>(
      db,
      `SELECT * FROM ims_bom_rate_card_lines
       WHERE tenant_id = :tenantId AND rate_card_id = :rateCardId
       ORDER BY sort_no ASC, created_at ASC`,
      { tenantId, rateCardId },
    );
    return list.map(mapRateCardLine);
  }

  async function loadRateCard(db: Queryable, tenantId: number, id: string) {
    const r = await one<RateCardRow>(
      db,
      `SELECT * FROM ims_bom_rate_cards WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
      { tenantId, id },
    );
    if (!r) return null;
    return mapRateCard(r, await loadRateCardLines(db, tenantId, id));
  }

  async function replaceRateCardLines(
    db: Queryable,
    tenantId: number,
    rateCardId: string,
    lines: z.infer<typeof rateCardLineInput>[],
  ) {
    await exec(db, `DELETE FROM ims_bom_rate_card_lines WHERE tenant_id = :tenantId AND rate_card_id = :rateCardId`, {
      tenantId,
      rateCardId,
    });
    let sort = 0;
    for (const l of lines) {
      await exec(
        db,
        `INSERT INTO ims_bom_rate_card_lines
          (id, tenant_id, rate_card_id, item_id, sku, description, unit, rate, cost_rate, sort_no, active)
         VALUES
          (:id, :tenantId, :rateCardId, :itemId, :sku, :description, :unit, :rate, :costRate, :sortNo, :active)`,
        {
          id: l.id ?? randomUUID(),
          tenantId,
          rateCardId,
          itemId: l.itemId ?? null,
          sku: l.sku ?? null,
          description: l.description ?? null,
          unit: l.unit,
          rate: round2(l.rate),
          costRate: l.costRate == null ? null : round2(l.costRate),
          sortNo: l.sortNo ?? sort,
          active: l.active === false ? 0 : 1,
        },
      );
      sort += 1;
    }
  }

  router.get("/bom/rate-cards", async (_req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const list = await rows<RateCardRow & { line_count: number }>(
      deps.db,
      `SELECT c.*,
          (SELECT COUNT(*) FROM ims_bom_rate_card_lines l WHERE l.tenant_id = c.tenant_id AND l.rate_card_id = c.id) AS line_count
       FROM ims_bom_rate_cards c
       WHERE c.tenant_id = :tenantId AND c.active = 1
       ORDER BY c.name ASC, c.created_at DESC`,
      { tenantId: actor.tenantId },
    );
    res.json({
      rateCards: list.map((r) => ({
        ...mapRateCard(r),
        lineCount: Number(r.line_count ?? 0),
      })),
    });
  });

  router.get("/bom/rate-cards/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const card = await loadRateCard(deps.db, actor.tenantId, String(req.params.id));
    if (!card) throw notFound("Rate card");
    res.json({ rateCard: card });
  });

  router.post("/bom/rate-cards", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const input = parse(rateCardInput, req.body);
    const id = randomUUID();
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `INSERT INTO ims_bom_rate_cards
          (id, tenant_id, code, name, currency, valid_from, valid_to, active, notes, created_by, created_by_name)
         VALUES
          (:id, :tenantId, :code, :name, :currency, :validFrom, :validTo, :active, :notes, :createdBy, :createdByName)`,
        {
          id,
          tenantId: actor.tenantId,
          code: input.code ?? null,
          name: input.name,
          currency: input.currency,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          active: input.active === false ? 0 : 1,
          notes: input.notes ?? null,
          createdBy: actor.userId,
          createdByName: actorName(actor),
        },
      );
      await replaceRateCardLines(conn, actor.tenantId, id, input.lines);
    });
    await recordEvent(deps, actor, {
      type: "bom.rate_card.created",
      entityType: "bom_rate_card",
      entityId: id,
      summary: `Created rate card ${input.name}`,
      payload: { name: input.name, lines: input.lines.length },
    });
    res.status(201).json({ rateCard: await loadRateCard(deps.db, actor.tenantId, id) });
  });

  router.put("/bom/rate-cards/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadRateCard(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Rate card");
    const input = parse(rateCardInput, req.body);
    await tx(deps.db, async (conn) => {
      const updated = await exec(
        conn,
        `UPDATE ims_bom_rate_cards SET
           code = :code, name = :name, currency = :currency, valid_from = :validFrom, valid_to = :validTo,
           active = :active, notes = :notes
         WHERE tenant_id = :tenantId AND id = :id`,
        {
          id,
          tenantId: actor.tenantId,
          code: input.code ?? null,
          name: input.name,
          currency: input.currency,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          active: input.active === false ? 0 : 1,
          notes: input.notes ?? null,
        },
      );
      if (!updated.affectedRows) throw conflict("Rate card changed — reload and try again");
      await replaceRateCardLines(conn, actor.tenantId, id, input.lines);
    });
    await recordEvent(deps, actor, {
      type: "bom.rate_card.updated",
      entityType: "bom_rate_card",
      entityId: id,
      summary: `Updated rate card ${input.name}`,
      payload: { name: input.name, lines: input.lines.length },
    });
    res.json({ rateCard: await loadRateCard(deps.db, actor.tenantId, id) });
  });

  router.delete("/bom/rate-cards/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadRateCard(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Rate card");
    await exec(
      deps.db,
      `UPDATE ims_bom_rate_cards SET active = 0 WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id },
    );
    await recordEvent(deps, actor, {
      type: "bom.rate_card.deactivated",
      entityType: "bom_rate_card",
      entityId: id,
      summary: `Deactivated rate card ${existing.name}`,
      payload: { name: existing.name },
    });
    res.json({ rateCard: await loadRateCard(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/docs/:id/apply-rate-card", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ rateCardId: z.string().uuid() }), req.body);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "draft") throw conflict("Only draft BOMs can apply a rate card");
    const card = await loadRateCard(deps.db, actor.tenantId, body.rateCardId);
    if (!card || !card.active) throw notFound("Rate card");
    const lines = doc.lines ?? [];
    const matches = matchRateCardToBomLines(
      lines.map((l) => ({ id: l.id, itemId: l.itemId, itemSku: l.itemSku ?? null })),
      (card.lines ?? []).filter((l) => l.active).map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        rate: l.rate,
        costRate: l.costRate,
      })),
    );
    const updatedLines = applyRateCardRates(
      lines.map((l) => ({ ...l, costRate: l.costRate ?? null })),
      (card.lines ?? []).filter((l) => l.active).map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        rate: l.rate,
        costRate: l.costRate,
      })),
    );
    const matchById = new Map(matches.map((m) => [m.lineId, m]));
    await tx(deps.db, async (conn) => {
      for (const line of updatedLines) {
        const m = matchById.get(line.id);
        if (!m) continue;
        const amount = round2(round3(line.qty) * round2(m.rate));
        await exec(
          conn,
          `UPDATE ims_bom_doc_lines
           SET rate = :rate, amount = :amount, cost_rate = COALESCE(:costRate, cost_rate)
           WHERE tenant_id = :tenantId AND doc_id = :docId AND id = :lineId`,
          {
            tenantId: actor.tenantId,
            docId: id,
            lineId: line.id,
            rate: m.rate,
            amount,
            costRate: m.costRate,
          },
        );
      }
      const materialsTotal = round2(updatedLines.reduce((s, l) => s + round2(round3(l.qty) * round2(l.rate)), 0));
      const marginPct = Number(doc.marginPct) || 0;
      const taxPct = Number(doc.taxPct) || 0;
      const marginAmount = round2(materialsTotal * marginPct / 100);
      const taxAmount = round2((materialsTotal + marginAmount) * taxPct / 100);
      const grandTotal = round2(materialsTotal + marginAmount + taxAmount);
      await exec(
        conn,
        `UPDATE ims_bom_docs SET
           rate_card_id = :rateCardId,
           materials_total = :materialsTotal,
           margin_amount = :marginAmount,
           tax_amount = :taxAmount,
           grand_total = :grandTotal
         WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
        {
          tenantId: actor.tenantId,
          id,
          rateCardId: body.rateCardId,
          materialsTotal,
          marginAmount,
          taxAmount,
          grandTotal,
        },
      );
    });
    await recordEvent(deps, actor, {
      type: "bom.doc.rate_card_applied",
      entityType: "bom_doc",
      entityId: id,
      summary: `Applied rate card ${card.name} to ${doc.docNo}`,
      payload: { rateCardId: body.rateCardId, matched: matches.length },
    });
    res.json({
      matched: matches.length,
      matches,
      doc: await loaders.loadDoc(deps.db, actor.tenantId, id),
    });
  });

  /* ---------- BOM → PO from shortfall ---------- */

  router.post("/bom/docs/:id/create-pos", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "po");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before creating purchase orders");

    // Duplicate shortfall aggregation (avoid importing computeBomAvailability from bom.js → cycle).
    const need = new Map<string, { qty: number; name: string; unit: string }>();
    for (const l of doc.lines ?? []) {
      if (l.lineKind !== "stock" || !l.itemId || !(l.qty > 0)) continue;
      const cur = need.get(l.itemId) ?? { qty: 0, name: l.description, unit: l.unit || "nos" };
      cur.qty = round3(cur.qty + l.qty);
      need.set(l.itemId, cur);
    }
    if (!need.size) {
      res.json({ orders: [] });
      return;
    }
    const ids = [...need.keys()];
    const stockParams: Record<string, unknown> = { tenantId: actor.tenantId };
    const stockIn = ids.map((itemId, i) => {
      stockParams[`i${i}`] = itemId;
      return `:i${i}`;
    });
    const stockRows = await rows<{ id: string; name: string; unit: string; current_stock: string }>(
      deps.db,
      `SELECT id, name, unit, current_stock FROM ims_items WHERE tenant_id = :tenantId AND id IN (${stockIn.join(",")})`,
      stockParams,
    );
    const have = new Map(stockRows.map((r) => [r.id, r]));
    const shortfalls = ids
      .map((itemId) => {
        const n = need.get(itemId)!;
        const item = have.get(itemId);
        const onHand = item ? round3(money(item.current_stock)) : 0;
        const shortfall = round3(Math.max(0, n.qty - onHand));
        return { itemId, shortfall };
      })
      .filter((x) => x.shortfall > 0);
    if (!shortfalls.length) {
      res.json({ orders: [] });
      return;
    }

    const shortfallIds = shortfalls.map((s) => s.itemId);
    const itemParams: Record<string, unknown> = { tenantId: actor.tenantId };
    const itemIn = shortfallIds.map((itemId, i) => {
      itemParams[`i${i}`] = itemId;
      return `:i${i}`;
    });
    const items = await rows<{
      id: string;
      name: string;
      sku: string | null;
      hsn: string | null;
      unit: string;
      purchase_price: string;
      supplier_id: string | null;
      gst_rate: string;
    }>(
      deps.db,
      `SELECT id, name, sku, hsn, unit, purchase_price, supplier_id, gst_rate
       FROM ims_items WHERE tenant_id = :tenantId AND id IN (${itemIn.join(",")})`,
      itemParams,
    );
    const shortfallByItem = new Map(shortfalls.map((s) => [s.itemId, s.shortfall]));
    type GroupLine = {
      itemId: string;
      name: string;
      sku: string | null;
      hsn: string | null;
      unit: string;
      qty: number;
      rate: number;
      gstRate: number;
    };
    const groups = new Map<string, { supplierId: string | null; supplierName: string; lines: GroupLine[] }>();
    for (const it of items) {
      const qty = shortfallByItem.get(it.id) ?? 0;
      if (!(qty > 0)) continue;
      const key = it.supplier_id ?? "unassigned";
      let g = groups.get(key);
      if (!g) {
        g = {
          supplierId: it.supplier_id,
          supplierName: it.supplier_id ? "" : "Supplier TBD",
          lines: [],
        };
        groups.set(key, g);
      }
      g.lines.push({
        itemId: it.id,
        name: it.name,
        sku: it.sku,
        hsn: it.hsn,
        unit: it.unit || "nos",
        qty,
        rate: round2(money(it.purchase_price)),
        gstRate: round2(money(it.gst_rate)),
      });
    }

    const settings = await getSettings(deps, actor.tenantId);
    const orderDate = todayISO();
    const orders: Array<Record<string, unknown>> = [];

    for (const g of groups.values()) {
      if (!g.lines.length) continue;
      let supplierName = g.supplierName;
      let supplierSnap: Record<string, unknown> = { name: supplierName || "Supplier TBD" };
      if (g.supplierId) {
        const party = await loadParty(deps.db, actor.tenantId, g.supplierId);
        if (party) {
          supplierName = party.name;
          supplierSnap = {
            name: party.name,
            contactPerson: party.contactPerson,
            mobile: party.mobile,
            email: party.email,
            gstin: party.gstin,
            address: party.address,
            city: party.city,
            state: party.state,
            stateCode: party.stateCode,
          };
        } else if (!supplierName) {
          supplierName = "Supplier TBD";
        }
      }
      const businessSnap = {
        name: settings.businessName,
        gstin: settings.gstin,
        address: settings.address,
        state: settings.state,
        stateCode: settings.stateCode,
        phone: settings.phone,
        email: settings.email,
      };
      const intraState = isIntraStateSupply(
        { state: settings.state, stateCode: settings.stateCode },
        { state: (supplierSnap.state as string | null | undefined) ?? null, stateCode: (supplierSnap.stateCode as string | null | undefined) ?? null },
      );
      const totals = computeTotals(
        g.lines.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          sku: l.sku,
          hsn: l.hsn,
          unit: l.unit,
          qty: l.qty,
          rate: l.rate,
          discountPct: 0,
          gstRate: l.gstRate,
          receivedQty: 0,
        })),
        intraState,
      );
      const poLines = totals.lines.map((l) => ({ ...l, receivedQty: l.receivedQty ?? 0 }));
      const poId = randomUUID();
      const poNo = await nextDocNo(deps.db, actor.tenantId, "po", settings.poPrefix, orderDate, settings.fiscalYearStart);
      await exec(
        deps.db,
        `INSERT INTO ims_purchase_orders
           (id, tenant_id, po_no, status, supplier_id, supplier_name, supplier_snapshot, business_snapshot, order_date, expected_date, delivery_address,
            payment_terms_days, intra_state, \`lines\`, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, terms, notes, approval_note,
            submitted_at, decided_at, sent_at, sent_via, created_by, created_by_name, bom_doc_id)
         VALUES
           (:id, :tenantId, :poNo, 'draft', :supplierId, :supplierName, :supplierSnapshot, :businessSnapshot, :orderDate, NULL, :deliveryAddress,
            :paymentTermsDays, :intraState, :lines, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal, :terms, :notes, NULL,
            NULL, NULL, NULL, NULL, :userId, :userName, :bomDocId)`,
        {
          id: poId,
          tenantId: actor.tenantId,
          poNo,
          supplierId: g.supplierId,
          supplierName: supplierName || "Supplier TBD",
          supplierSnapshot: JSON.stringify(supplierSnap),
          businessSnapshot: JSON.stringify(businessSnap),
          orderDate,
          deliveryAddress: settings.address || null,
          paymentTermsDays: settings.paymentTermsDays,
          intraState: intraState ? 1 : 0,
          lines: JSON.stringify(poLines),
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          grandTotal: totals.grandTotal,
          terms: settings.terms,
          notes: `Created from BOM ${doc.docNo} shortfall`,
          userId: actor.userId,
          userName: actorName(actor),
          bomDocId: id,
        },
      );
      await recordEvent(deps, actor, {
        type: "po.created",
        entityType: "po",
        entityId: poId,
        summary: `Drafted ${poNo} from BOM ${doc.docNo} · ${formatINR(totals.grandTotal)}`,
        payload: { status: "draft", grandTotal: totals.grandTotal, bomDocId: id },
      });
      orders.push({
        id: poId,
        poNo,
        status: "draft",
        supplierId: g.supplierId,
        supplierName: supplierName || "Supplier TBD",
        bomDocId: id,
        lineCount: poLines.length,
        grandTotal: totals.grandTotal,
        lines: poLines,
      });
    }

    await recordEvent(deps, actor, {
      type: "bom.doc.pos_created",
      entityType: "bom_doc",
      entityId: id,
      summary: `Created ${orders.length} draft PO(s) from ${doc.docNo} shortfall`,
      payload: { orderIds: orders.map((o) => o.id), count: orders.length },
    });
    res.status(201).json({ orders });
  });

  /* ---------- Shared helpers for alternates / issue ---------- */

  type ItemStockRow = {
    id: string;
    name: string;
    sku: string | null;
    unit: string;
    selling_price: string;
    current_stock: string;
    active: number;
  };

  async function loadItemStock(db: Queryable, tenantId: number, ids: ReadonlyArray<string>) {
    const out = new Map<string, ItemStockRow>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;
    const params: Record<string, unknown> = { tenantId };
    const inList = unique.map((id, i) => {
      params[`i${i}`] = id;
      return `:i${i}`;
    });
    const list = await rows<ItemStockRow>(
      db,
      `SELECT id, name, sku, unit, selling_price, current_stock, active
       FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
      params,
    );
    for (const r of list) out.set(r.id, r);
    return out;
  }

  /** Same explode-invoice guards as the full issue-stock route. */
  async function assertNoExplodeInvoiceStock(
    db: Queryable,
    tenantId: number,
    invoiceId: string | null | undefined,
    convertMode: string | null | undefined,
  ) {
    if (!invoiceId || convertMode !== "explode_lines") return;
    const inv = await one<{ stock_posted: number; status: string }>(
      db,
      `SELECT stock_posted, status FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
      { tenantId, id: invoiceId },
    );
    if (inv && inv.status === "draft") {
      throw conflict("A draft explode invoice is linked. Issue or delete that draft before issuing stock from the BOM.");
    }
    if (inv && inv.status === "issued" && inv.stock_posted) {
      throw conflict("Stock was already posted when the linked explode invoice was issued");
    }
  }

  /* ---------- Alternates (#38) ---------- */

  router.post("/bom/docs/:id/suggest-alternates", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    const lines = doc.lines ?? [];
    const ids = new Set<string>();
    for (const l of lines) {
      if (l.lineKind !== "stock" || !l.itemId) continue;
      ids.add(l.itemId);
      for (const a of l.alternateItemIds ?? []) ids.add(a);
    }
    const items = await loadItemStock(deps.db, actor.tenantId, [...ids]);
    // Inactive items never count as available stock.
    const stock = new Map<string, number>();
    for (const [id, it] of items) stock.set(id, it.active ? round3(money(it.current_stock)) : 0);
    const raw = suggestAlternatesForShortfall(
      lines.map((l) => ({
        id: l.id,
        lineKind: l.lineKind,
        itemId: l.itemId,
        description: l.description,
        qty: l.qty,
        issuedQty: l.issuedQty ?? 0,
        alternateItemIds: l.alternateItemIds ?? [],
      })),
      stock,
    );
    const describe = (itemId: string | null) => {
      const it = itemId ? items.get(itemId) : null;
      return it
        ? { id: it.id, name: it.name, sku: it.sku, unit: it.unit, sellingPrice: round2(money(it.selling_price)), currentStock: round3(money(it.current_stock)), active: Boolean(it.active) }
        : null;
    };
    res.json({
      suggestions: raw.map((s) => ({
        ...s,
        suggested: describe(s.suggestedItemId),
        candidates: s.candidates.map((c) => ({ ...c, item: describe(c.itemId) })),
      })),
      count: raw.length,
    });
  });

  router.post("/bom/docs/:id/swap-alternate", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ lineId: z.string().uuid(), itemId: z.string().uuid() }), req.body);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");

    const assertSwappable = (status: string, stockIssuedAt: string | null | undefined, issueCount: number | undefined) => {
      if (status === "draft") return;
      if (status === "confirmed" && !stockIssuedAt && !(Number(issueCount) > 0)) return;
      throw conflict("Alternates can only be swapped on a draft BOM, or a confirmed BOM with no stock issued");
    };
    assertSwappable(doc.status, doc.stockIssuedAt, doc.stockIssueCount);

    const line = (doc.lines ?? []).find((l) => l.id === body.lineId);
    if (!line) throw notFound("BOM line not found");
    if (line.lineKind !== "stock") throw conflict("Only stock lines can be swapped to an alternate item");
    if ((line.issuedQty ?? 0) > 0) throw conflict("Stock was already issued against this line");
    if (line.itemId === body.itemId) throw conflict("This line already uses that item");
    if (!(line.alternateItemIds ?? []).includes(body.itemId)) throw badRequest("That item is not a listed alternate for this line");

    const item = (await loadItemStock(deps.db, actor.tenantId, [body.itemId])).get(body.itemId);
    if (!item) throw notFound("Alternate item not found in the catalogue");
    if (!item.active) throw conflict("That alternate item is inactive");

    const nextAlternates = rotateAlternates(line.alternateItemIds ?? [], line.itemId, body.itemId);
    await tx(deps.db, async (conn) => {
      const locked = await one<{
        status: string;
        stock_issued_at: string | null;
        stock_issue_count: number;
        invoice_id: string | null;
        invoice_convert_mode: string | null;
      }>(
        conn,
        `SELECT status, stock_issued_at, stock_issue_count, invoice_id, invoice_convert_mode
         FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked) throw notFound("BOM document not found");
      assertSwappable(locked.status, locked.stock_issued_at, locked.stock_issue_count);
      if (locked.invoice_id && locked.invoice_convert_mode === "explode_lines") {
        throw conflict("An explode invoice is linked to this BOM. Swap alternates before creating the invoice.");
      }
      const updated = await exec(
        conn,
        `UPDATE ims_bom_doc_lines
         SET item_id = :itemId, description = :description, alternate_item_ids_json = CAST(:alternates AS JSON)
         WHERE tenant_id = :tenantId AND doc_id = :docId AND id = :lineId
           AND item_id <=> :oldItemId AND issued_qty = 0`,
        {
          tenantId: actor.tenantId,
          docId: id,
          lineId: line.id,
          itemId: body.itemId,
          oldItemId: line.itemId,
          description: item.name,
          alternates: JSON.stringify(nextAlternates),
        },
      );
      if (!updated.affectedRows) throw conflict("This line changed — reload and try again");
    });
    await recordEvent(deps, actor, {
      type: "bom.doc.alternate_swapped",
      entityType: "bom_doc",
      entityId: id,
      summary: `Swapped "${line.description}" → "${item.name}" on ${doc.docNo}`,
      payload: { lineId: line.id, fromItemId: line.itemId, toItemId: body.itemId },
    });
    res.json({ doc: await loaders.loadDoc(deps.db, actor.tenantId, id) });
  });

  /* ---------- Nested packages (#41) + options (#42) ---------- */

  const optionsBody = z.union([z.record(z.string().trim().min(1).max(64), z.boolean()), z.array(z.string().trim().min(1).max(64)).max(200)]);
  const numericVars = (v: Record<string, unknown> | null | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v ?? {})) {
      const n = typeof val === "number" ? val : typeof val === "string" && val.trim() ? Number(val) : NaN;
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  };

  router.post("/bom/packages/:id/explode", async (req, res) => {
    requireAnyPerm(res, ["bom", "bomPackages"]);
    const actor = actorOf(res);
    const packageId = String(req.params.id);
    const body = parse(
      z.object({
        docId: z.string().uuid().optional(),
        capacityLabel: optText(120),
        options: optionsBody.optional(),
        variables: z.record(z.string(), z.coerce.number()).optional(),
        depthLimit: z.coerce.number().int().min(0).max(20).optional(),
      }),
      req.body ?? {},
    );
    const pkg = await loaders.loadPackage(deps.db, actor.tenantId, packageId);
    if (!pkg) throw notFound("Package not found");
    const doc = body.docId ? await loaders.loadDoc(deps.db, actor.tenantId, body.docId) : null;
    if (body.docId && !doc) throw notFound("BOM document not found");

    const capacityLabel = body.capacityLabel ?? doc?.capacityLabel ?? pkg.capacityLabel ?? null;
    const selectedOptions = selectedOptionKeys(body.options !== undefined ? body.options : (doc?.options ?? pkg.options));
    const variables = { ...numericVars(pkg.variables), ...numericVars(doc?.variables), ...(body.variables ?? {}) };

    const cache = new Map<string, BomEnhancePackage | null>();
    const getLines = async (pid: string) => {
      if (!cache.has(pid)) cache.set(pid, await loaders.loadPackage(deps.db, actor.tenantId, pid));
      return cache.get(pid)?.lines ?? null;
    };
    try {
      const lines = await explodeNestedPackageLines(getLines, packageId, {
        capacityLabel,
        selectedOptions,
        variables,
        depthLimit: body.depthLimit,
      });
      res.json({ packageId, capacityLabel, selectedOptions, variables, lines, count: lines.length });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : "Could not explode package");
    }
  });

  router.post("/bom/docs/:id/set-options", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ options: optionsBody }), req.body);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "draft") throw conflict("Options can only be changed on a draft BOM");
    const options = normalizeOptionSelection(body.options);
    const updated = await exec(
      deps.db,
      `UPDATE ims_bom_docs SET options_json = CAST(:options AS JSON)
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { tenantId: actor.tenantId, id, options: JSON.stringify(options) },
    );
    if (!updated.affectedRows) throw conflict("BOM changed — reload and try again");
    await recordEvent(deps, actor, {
      type: "bom.doc.options_set",
      entityType: "bom_doc",
      entityId: id,
      summary: `Updated option selection on ${doc.docNo}`,
      payload: { options },
    });
    const selected = selectedOptionKeys(options);
    res.json({
      options,
      selectedOptions: selected,
      // Lines are not deleted; this just shows which optional lines the selection would include on the next explode.
      optionalLines: (doc.lines ?? [])
        .filter((l) => l.optionalFlag)
        .map((l) => ({ id: l.id, description: l.description, optionKey: l.optionKey ?? null, included: lineIncludedByOptions(true, l.optionKey, selected) })),
      doc: await loaders.loadDoc(deps.db, actor.tenantId, id),
    });
  });

  /* ---------- Partial issue + serial notes (#44 #45) ---------- */

  router.post("/bom/docs/:id/issue-stock-partial", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "stockOut");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(
      z.object({
        lines: z
          .array(
            z.object({
              lineId: z.string().uuid(),
              qty: z.coerce.number().gt(0).max(1e9),
              serialNotes: optText(SERIAL_NOTES_MAX),
            }),
          )
          .min(1, "Select at least one line")
          .max(500),
        date: isoDate.optional(),
      }),
      req.body,
    );
    if (new Set(body.lines.map((l) => l.lineId)).size !== body.lines.length) {
      throw badRequest("Each line may only appear once per partial issue");
    }
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before issuing stock");
    await assertNoExplodeInvoiceStock(deps.db, actor.tenantId, doc.invoiceId, doc.invoiceConvertMode);

    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();
    const notesByLine = new Map(body.lines.map((l) => [l.lineId, l.serialNotes ?? null]));

    const result = await tx(deps.db, async (conn) => {
      const locked = await one<{
        stock_issued_at: string | null;
        status: string;
        invoice_id: string | null;
        invoice_convert_mode: string | null;
      }>(
        conn,
        `SELECT stock_issued_at, status, invoice_id, invoice_convert_mode FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked) throw notFound("BOM document not found");
      if (locked.status !== "confirmed") throw conflict("Confirm the BOM before issuing stock");
      await assertNoExplodeInvoiceStock(conn, actor.tenantId, locked.invoice_id, locked.invoice_convert_mode);

      // Re-read lines under the doc lock so issued_qty is current.
      const fresh = await loaders.loadDoc(conn, actor.tenantId, id);
      const allLines = fresh?.lines ?? [];
      const stockLines = allLines.filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0);
      if (!stockLines.length) throw conflict("No stock-linked lines to issue. Link catalogue items on stock lines first.");
      if (isLegacyFullIssue(locked.stock_issued_at, stockLines)) throw conflict("Stock was already issued in full for this BOM");

      const byId = new Map(stockLines.map((l) => [l.id, l]));
      for (const r of body.lines) {
        if (!byId.has(r.lineId)) throw badRequest("Only stock lines linked to a catalogue item can be issued");
      }
      const plan = applyPartialIssue(
        stockLines.map((l) => ({ id: l.id, qty: l.qty, issuedQty: l.issuedQty ?? 0 })),
        body.lines.map((l) => ({ lineId: l.lineId, qty: l.qty })),
      );
      if (!plan.length) throw conflict("Nothing left to issue for the selected lines");

      const movements = [];
      for (const p of plan) {
        const line = byId.get(p.lineId)!;
        const mergedNotes = mergeSerialNotes(line.serialNotes, notesByLine.get(p.lineId));
        if (mergedNotes && mergedNotes.length > SERIAL_NOTES_MAX) {
          throw badRequest(`Serial notes for "${line.description}" exceed ${SERIAL_NOTES_MAX} characters`);
        }
        const movementNotes = notesByLine.get(p.lineId)
          ? `Serial: ${notesByLine.get(p.lineId)}`.slice(0, 500)
          : doc.title || doc.capacityLabel || null;
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId!,
              type: "OUT",
              qty: p.qty,
              refType: "bom",
              refId: doc.id,
              refNo: doc.docNo,
              partyId: doc.partyId ?? null,
              partyName: doc.customerName,
              reason: "BOM materials partial issue",
              notes: movementNotes,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
        await exec(
          conn,
          `UPDATE ims_bom_doc_lines SET issued_qty = :issuedQty, serial_notes = :serialNotes
           WHERE tenant_id = :tenantId AND doc_id = :docId AND id = :lineId`,
          { tenantId: actor.tenantId, docId: id, lineId: p.lineId, issuedQty: p.nextIssuedQty, serialNotes: mergedNotes },
        );
      }
      await exec(
        conn,
        `UPDATE ims_bom_docs
         SET stock_issued_at = COALESCE(stock_issued_at, CURRENT_TIMESTAMP), stock_issue_count = stock_issue_count + :n
         WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id, n: movements.length },
      );
      const remaining = stockLines.map((l) => {
        const p = plan.find((x) => x.lineId === l.id);
        return remainingIssueQty(l.qty, p ? p.nextIssuedQty : (l.issuedQty ?? 0));
      });
      return { movements, plan, fullyIssued: remaining.every((r) => !(r > 0)) };
    });

    await recordEvent(deps, actor, {
      type: "bom.doc.stock_issued_partial",
      entityType: "bom_doc",
      entityId: id,
      summary: `Partially issued stock for BOM ${doc.docNo} (${result.movements.length} line${result.movements.length === 1 ? "" : "s"})`,
      payload: { count: result.movements.length, lines: result.plan, fullyIssued: result.fullyIssued },
    });
    res.json({
      doc: await loaders.loadDoc(deps.db, actor.tenantId, id),
      movements: result.movements,
      issued: result.plan,
      fullyIssued: result.fullyIssued,
    });
  });

  router.get("/bom/docs/:id/pick-list", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before printing a pick list");
    const stockLines = (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.qty > 0);
    const items = await loadItemStock(
      deps.db,
      actor.tenantId,
      stockLines.map((l) => l.itemId).filter(Boolean) as string[],
    );
    const lines = stockLines
      .map((l) => {
        const issuedQty = l.issuedQty ?? 0;
        const item = l.itemId ? items.get(l.itemId) : null;
        return {
          lineId: l.id,
          section: l.section,
          sortNo: l.sortNo,
          itemId: l.itemId,
          sku: item?.sku ?? l.itemSku ?? null,
          description: l.description,
          unit: l.unit,
          qty: l.qty,
          issuedQty,
          remainingQty: remainingIssueQty(l.qty, issuedQty),
          onHand: item ? round3(money(item.current_stock)) : null,
          serialNotes: l.serialNotes ?? null,
          linked: Boolean(l.itemId),
        };
      })
      .filter((l) => l.remainingQty > 0);
    res.json({
      docId: doc.id,
      docNo: doc.docNo,
      customerName: doc.customerName,
      capacityLabel: doc.capacityLabel,
      generatedAt: new Date().toISOString(),
      lines,
      count: lines.length,
    });
  });
}
