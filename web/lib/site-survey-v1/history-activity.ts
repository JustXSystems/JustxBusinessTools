import type { SiteSurveyV1, SurveyHistoryRow } from "./types";

export type SurveyActivityRow = SurveyHistoryRow & {
  actionLabel: string;
  actionKind: "create" | "update" | "status" | "amount";
  amountDelta: number | null;
  savedAtLabel: string;
  surveyExists: boolean;
  isLatestForSurvey: boolean;
};

function fmtWhen(iso: string) {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionFromServer(raw: string | undefined): { label: string; kind: SurveyActivityRow["actionKind"] } | null {
  const a = String(raw ?? "").trim();
  if (!a) return null;
  if (a === "create") return { label: "Created", kind: "create" };
  if (a === "update") return { label: "Saved", kind: "update" };
  if (a.startsWith("status:")) {
    const st = a.slice("status:".length);
    const labels: Record<string, string> = {
      draft: "Back to draft",
      saved: "Saved",
      submitted: "Submitted",
    };
    return { label: labels[st] ?? `Status → ${st}`, kind: "status" };
  }
  return { label: a, kind: "update" };
}

function inferAction(
  row: SurveyHistoryRow,
  prev: SurveyHistoryRow | null,
): { label: string; kind: SurveyActivityRow["actionKind"] } {
  const fromServer = actionFromServer(row.action);
  if (fromServer) return fromServer;

  if (!prev) return { label: "Created", kind: "create" };
  if (row.status !== prev.status) {
    const labels: Record<string, string> = {
      draft: "Back to draft",
      saved: "Saved",
      submitted: "Submitted",
    };
    return {
      label: labels[row.status] ?? `Status → ${row.status}`,
      kind: "status",
    };
  }
  if (Number(row.estimatedCost) !== Number(prev.estimatedCost)) {
    return { label: "Estimate updated", kind: "amount" };
  }
  return { label: "Saved", kind: "update" };
}

function previousSave(history: SurveyHistoryRow[], index: number, surveyId: string) {
  for (let i = index + 1; i < history.length; i++) {
    if (history[i].surveyId === surveyId) return history[i];
  }
  return null;
}

function latestIndexBySurvey(history: SurveyHistoryRow[]) {
  const map = new Map<string, number>();
  history.forEach((h, i) => {
    if (!map.has(h.surveyId)) map.set(h.surveyId, i);
  });
  return map;
}

/** Newest-first save log → actionable activity rows. */
export function buildSurveyActivityTimeline(
  history: SurveyHistoryRow[],
  surveys: SiteSurveyV1[],
): SurveyActivityRow[] {
  const exists = new Set(surveys.map((s) => s.id));
  const latestIdx = latestIndexBySurvey(history);

  return history.map((h, index) => {
    const prev = previousSave(history, index, h.surveyId);
    const { label, kind } = inferAction(h, prev);
    let amountDelta: number | null = null;
    if (prev && Number.isFinite(Number(h.estimatedCost)) && Number.isFinite(Number(prev.estimatedCost))) {
      const d = Number(h.estimatedCost) - Number(prev.estimatedCost);
      if (Math.abs(d) >= 0.01) amountDelta = d;
    }

    return {
      ...h,
      actionLabel: label,
      actionKind: kind,
      amountDelta,
      savedAtLabel: fmtWhen(h.savedAt),
      surveyExists: exists.has(h.surveyId),
      isLatestForSurvey: latestIdx.get(h.surveyId) === index,
    };
  });
}

export function filterSurveyActivity(rows: SurveyActivityRow[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [
      r.reportNo,
      r.customerName,
      r.installationType,
      r.status,
      r.actionLabel,
      r.preparedBy,
    ]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

export function surveyActivityStats(rows: SurveyActivityRow[]) {
  const uniqueSurveys = new Set(rows.map((r) => r.surveyId)).size;
  return { events: rows.length, uniqueSurveys };
}
