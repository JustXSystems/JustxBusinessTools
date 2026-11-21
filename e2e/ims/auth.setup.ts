import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { apiLoginJustTestX } from "../helpers/auth";
import { apiPath, appPath, imsAuthStatePath, imsBaseURL, isRemoteImsTarget } from "./env";

const authFile = path.join(__dirname, "..", "..", imsAuthStatePath());
const BRANCH_NAME = process.env.E2E_IMS_BRANCH_NAME ?? "JustTestX";

setup("authenticate JustTestX owner", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  console.log(`[IMS E2E] target=${imsBaseURL()} remote=${isRemoteImsTarget()}`);

  // API login first — one request, cookie jar on this context (survives rate limits better than UI hammering).
  await apiLoginJustTestX(page.request);

  const me = await page.request.get(apiPath("/api/auth/me"));
  expect(me.ok(), `GET /api/auth/me failed: ${me.status()}`).toBeTruthy();
  const body = (await me.json()) as {
    user?: {
      businessProfileId: number;
      branches?: Array<{ id: number; businessName: string }>;
    };
  };
  const user = body.user;
  expect(user, "No user on /api/auth/me").toBeTruthy();
  const branches = user!.branches ?? [];
  const target =
    branches.find((b) => b.businessName === BRANCH_NAME) ||
    branches.find((b) => b.businessName.toLowerCase().includes("justtestx"));
  if (!target) {
    throw new Error(
      `No "${BRANCH_NAME}" branch on this account. Branches: ${branches.map((b) => b.businessName).join(", ") || "(none)"}`,
    );
  }
  if (target.id !== user!.businessProfileId) {
    const sw = await page.request.post(apiPath("/api/auth/switch-branch"), {
      data: { businessProfileId: target.id },
    });
    expect(sw.ok(), `switch-branch failed: ${sw.status()} ${await sw.text()}`).toBeTruthy();
    console.log(`[IMS E2E] switched branch → ${target.businessName} (#${target.id})`);
  } else {
    console.log(`[IMS E2E] already on ${target.businessName} (#${target.id})`);
  }

  await page.goto(appPath("/ims"));
  await expect(page.getByLabel("IMS modules")).toBeVisible({ timeout: 90_000 });
  await page.context().storageState({ path: authFile });
});
