/** Sign-off identity on a saved quotation: who owns the lead. */
export const SIGNATURE_FIELDS = ["preparedBy", "preparedByPhone", "preparedByEmail"] as const;

export type QuoteSignature = Record<(typeof SIGNATURE_FIELDS)[number], string>;

export function signatureOf(q: Record<string, unknown>): QuoteSignature {
  return {
    preparedBy: String(q.preparedBy ?? "").trim(),
    preparedByPhone: String(q.preparedByPhone ?? "").trim(),
    preparedByEmail: String(q.preparedByEmail ?? "").trim(),
  };
}

/**
 * Once saved, only the creator may change the signature. The Business Owner may
 * override, but only when the save explicitly asks for it. No signed-in user
 * (single-user installs) is never locked.
 */
export function signatureUpdateDecision(input: {
  before: QuoteSignature;
  after: QuoteSignature;
  userId: number | null;
  creatorUserId: unknown;
  role: string;
  force: boolean;
}): "unchanged" | "allowed" | "forced" | "locked" {
  const changed = SIGNATURE_FIELDS.some((k) => input.before[k] !== input.after[k]);
  if (!changed) return "unchanged";
  if (input.userId == null) return "allowed";
  if (Number(input.creatorUserId) === input.userId) return "allowed";
  if (input.force && input.role === "owner") return "forced";
  return "locked";
}
