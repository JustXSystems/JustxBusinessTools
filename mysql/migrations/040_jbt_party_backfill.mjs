/**
 * Backfill Justx Party Registry from IMS, BOS, and Quotation V1, then make
 * `ims_parties` an updatable view over `jbt_parties` so existing IMS SQL keeps working.
 *
 * Matching order: GSTIN → phone (last 10) → exact name (case-insensitive).
 * IMS party UUIDs are preserved (canonical UI / most FKs).
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 */
export default async function migrate(conn) {
  function q(sql, values = []) {
    return conn.query({ sql, values, namedPlaceholders: false });
  }

  const phoneKey = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);
  const normName = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const clip = (v, n) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, n) : null;
  };
  const bosKindToRegistry = (k) => {
    const s = String(k ?? "customer").toLowerCase();
    if (s === "vendor" || s === "supplier") return "supplier";
    if (s === "both") return "both";
    return "customer";
  };
  const mergeKind = (a, b) => {
    if (!a) return b;
    if (!b || a === b || a === "both") return a;
    if (b === "both") return "both";
    return "both";
  };

  const [[hasIms]] = await q(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_parties' AND TABLE_TYPE = 'BASE TABLE'`,
  );
  const [[hasRegistry]] = await q(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jbt_parties'`,
  );
  if (!Number(hasRegistry?.n)) throw new Error("jbt_parties missing — apply 039 first");

  // 1) Seed from IMS (preserve UUIDs).
  if (Number(hasIms?.n)) {
    await q(
      `INSERT IGNORE INTO jbt_parties (
         id, tenant_id, kind, name, company, contact_person, mobile, email, gstin, pan,
         address, city, state, state_code, payment_terms_days, credit_limit, opening_balance,
         account_manager_id, account_manager_name, tags, notes, active, created_by, created_at, updated_at
       )
       SELECT
         id, tenant_id, kind, name, NULL, contact_person, mobile, email, gstin, pan,
         address, city, state, state_code, payment_terms_days, credit_limit, opening_balance,
         account_manager_id, account_manager_name, tags, notes, active, created_by, created_at, updated_at
       FROM ims_parties`,
    );
    await q(
      `INSERT IGNORE INTO jbt_party_origins (tenant_id, party_id, source_tool, source_ref)
       SELECT tenant_id, id, 'ims', id FROM ims_parties`,
    );
  }

  /** @type {Map<string, { id: string; kind: string; name: string; mobile: string | null; gstin: string | null }[]>} */
  const byTenant = new Map();
  const loadTenant = async (tenantId) => {
    if (byTenant.has(tenantId)) return byTenant.get(tenantId);
    const [rows] = await q(
      `SELECT id, kind, name, mobile, gstin FROM jbt_parties WHERE tenant_id = ? AND active = 1`,
      [tenantId],
    );
    byTenant.set(tenantId, /** @type {any[]} */ (rows));
    return byTenant.get(tenantId);
  };

  const findMatch = (list, probe) => {
    const gstin = clip(probe.gstin, 20)?.toUpperCase() ?? null;
    if (gstin) {
      const hit = list.find((r) => String(r.gstin || "").toUpperCase() === gstin);
      if (hit) return hit;
    }
    const phone = phoneKey(probe.mobile ?? probe.phone);
    const name = normName(probe.name);
    if (phone.length >= 10) {
      const hit = list.find((r) => phoneKey(r.mobile) === phone);
      if (hit) return hit;
    }
    if (name) {
      const same = list.filter((r) => normName(r.name) === name);
      if (phone.length >= 8) {
        const withPhone = same.find((r) => !phoneKey(r.mobile) || phoneKey(r.mobile) === phone);
        if (withPhone) return withPhone;
      }
      if (same.length === 1) return same[0];
    }
    return null;
  };

  const uuid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

  const upsertOrigin = async (tenantId, partyId, sourceTool, sourceRef) => {
    await q(
      `INSERT IGNORE INTO jbt_party_origins (tenant_id, party_id, source_tool, source_ref)
       VALUES (?, ?, ?, ?)`,
      [tenantId, partyId, sourceTool, String(sourceRef).slice(0, 64)],
    );
  };

  const enrichParty = async (partyId, tenantId, patch) => {
    await q(
      `UPDATE jbt_parties SET
         kind = ?,
         company = COALESCE(NULLIF(company, ''), ?),
         contact_person = COALESCE(NULLIF(contact_person, ''), ?),
         mobile = COALESCE(NULLIF(mobile, ''), ?),
         email = COALESCE(NULLIF(email, ''), ?),
         gstin = COALESCE(NULLIF(gstin, ''), ?),
         address = COALESCE(NULLIF(address, ''), ?),
         city = COALESCE(NULLIF(city, ''), ?),
         state = COALESCE(NULLIF(state, ''), ?),
         notes = COALESCE(NULLIF(notes, ''), ?),
         active = 1
       WHERE tenant_id = ? AND id = ?`,
      [
        patch.kind,
        patch.company,
        patch.contactPerson,
        patch.mobile,
        patch.email,
        patch.gstin,
        patch.address,
        patch.city,
        patch.state,
        patch.notes,
        tenantId,
        partyId,
      ],
    );
  };

  const insertParty = async (tenantId, row) => {
    const id = row.id && String(row.id).length === 36 ? row.id : uuid();
    await q(
      `INSERT INTO jbt_parties (
         id, tenant_id, kind, name, company, contact_person, mobile, email, gstin,
         address, city, state, notes, active, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        tenantId,
        row.kind,
        row.name,
        row.company,
        row.contactPerson,
        row.mobile,
        row.email,
        row.gstin,
        row.address,
        row.city,
        row.state,
        row.notes,
        row.createdBy ?? null,
      ],
    );
    const list = await loadTenant(tenantId);
    list.push({ id, kind: row.kind, name: row.name, mobile: row.mobile, gstin: row.gstin });
    return id;
  };

  // 2) Merge BOS parties → registry; remap BOS document FKs to registry ids.
  const [[hasBos]] = await q(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bos_parties'`,
  );
  if (Number(hasBos?.n)) {
    const [bosRows] = await q(
      `SELECT id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, source_tool, source_ref, created_by, archived_at
       FROM bos_parties`,
    );
    /** @type {Map<string, string>} oldBosId → registryId */
    const remap = new Map();

    for (const b of /** @type {any[]} */ (bosRows)) {
      const tenantId = Number(b.tenant_id);
      const list = await loadTenant(tenantId);
      const kind = bosKindToRegistry(b.kind);
      const probe = {
        name: b.name,
        mobile: b.phone,
        phone: b.phone,
        gstin: b.gstin,
      };
      let partyId;
      const match = findMatch(list, probe);
      if (match) {
        partyId = match.id;
        match.kind = mergeKind(match.kind, kind);
        await enrichParty(partyId, tenantId, {
          kind: match.kind,
          company: clip(b.company, 200),
          contactPerson: null,
          mobile: clip(b.phone, 40),
          email: clip(b.email, 180),
          gstin: clip(b.gstin, 20)?.toUpperCase() ?? null,
          address: clip(b.address, 500),
          city: clip(b.city, 120),
          state: clip(b.state, 80),
          notes: clip(b.notes, 4000),
        });
        if (b.archived_at) {
          // Keep registry active if IMS already has it; only archive if this was the sole source later.
        }
      } else {
        partyId = await insertParty(tenantId, {
          id: b.id,
          kind,
          name: clip(b.name, 200) || "Party",
          company: clip(b.company, 200),
          contactPerson: null,
          mobile: clip(b.phone, 40),
          email: clip(b.email, 180),
          gstin: clip(b.gstin, 20)?.toUpperCase() ?? null,
          address: clip(b.address, 500),
          city: clip(b.city, 120),
          state: clip(b.state, 80),
          notes: clip(b.notes, 4000),
          createdBy: b.created_by,
        });
        if (b.archived_at) {
          await q(`UPDATE jbt_parties SET active = 0 WHERE tenant_id = ? AND id = ?`, [tenantId, partyId]);
        }
      }
      remap.set(String(b.id), partyId);
      await upsertOrigin(tenantId, partyId, "bos", b.id);
      if (b.source_tool && b.source_ref) {
        await upsertOrigin(tenantId, partyId, String(b.source_tool), String(b.source_ref));
      }
    }

    // Remap BOS FKs when the bos id collapsed into a different registry id.
    for (const [oldId, newId] of remap) {
      if (oldId === newId) continue;
      await q(`UPDATE bos_invoices SET party_id = ? WHERE party_id = ?`, [newId, oldId]);
      await q(`UPDATE bos_bills SET party_id = ? WHERE party_id = ?`, [newId, oldId]);
      await q(`UPDATE bos_projects SET party_id = ? WHERE party_id = ?`, [newId, oldId]);
      await q(
        `UPDATE bos_links SET target_id = ? WHERE target_type = 'party' AND target_id = ?`,
        [newId, oldId],
      );
    }

    // Rebuild bos_parties as a projection of the registry (same UUID) for connectors / liftability.
    await q(`DELETE FROM bos_parties`);
    await q(
      `INSERT INTO bos_parties (
         id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, created_by, archived_at, created_at, updated_at
       )
       SELECT
         id, tenant_id,
         CASE WHEN kind = 'supplier' THEN 'vendor' ELSE kind END,
         name, company, gstin, email, mobile, address, city, state, notes, created_by,
         IF(active = 1, NULL, CURRENT_TIMESTAMP),
         created_at, updated_at
       FROM jbt_parties`,
    );
  }

  // 3) Extract unique Quotation V1 customers into the registry.
  const [[hasDocs]] = await q(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_records'`,
  );
  if (Number(hasDocs?.n)) {
    const [docs] = await q(
      `SELECT id, business_profile_id AS tenant_id, data, updated_at, created_at
       FROM document_records
       WHERE tool_id = 'quotationv1'
       ORDER BY COALESCE(updated_at, created_at) DESC`,
    );

    for (const doc of /** @type {any[]} */ (docs)) {
      let data = doc.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          continue;
        }
      }
      const c = data?.customer;
      if (!c || typeof c !== "object") continue;
      const name = clip(c.name, 200);
      if (!name) continue;
      const tenantId = Number(doc.tenant_id);
      if (!tenantId) continue;
      const list = await loadTenant(tenantId);
      const probe = { name, mobile: c.phone, phone: c.phone, gstin: c.gstin };
      const match = findMatch(list, probe);
      let partyId;
      if (match) {
        partyId = match.id;
        match.kind = mergeKind(match.kind, "customer");
        await enrichParty(partyId, tenantId, {
          kind: match.kind,
          company: clip(c.company, 200),
          contactPerson: null,
          mobile: clip(c.phone, 40),
          email: clip(c.email, 180),
          gstin: clip(c.gstin, 20)?.toUpperCase() ?? null,
          address: clip(c.address, 500),
          city: clip(c.city, 120),
          state: clip(c.state, 80),
          notes: null,
        });
      } else {
        partyId = await insertParty(tenantId, {
          kind: "customer",
          name,
          company: clip(c.company, 200),
          contactPerson: null,
          mobile: clip(c.phone, 40),
          email: clip(c.email, 180),
          gstin: clip(c.gstin, 20)?.toUpperCase() ?? null,
          address: clip(c.address, 500),
          city: clip(c.city, 120),
          state: clip(c.state, 80),
          notes: null,
        });
      }
      await upsertOrigin(tenantId, partyId, "quotationv1", doc.id);

      // Stamp partyId onto the quote JSON when missing (document snapshot stays authoritative on the quote).
      if (!data.partyId) {
        data.partyId = partyId;
        await q(`UPDATE document_records SET data = CAST(? AS JSON) WHERE id = ?`, [
          JSON.stringify(data),
          doc.id,
        ]);
      }
    }

    // Keep BOS projection in sync after quotation merge.
    if (Number(hasBos?.n)) {
      await q(
        `INSERT INTO bos_parties (
           id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, created_by, archived_at, created_at, updated_at
         )
         SELECT
           j.id, j.tenant_id,
           CASE WHEN j.kind = 'supplier' THEN 'vendor' ELSE j.kind END,
           j.name, j.company, j.gstin, j.email, j.mobile, j.address, j.city, j.state, j.notes, j.created_by,
           IF(j.active = 1, NULL, CURRENT_TIMESTAMP),
           j.created_at, j.updated_at
         FROM jbt_parties j
         LEFT JOIN bos_parties b ON b.id = j.id
         WHERE b.id IS NULL`,
      );
    }
  }

  // 4) Replace physical ims_parties with an updatable view over the registry.
  if (Number(hasIms?.n)) {
    const [[alreadyView]] = await q(
      `SELECT COUNT(*) AS n FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_parties'`,
    );
    if (!Number(alreadyView?.n)) {
      await q(`RENAME TABLE ims_parties TO ims_parties_legacy`);
      await q(
        `CREATE VIEW ims_parties AS
         SELECT
           id, tenant_id, kind, name, contact_person, mobile, email, gstin, pan,
           address, city, state, state_code, payment_terms_days, credit_limit, opening_balance,
           account_manager_id, account_manager_name, tags, notes, active, created_by, created_at, updated_at
         FROM jbt_parties`,
      );
    }
  }
}
