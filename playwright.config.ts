import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure", launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "iphone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run db:migrate && npm run db:bootstrap && npm run db:demo && npm run build && npx vite preview --host 0.0.0.0 --port 4173",
    url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
