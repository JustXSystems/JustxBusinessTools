/** Fallback only — live limits come from GET /subscription and usage APIs. */
export const FREE_RECORD_LIMIT = 28;

export function isToolSubjectToLimit(_toolId: string, subscriptionExempt: boolean): boolean {
  return !subscriptionExempt;
}
