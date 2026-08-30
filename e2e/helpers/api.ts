import type { APIRequestContext } from "@playwright/test";

const API_BASE = process.env.E2E_API_URL ?? "http://localhost:4100";

export async function listToolRecords(request: APIRequestContext, toolId: string) {
  const res = await request.get(`${API_BASE}/api/tools/${toolId}/records`);
  if (!res.ok()) {
    throw new Error(`Failed to list ${toolId}: ${res.status()}`);
  }
  return (await res.json()) as Array<{ id: string }>;
}

export async function clearToolRecords(request: APIRequestContext, toolId: string) {
  const records = await listToolRecords(request, toolId);
  for (const record of records) {
    await request.delete(`${API_BASE}/api/tools/${toolId}/records/${record.id}`);
  }
}

export async function createVendorRecord(
  request: APIRequestContext,
  name: string,
  id?: string,
) {
  const res = await request.post(`${API_BASE}/api/tools/vendors/records`, {
    data: { id, name },
  });
  return res;
}

export async function seedVendorRecords(request: APIRequestContext, count: number) {
  for (let i = 0; i < count; i++) {
    const res = await createVendorRecord(request, `E2E Seed Vendor ${i}`);
    if (!res.ok()) {
      throw new Error(`Seed failed at ${i}: ${res.status()} ${await res.text()}`);
    }
  }
}

export async function saveProfileBusinessName(
  request: APIRequestContext,
  businessName: string,
) {
  const profileRes = await request.get(`${API_BASE}/api/profile`);
  const profile = (await profileRes.json()) as Record<string, unknown>;
  const res = await request.put(`${API_BASE}/api/profile`, {
    data: { ...profile, businessName },
  });
  if (!res.ok()) {
    throw new Error(`Profile save failed: ${res.status()}`);
  }
}
