import { api } from "@/lib/api";

type ProfileGetResponse = {
  profile?: { homeToolIds?: string[] | null };
  homeToolIds?: string[] | null;
};

/** Fetch current home allowlist for a Business Profile. */
export async function fetchHomeToolIds(businessProfileId: number): Promise<string[]> {
  const data = await api<ProfileGetResponse>(`/admin/profiles/${businessProfileId}`);
  const raw = data.profile?.homeToolIds ?? data.homeToolIds;
  return Array.isArray(raw) ? raw.map(String) : [];
}

/** Add tool ids to the profile home allowlist (no-op if already present). */
export async function ensureToolsOnHome(
  businessProfileId: number,
  toolIds: string[],
  current?: string[],
): Promise<string[]> {
  const ids = toolIds.map(String).filter(Boolean);
  if (ids.length === 0) return current ?? (await fetchHomeToolIds(businessProfileId));
  const base = current ?? (await fetchHomeToolIds(businessProfileId));
  const next = Array.from(new Set([...base, ...ids]));
  if (next.length === base.length && ids.every((id) => base.includes(id))) return base;
  await api(`/admin/profiles/${businessProfileId}`, {
    method: "PUT",
    body: JSON.stringify({ homeToolIds: next }),
  });
  return next;
}

/** Remove tool ids from the profile home allowlist. */
export async function removeToolsFromHome(
  businessProfileId: number,
  toolIds: string[],
  current?: string[],
): Promise<string[]> {
  const drop = new Set(toolIds.map(String).filter(Boolean));
  if (drop.size === 0) return current ?? (await fetchHomeToolIds(businessProfileId));
  const base = current ?? (await fetchHomeToolIds(businessProfileId));
  const next = base.filter((id) => !drop.has(id));
  if (next.length === base.length) return base;
  await api(`/admin/profiles/${businessProfileId}`, {
    method: "PUT",
    body: JSON.stringify({ homeToolIds: next }),
  });
  return next;
}
