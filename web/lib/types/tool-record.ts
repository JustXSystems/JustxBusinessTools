export type ToolRecord = {
  id: string;
  toolId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ToolUsage = {
  toolId: string;
  recordCount: number;
  limit: number | null;
  atLimit: boolean;
  nearLimit: boolean;
};

/** Flat row for list display (id + tracker fields). */
export type TrackerRow = Record<string, unknown> & { id: string };

export function flattenRecord(record: ToolRecord): TrackerRow {
  return { id: record.id, ...record.data };
}
