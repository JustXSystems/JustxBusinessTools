import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const webPort = 3100;
const apiPort = 4100;
const authFile = path.join(__dirname, "e2e/.auth/justtestx.json");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/[/\\]ims[/\\]/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ims-setup",
      testMatch: /[/\\]ims[/\\]auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ims",
      testMatch: /[/\\]ims[/\\].*\.spec\.ts/,
      dependencies: ["ims-setup"],
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure",
      },
    },
  ],
  webServer: [
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
  ],
});
