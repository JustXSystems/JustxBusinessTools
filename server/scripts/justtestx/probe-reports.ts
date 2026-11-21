/**
 * Probe all IMS report builders against JustTestX seed.
 *   npx tsx scripts/justtestx/probe-reports.ts
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import { REPORT_TYPES } from "../../src/ims/logic.js";
import { runReport } from "../../src/ims/reports.js";
import type { ImsDeps } from "../../src/ims/types.js";

async function main() {
  const [profiles] = await pool.query<Array<{ id: number }>>(
    `SELECT id FROM business_profiles WHERE business_name = 'JustTestX' ORDER BY id DESC LIMIT 1`,
  );
  const tenantId = Number(profiles[0]?.id ?? 0);
  if (!tenantId) throw new Error("JustTestX missing");

  const [owners] = await pool.query<Array<{ id: number }>>(
    `SELECT u.id FROM users u JOIN org_members m ON m.user_id = u.id
     JOIN business_profiles p ON p.organization_id = m.organization_id
     WHERE p.id = ? AND m.role = 'owner' LIMIT 1`,
    [tenantId],
  );
  const userId = Number(owners[0]?.id ?? 1);

  const deps = { db: pool } as unknown as ImsDeps;
  const actor = {
    tenantId,
    userId,
    displayName: "Santhosh HS",
    role: "owner" as const,
    email: "santhosh.hs@justxsystems.com",
    permissions: null,
  };

  console.log(`tenant=${tenantId} user=${userId}\n`);
  for (const { key, label } of REPORT_TYPES) {
    try {
      const r = await runReport(deps, actor as never, key, {
        period: "custom",
        from: "2024-11-21",
        to: "2026-11-21",
        filters: key === "deadstock" ? { days: 90 } : {},
      });
      const thin = r.rows.length < 5 ? " ⚠️ THIN" : "";
      console.log(
        `${key.padEnd(14)} ${label.padEnd(28)} rows=${String(r.rows.length).padStart(5)}${thin}`,
      );
      for (const s of r.summary.slice(0, 4)) {
        console.log(`               · ${s.label}: ${s.value}`);
      }
    } catch (e) {
      console.log(`${key.padEnd(14)} ERROR ${(e as Error).message}`);
    }
  }

  // GST screens
  const [[inv]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = ? AND status = 'issued'`,
    [tenantId],
  );
  const [[dmg]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id = ? AND type IN ('DAMAGE','WRITE_OFF')`,
    [tenantId],
  );
  const [[low]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id = ? AND active = 1 AND current_stock <= min_stock`,
    [tenantId],
  );
  const [[ar]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = ? AND status = 'issued' AND grand_total - amount_paid > 0.005`,
    [tenantId],
  );
  const [[ap]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_bills WHERE tenant_id = ? AND status <> 'cancelled' AND grand_total - amount_paid > 0.005`,
    [tenantId],
  );
  const [[field]] = await pool.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ims_field_visits WHERE tenant_id = ?`,
    [tenantId],
  );
  console.log("\n=== RAW GAPS ===");
  console.log({ issuedInvoices: inv.n, damageMoves: dmg.n, lowStock: low.n, openAR: ar.n, openAP: ap.n, fieldVisits: field.n });

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
