import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 10_000 },
  outputDir: "/tmp/kinmu-os-playwright",
  reporter: "line",
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  webServer: process.env.CI
    ? {
        command: "pnpm start --port 3190",
        url: "http://127.0.0.1:3190/api/health",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
