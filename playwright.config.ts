import { defineConfig, devices } from "@playwright/test";

const port = 4174;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1000, height: 700 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1000, height: 700 },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1000, height: 700 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1000, height: 700 },
      },
    },
  ],
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://127.0.0.1:${port}/e2e/fixtures/page.html`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
});
