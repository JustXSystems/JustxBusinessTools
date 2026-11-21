import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import path from "node:path";
import { imsAuthStatePath, imsBaseURL, isRemoteImsTarget, playwrightBaseURL } from "./e2e/ims/env";

const webPort = 3100;
const apiPort = 4100;
const remote = isRemoteImsTarget();
const baseURL = playwrightBaseURL();
const authFile = path.join(__dirname, imsAuthStatePath());

if (remote) {
  console.log(`[IMS E2E] remote target root=${imsBaseURL()}  playwright baseURL=${baseURL}`);
}

const localWebServers: PlaywrightTestConfig["webServer"] = [
  {
    command: "npm run dev:e2e -w server",
    url: `http://localhost:${apiPort}/api/profile`,
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_SERVER),
    timeout: 120000,
    env: {
      PORT: String(apiPort),
      DB_HOST: "127.0.0.1",
      DB_PORT: "3306",
      DB_USER: "justx_user",
      DB_PASSWORD: "devpassword",
      DB_NAME: "justx_systems",
      CORS_ORIGIN: `http://localhost:${webPort}`,
      PAYMENT_AUTO_COMPLETE: "true",
      PAYMENT_PROVIDER: "mock",
    },
  },
  {
    command: "npm run serve:e2e -w web",
    url: `http://localhost:${webPort}`,
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_SERVER),
    timeout: 300000,
    env: {
      API_PROXY_PORT: String(apiPort),
    },
  },
];

/**
 * On-demand IMS suite — local or production/pre-go-live.
 *
 * Production: set E2E_IMS_BASE_URL (+ E2E_IMS_EMAIL / E2E_IMS_PASSWORD).
 * No local webServer is started when the target host is not localhost.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Remote retries re-auth and trip production login rate limits — fail once, re-run later.
  retries: remote ? 0 : process.env.CI ? 2 : 0,
  workers: 1,
  timeout: remote ? 180_000 : 120_000,
  expect: { timeout: remote ? 45_000 : 20_000 },
  outputDir: "e2e-results/ims-artifacts",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e-results/ims-html" }],
    ["json", { outputFile: "e2e-results/ims/playwright.json" }],
    ["./e2e/reporters/ims-scenario-report.ts"],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.E2E_IMS_IGNORE_HTTPS === "1",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: remote ? 30_000 : 15_000,
    navigationTimeout: remote ? 60_000 : 30_000,
  },
  projects: [
    {
      name: "ims-setup",
      testMatch: /[/\\]ims[/\\]auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ims",
      testMatch: /[/\\]ims[/\\].*\.spec\.ts/,
      dependencies: ["ims-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
    },
  ],
  // Hit the live deployment — do not boot local API/web.
  ...(remote ? {} : { webServer: localWebServers }),
});
