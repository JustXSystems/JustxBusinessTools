import { Router } from "express";
import { pool } from "../db.js";
import { getActiveProfileId } from "../lib/request-context.js";

const router = Router();

const DOCUMENT_PREFIXES: Record<string, string> = {
  quotation: "QTN",
  salesorder: "SO",
  invoice: "INV",
  po: "PO",
};

router.post("/:toolId/next", async (req, res) => {
  const toolId = req.params.toolId;
  const prefix = DOCUMENT_PREFIXES[toolId];
  if (!prefix) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }

  const profileId = getActiveProfileId();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO document_sequences (business_profile_id, tool_id, year, month, last_seq)
       VALUES (:profileId, :toolId, :year, :month, 0)
       ON DUPLICATE KEY UPDATE last_seq = last_seq`,
      { profileId, toolId, year, month },
    );

    await conn.query(
      `UPDATE document_sequences
       SET last_seq = last_seq + 1
       WHERE business_profile_id = :profileId AND tool_id = :toolId AND year = :year AND month = :month`,
      { profileId, toolId, year, month },
    );

    const [rows] = await conn.query(
      `SELECT last_seq FROM document_sequences
       WHERE business_profile_id = :profileId AND tool_id = :toolId AND year = :year AND month = :month`,
      { profileId, toolId, year, month },
    );
    const seq = (Array.isArray(rows) ? rows[0] : { last_seq: 1 }) as { last_seq: number };

    await conn.commit();

    const docNo = `${prefix}/${year}/${String(month).padStart(2, "0")}/${1000 + seq.last_seq}`;
    res.json({ docNo, prefix, year, month, seq: seq.last_seq });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
