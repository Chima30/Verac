import { defineConfig, devices } from "@playwright/test";

/**
 * Layout checks for the redesigned app: no horizontal overflow, no clipped headings, landmarks present, both themes,
 * desktop and phone. Point it at a running server with E2E_BASE_URL (default http://localhost:3000).
 * Screenshots land in test-results/ for before/after comparison.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
