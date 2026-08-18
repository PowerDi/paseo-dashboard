import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  testDir: "./src",
  testMatch: "*.playwright.test.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5183",
    locale: "zh-CN",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:e2e --workspace=@getpaseo/dashboard-web -- --port 5183",
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
    url: "http://localhost:5183",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
