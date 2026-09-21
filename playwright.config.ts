import { defineConfig } from "@playwright/test";

// PW_CHROMIUM points at a Chromium binary when the Playwright-managed one is
// not installed (the cloud session has one at /opt/pw-browsers/chromium).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { headless: true, viewport: { width: 390, height: 844 }, launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  reporter: "list",
});
