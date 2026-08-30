import { Router } from "express";
import { pool } from "../db.js";
import { isDocumentToolId, newRecordId } from "../lib/constants.js";
import { isAllowedTrackerTool, resolveTrackerFields } from "../lib/tool-registry.js";
import { ValidationError, validateTrackerData } from "../lib/validation/record-data.js";
import { getActiveProfileId } from "../lib/request-context.js";
import {
  getDocumentUsage,
  syncDocumentUsage,
} from "../lib/document-usage.js";
import {
  getToolUsage,
  syncToolUsage,
} from "../lib/usage.js";
import { LimitReachedError, runCreateWithLimit } from "../lib/usage-limits.js";
import { logAudit } from "../lib/audit.js";
import { notifyToolRecordChange } from "../lib/notification-tool-hooks.js";
import { requireWriteAccess } from "../middleware/require-write.js";

const router = Router();

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  void requireWriteAccess(req, res, next);
});

type ToolRecordRow = {
  id: string;
  tool_id: string;
  data: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function parseData(data: ToolRecordRow["data"]): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data ?? {};
}

function toApiRecord(row: ToolRecordRow) {
  const data = parseData(row.data);
  return {
    id: row.id,
    toolId: row.tool_id,
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/:toolId/usage", async (req, res) => {
  const toolId = req.params.toolId;
  if (isDocumentToolId(toolId)) {
    res.json(await getDocumentUsage(toolId));
    return;
  }
  if (!(await isAllowedTrackerTool(toolId))) {
    res.status(400).json({ error: "Invalid tool" });
    return;
  }
  const usage = await getToolUsage(toolId);
  res.json(usage);
});

router.get("/:toolId/records", async (req, res) => {
  const toolId = req.params.toolId;
  if (!(await isAllowedTrackerTool(toolId))) {
    res.status(400).json({ error: "Invalid tracker tool" });
    return;
  }
  const [rows] = await pool.query(
    `SELECT id, tool_id, data, created_at, updated_at
     FROM tool_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     ORDER BY updated_at DESC`,
    { profileId: getActiveProfileId(), toolId },
  );
  const list = (Array.isArray(rows) ? rows : []).map((row) =>
    toApiRecord(row as ToolRecordRow),
  );
  res.json(list);
});

router.post("/:toolId/records", async (req, res) => {
  const toolId = req.params.toolId;
  if (!(await isAllowedTrackerTool(toolId))) {
    res.status(400).json({ error: "Invalid tracker tool" });
    return;
  }

  const body = req.body ?? {};
  const rawData = (body.data ?? body) as Record<string, unknown>;
  const id = String(body.id ?? newRecordId(toolId));

  let data: Record<string, unknown>;
  try {
    const fields = await resolveTrackerFields(toolId);
    data = validateTrackerData(fields, rawData);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: err.details });
      return;
    }
    throw err;
  }

  try {
    const record = await runCreateWithLimit(toolId, "tracker", async (conn) => {
      await conn.query(
        `INSERT INTO tool_records (id, business_profile_id, tool_id, data)
         VALUES (:id, :profileId, :toolId, :data)`,
        {
          id,
          profileId: getActiveProfileId(),
          toolId,
          data: JSON.stringify(data),
        },
      );

      const [rows] = await conn.query(
        `SELECT id, tool_id, data, created_at, updated_at FROM tool_records WHERE id = :id`,
        { id },
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        throw new Error("Failed to load created record");
      }
      return toApiRecord(row as ToolRecordRow);
    });

    await logAudit("tool.record.create", "tool_record", id, { toolId }, req.ip);
    notifyToolRecordChange({ toolId, recordId: id, next: data, isCreate: true });
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof LimitReachedError) {
      res.status(403).json({
        error: "FREE_LIMIT_REACHED",
        limit: err.limit,
      });
      return;
    }
    throw err;
  }
});

router.put("/:toolId/records/:recordId", async (req, res) => {
  const toolId = req.params.toolId;
  const recordId = req.params.recordId;
  if (!(await isAllowedTrackerTool(toolId))) {
    res.status(400).json({ error: "Invalid tracker tool" });
    return;
  }

  const body = req.body ?? {};
  const rawData = (body.data ?? body) as Record<string, unknown>;

  let data: Record<string, unknown>;
  try {
    const fields = await resolveTrackerFields(toolId);
    data = validateTrackerData(fields, rawData);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: err.details });
      return;
    }
    throw err;
  }

  const [prevRows] = await pool.query(
    `SELECT data FROM tool_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id: recordId, profileId: getActiveProfileId(), toolId },
  );
  const prevRow = Array.isArray(prevRows) ? (prevRows[0] as ToolRecordRow | undefined) : undefined;
  const previous = prevRow ? parseData(prevRow.data) : null;

  const [result] = await pool.query(
    `UPDATE tool_records SET data = :data
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    {
      id: recordId,
      profileId: getActiveProfileId(),
      toolId,
      data: JSON.stringify(data),
    },
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (!affected) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const [rows] = await pool.query(
    `SELECT id, tool_id, data, created_at, updated_at FROM tool_records WHERE id = :id`,
    { id: recordId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  await logAudit("tool.record.update", "tool_record", recordId, { toolId }, req.ip);
  notifyToolRecordChange({ toolId, recordId, previous, next: data });
  res.json(toApiRecord(row as ToolRecordRow));
});

router.delete("/:toolId/records/:recordId", async (req, res) => {
  const toolId = req.params.toolId;
  const recordId = req.params.recordId;
  if (!(await isAllowedTrackerTool(toolId))) {
    res.status(400).json({ error: "Invalid tracker tool" });
    return;
  }

  const [result] = await pool.query(
    `DELETE FROM tool_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id: recordId, profileId: getActiveProfileId(), toolId },
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (!affected) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  await syncToolUsage(toolId);
  await logAudit("tool.record.delete", "tool_record", recordId, { toolId }, req.ip);
  res.status(204).send();
});

export default router;
