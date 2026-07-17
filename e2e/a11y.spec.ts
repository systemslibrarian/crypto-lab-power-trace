import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 2.1 A/AA gate. Scans the production build (via `vite preview`) in both
 * themes, after driving every panel into its post-interaction state — an
 * unscanned state is an ungated state.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}`,
  });
}

/** Put every exhibit into its result state so dynamic regions get scanned. */
async function driveDemos(page: Page): Promise<void> {
  // Exhibit 1 — SPA
  await page.locator("#spa-run").click();
  await expect(page.locator("#spa-status")).not.toBeEmpty();

  // Exhibit 2 — CPA (also exercise the sliders)
  await page.locator("#cpa-traces").fill("2500");
  await page.locator("#cpa-noise").fill("30");
  await page.locator("#cpa-run").click();
  await expect(page.locator("#cpa-verdict")).not.toBeEmpty();

  // Exhibit 3 — noise sweep
  await page.locator("#noise-run").click();
  await expect(page.locator("#noise-status")).not.toBeEmpty({ timeout: 30_000 });

  // Exhibit 4 — misalignment: defend, then defeat
  await page.locator("#align-run").click();
  await expect(page.locator("#align-verdict")).not.toBeEmpty();
  await page.locator("#align-fix").click();

  // Exhibit 5 — DPA vs CPA
  await page.locator("#dpacpa-run").click();
  await expect(page.locator("#dpacpa-status")).not.toBeEmpty({ timeout: 30_000 });

  // Exhibit 6 — countermeasures (masking exercises the "held" indicator + caveat)
  await page.locator("#cm-masking").check();
  await page.locator("#cm-run").click();
  await expect(page.locator("#cm-verdict")).not.toBeEmpty();

  // Reveal every collapsed table.
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true));
  });
  await page.waitForTimeout(300);
}

async function scan(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) })),
  ).toEqual([]);
}

test("no WCAG A/AA violations — dark theme", async ({ page }) => {
  await page.goto(".");
  await expect(page.locator("#app main")).toBeVisible();
  await killMotion(page);
  await driveDemos(page);
  await scan(page);
});

test("no WCAG A/AA violations — light theme", async ({ page }) => {
  await page.goto(".");
  await page.locator("#cl-theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#app main")).toBeVisible();
  await killMotion(page);
  await driveDemos(page);
  await scan(page);
});
