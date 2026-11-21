import type { APIRequestContext, Page } from "@playwright/test";
import { apiPath, appPath, requireImsCredentials } from "../ims/env";

/** JustTestX owner credentials (local defaults; required env on remote/prod). */
export function justTestXCredentials() {
  return requireImsCredentials();
}

/** Prefer API login — avoids UI splash and reduces rate-limit pressure on production. */
export async function apiLoginJustTestX(
  request: APIRequestContext,
  opts?: { email?: string; password?: string },
): Promise<void> {
  const { email, password } = opts ?? justTestXCredentials();
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await request.post(apiPath("/api/auth/login"), {
      data: { email, password },
      failOnStatusCode: false,
    });
    lastStatus = res.status();
    lastBody = await res.text();
    if (res.ok()) {
      try {
        const data = JSON.parse(lastBody) as { mfaRequired?: boolean };
        if (data.mfaRequired) {
          throw new Error("MFA required — set E2E_IMS_MFA_CODE and use UI login, or disable MFA for JustTestX");
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("MFA")) throw e;
      }
      return;
    }
    // Rate limit — wait and retry.
    if (lastStatus === 429 || /too many requests/i.test(lastBody)) {
      const waitMs = 15_000 * (attempt + 1);
      console.log(`[IMS E2E] login rate-limited (${lastStatus}); waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    break;
  }
  throw new Error(`API login failed for ${email}: HTTP ${lastStatus} ${lastBody.slice(0, 200)}`);
}

async function fillPasswordLogin(page: Page, email: string, password: string) {
  const loginUrl = appPath("/login");
  await page.goto(loginUrl);
  await page.waitForURL((url) => url.pathname.includes("/login"), { timeout: 30_000 });
  await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 60_000 });

  await page.getByLabel("Username").click();
  await page.getByLabel("Username").fill(email);
  await page.getByLabel("Password").click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  const rateLimited = page.getByText(/Too many requests/i).first();
  const badCreds = page.getByText(/Invalid email or password/i).first();
  const mfa = page.getByLabel("Authenticator code");
  const leftLogin = page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 90_000 });

  const outcome = await Promise.race([
    leftLogin.then(() => "ok" as const),
    rateLimited.waitFor({ state: "visible", timeout: 90_000 }).then(() => "rate" as const),
    badCreds.waitFor({ state: "visible", timeout: 90_000 }).then(() => "bad_creds" as const),
    mfa.waitFor({ state: "visible", timeout: 90_000 }).then(() => "mfa" as const),
  ]).catch(() => "timeout" as const);

  if (outcome === "rate") {
    throw new Error("Login rate-limited (Too many requests). Wait a few minutes, then re-run.");
  }
  if (outcome === "bad_creds") {
    throw new Error(
      `Login rejected for ${email} (Invalid email or password). Check E2E_IMS_EMAIL / E2E_IMS_PASSWORD.`,
    );
  }
  if (outcome === "timeout") {
    throw new Error(`Login did not leave /login for ${email}`);
  }
  if (outcome === "mfa") {
    const code = process.env.E2E_IMS_MFA_CODE;
    if (!code) throw new Error("MFA required — set E2E_IMS_MFA_CODE");
    await mfa.fill(code);
    await page.getByRole("button", { name: /^Verify$/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 });
  }
}

/** Log in via password form. Requires E2E_EMAIL / E2E_PASSWORD. */
export async function loginAsAdmin(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set");
  }
  await fillPasswordLogin(page, email, password);
}

/** Log in as JustTestX org owner (IMS seed tenant). Prefers API on remote. */
export async function loginJustTestX(page: Page) {
  const { email, password } = justTestXCredentials();
  try {
    await apiLoginJustTestX(page.request, { email, password });
    await page.goto(appPath("/ims"));
    return;
  } catch (err) {
    console.log(`[IMS E2E] API login fallback to UI: ${err instanceof Error ? err.message : err}`);
    await fillPasswordLogin(page, email, password);
  }
}
