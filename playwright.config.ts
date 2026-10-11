import { defineConfig, devices } from "@playwright/test";
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
    baseURL: "http://localhost:4567",
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
    command: "APP_ENV=production trmnlp serve",
    url: "http://localhost:4567",
    reuseExistingServer: !process.env.CI,
  },
});
