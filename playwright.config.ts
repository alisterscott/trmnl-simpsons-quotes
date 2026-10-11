import { defineConfig, devices } from "@playwright/test";

const previewPort = Number(process.env.TRML_PREVIEW_PORT ?? 4567);
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
  throw new Error("TRML_PREVIEW_PORT must be a valid TCP port");
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,

  workers: 1,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${previewPort}`,
    screenshot: "only-on-failure",
    trace: "on",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `APP_ENV=production bundle exec trmnlp serve --port ${previewPort}`,
    url: `http://localhost:${previewPort}`,
    reuseExistingServer: !process.env.CI,
  },
});
