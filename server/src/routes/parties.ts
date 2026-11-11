import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { getActiveProfileId, getActiveUserId } from "../lib/request-context.js";
import { requireWriteAccess } from "../middleware/require-write.js";
import {
  listRegistryParties,
  loadRegistryParty,
  partyToCustomerSnapshot,
  suggestRegistryParties,
  upsertRegistryParty,
} from "../parties/index.js";

const router = Router();

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  void requireWriteAccess(req, res, next);
});

const SuggestQuery = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(["customer", "supplier", "both"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Cross-tool party book for the active business profile (SSOT = jbt_parties). */
router.get("/", async (req, res) => {
  const tenantId = getActiveProfileId();
  if (!tenantId) {
    res.status(400).json({ error: "Select a business profile first" });
    return;
  }
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const parties = await listRegistryParties(pool, tenantId, {
    kind: kind === "customer" || kind === "supplier" || kind === "both" ? kind : null,
    q,
    includeInactive: req.query.includeInactive === "1",
    limit: 5000,
  });
  res.json({ parties });
});

router.get("/suggest", async (req, res) => {
  const tenantId = getActiveProfileId();
  if (!tenantId) {
    res.status(400).json({ error: "Select a business profile first" });
    return;
  }
  const parsed = SuggestQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid suggest query" });
    return;
  }
  const q = parsed.data.q ?? "";
  const kind = parsed.data.kind === "supplier" ? "supplier" : "customer";
  const parties = await suggestRegistryParties(pool, tenantId, q, { kind, limit: parsed.data.limit ?? 12 });
  res.json({
    suggestions: parties.map((p) => ({
      id: p.id,
      key: p.id,
      ...partyToCustomerSnapshot(p),
      kind: p.kind,
      contactPerson: p.contactPerson,
    })),
  });
});

router.get("/:id", async (req, res) => {
  const tenantId = getActiveProfileId();
  if (!tenantId) {
    res.status(400).json({ error: "Select a business profile first" });
    return;
  }
  const party = await loadRegistryParty(pool, tenantId, req.params.id);
  if (!party) {
    res.status(404).json({ error: "Party not found" });
    return;
  }
  res.json({ party });
});

const UpsertBody = z.object({
  kind: z.enum(["customer", "supplier", "both", "vendor"]).optional(),
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).nullable().optional(),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  mobile: z.string().trim().max(40).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(180).nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  sourceTool: z.string().trim().max(40).nullable().optional(),
  sourceRef: z.string().trim().max(64).nullable().optional(),
});

router.post("/upsert", async (req, res) => {
  const tenantId = getActiveProfileId();
  if (!tenantId) {
    res.status(400).json({ error: "Select a business profile first" });
    return;
  }
  const parsed = UpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid party" });
    return;
  }
  const body = parsed.data;
  const result = await upsertRegistryParty(pool, tenantId, {
    ...body,
    kind: body.kind ?? "customer",
    mobile: body.mobile ?? body.phone,
    createdBy: getActiveUserId(),
    sourceTool: body.sourceTool ?? "parties",
    sourceRef: body.sourceRef ?? null,
  });
  res.status(result.created ? 201 : 200).json({
    party: result.party,
    created: result.created,
    customer: partyToCustomerSnapshot(result.party),
  });
});

export default router;
