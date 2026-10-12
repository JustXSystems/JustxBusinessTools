/**
 * Where Onsite Track draws its maps. Stored as the `map` row of ims_integrations (no schema change).
 * - builtin (default): the app draws positions itself; the browser contacts no map server.
 * - tiles: raster tiles from a URL template — the public OpenStreetMap servers (light use only), a provider
 *   such as Mappls / Ola Maps / MapTiler with a browser key, or the business's own tile server.
 * - pmtiles: one self-hosted Protomaps .pmtiles file, drawn in the browser.
 */
import type { Router } from "express";
import { z } from "zod";
import { actorOf, parse, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, json, one, tsOf, type Queryable } from "./db.js";

export const MAP_SOURCES = ["builtin", "tiles", "pmtiles"] as const;
export type MapSource = (typeof MAP_SOURCES)[number];
export const MAP_FLAVORS = ["light", "white", "grayscale", "dark", "black"] as const;

export type MapSettings = {
  source: MapSource;
  tileUrl: string | null;
  pmtilesUrl: string | null;
  attribution: string | null;
  maxZoom: number;
  flavor: (typeof MAP_FLAVORS)[number];
  updatedAt: string | null;
};

export const DEFAULT_MAP: MapSettings = { source: "builtin", tileUrl: null, pmtilesUrl: null, attribution: null, maxZoom: 19, flavor: "light", updatedAt: null };

/** https:// or a path on this site; no spaces, quotes or angle brackets. */
const SAFE_URL = /^(https:\/\/[^\s"'<>\\]+|\/[^\s"'<>\\]*)$/;
const url = z.string().trim().max(500).regex(SAFE_URL, "Use an https:// address or a path on this site starting with /");

export const MapInput = z
  .object({
    source: z.enum(MAP_SOURCES),
    tileUrl: url.nullable().optional(),
    pmtilesUrl: url.nullable().optional(),
    attribution: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^<>]*$/, "Plain text only")
      .nullable()
      .optional(),
    maxZoom: z.coerce.number().int().min(1).max(22).default(19),
    flavor: z.enum(MAP_FLAVORS).default("light"),
  })
  .superRefine((v, ctx) => {
    if (v.source === "tiles" && !(v.tileUrl && /\{z\}/.test(v.tileUrl) && /\{x\}/.test(v.tileUrl) && /\{-?y\}/.test(v.tileUrl)))
      ctx.addIssue({ code: "custom", path: ["tileUrl"], message: "The tile address needs {z}, {x} and {y}" });
    if (v.source === "pmtiles" && !(v.pmtilesUrl && /\.pmtiles(\?|$)/i.test(v.pmtilesUrl)))
      ctx.addIssue({ code: "custom", path: ["pmtilesUrl"], message: "Point to a .pmtiles file" });
    if (v.source !== "builtin" && !v.attribution) ctx.addIssue({ code: "custom", path: ["attribution"], message: "Map data credit is required by the map's licence" });
  });

/** Stored config → settings, falling back to the built-in map when anything is missing or invalid. */
export function mapSettingsOf(row: { enabled: number; config: unknown; updated_at?: string | null } | null): MapSettings {
  if (!row) return DEFAULT_MAP;
  const parsed = MapInput.safeParse(json<Record<string, unknown>>(row.config, {}));
  if (!parsed.success) return { ...DEFAULT_MAP, updatedAt: tsOf(row.updated_at ?? null) };
  const v = parsed.data;
  return {
    source: row.enabled ? v.source : "builtin",
    tileUrl: v.tileUrl ?? null,
    pmtilesUrl: v.pmtilesUrl ?? null,
    attribution: v.attribution ?? null,
    maxZoom: v.maxZoom,
    flavor: v.flavor,
    updatedAt: tsOf(row.updated_at ?? null),
  };
}

export async function loadMapSettings(db: Queryable, tenantId: number): Promise<MapSettings> {
  return mapSettingsOf(await one<{ enabled: number; config: unknown; updated_at: string | null }>(db, `SELECT enabled, config, updated_at FROM ims_integrations WHERE tenant_id = :tenantId AND provider = 'map'`, { tenantId }));
}

export function registerFieldMap(router: Router, deps: ImsDeps): void {
  router.get("/settings/map", async (_req, res) => {
    res.json({ map: await loadMapSettings(deps.db, actorOf(res).tenantId) });
  });

  router.put("/settings/map", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "settings");
    const input = parse(MapInput, req.body);
    await exec(
      deps.db,
      `INSERT INTO ims_integrations (tenant_id, provider, enabled, config, updated_by) VALUES (:tenantId, 'map', :enabled, :config, :userId)
       ON DUPLICATE KEY UPDATE enabled = :enabled, config = :config, updated_by = :userId`,
      { tenantId: actor.tenantId, enabled: input.source === "builtin" ? 0 : 1, config: JSON.stringify(input), userId: actor.userId },
    );
    await recordEvent(deps, actor, {
      type: "settings.updated",
      entityType: "settings",
      entityId: String(actor.tenantId),
      summary: input.source === "builtin" ? "Field map set to the built-in map" : `Field map set to ${input.source === "pmtiles" ? "self-hosted PMTiles" : "a tile server"}`,
      payload: { fields: ["map"], source: input.source },
    });
    res.json({ map: await loadMapSettings(deps.db, actor.tenantId) });
  });
}
