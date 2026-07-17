import { defineConfig, devices } from "@playwright/test";

/**
 * E2E accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * Run `npm run build` first (CI does).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  webServer: {
    command: "npm run preview -- --port 4288 --strictPort",
    url: "http://localhost:4288/crypto-lab-power-trace/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: "http://localhost:4288/crypto-lab-power-trace/",
    colorScheme: "dark",
  },
});
