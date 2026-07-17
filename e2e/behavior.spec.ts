import { expect, test } from "@playwright/test";

/**
 * Behavior gate: verify the shipped interface actually teaches the intended
 * result, not just that it is accessible. Every assertion here mirrors a claim
 * the unit tests prove in isolation — this checks the user-visible wiring.
 * Deterministic because trace generation is seeded (see src/leakage/rng.ts).
 */

test.describe("Correlation Power Analysis — the headline", () => {
  test("recovers key byte 0x2B under documented easy settings", async ({ page }) => {
    await page.goto(".");
    await page.locator("#cpa-seed").fill("1234");
    await page.locator("#cpa-noise").fill("30"); // sigma = 3.0
    await page.locator("#cpa-traces").fill("2500");
    await page.locator("#cpa-run").click();

    await expect(page.locator("#cpa-verdict")).toContainText("Key byte leaked");
    await expect(page.locator("#cpa-recovered")).toContainText("0x2B");
    // The cryptographic-result indicator stays factual even as the key leaks.
    await expect(page.locator("#cpa-cipher")).toContainText("AES-128 encryption: correct");
  });

  test("more traces separate the spike (verdict flips as N climbs)", async ({ page }) => {
    await page.goto(".");
    await page.locator("#cpa-seed").fill("1234");
    await page.locator("#cpa-noise").fill("100"); // sigma = 10, a hard regime
    await page.locator("#cpa-traces").fill("10");
    await page.locator("#cpa-run").click();
    await expect(page.locator("#cpa-verdict")).toContainText("Not yet recovered");

    await page.locator("#cpa-traces").fill("5000");
    await page.locator("#cpa-run").click();
    await expect(page.locator("#cpa-verdict")).toContainText("Key byte leaked");
  });

  test("a fresh seed still recovers the same byte (not a one-sample fluke)", async ({ page }) => {
    await page.goto(".");
    await page.locator("#cpa-noise").fill("30");
    await page.locator("#cpa-traces").fill("3000");
    await page.locator("#cpa-seed").fill("42");
    await page.locator("#cpa-run").click();
    await expect(page.locator("#cpa-recovered")).toContainText("0x2B");
  });
});

test.describe("Misalignment — defend, then defeat", () => {
  test("jitter blocks CPA and resync restores it", async ({ page }) => {
    await page.goto(".");
    await page.locator("#align-run").click();
    await expect(page.locator("#align-verdict")).toContainText("Attack blocked");

    await page.locator("#align-fix").click();
    await expect(page.locator("#align-verdict")).toContainText("key byte leaked");
  });
});

test.describe("Countermeasures", () => {
  test("masking defeats first-order CPA; the baseline leaks", async ({ page }) => {
    await page.goto(".");
    await page.locator("#cm-masking").check();
    await page.locator("#cm-run").click();
    await expect(page.locator("#cm-verdict")).toContainText("First-order CPA defeated");
    await expect(page.locator("#cm-note")).toContainText("second-order", { ignoreCase: true });

    await page.locator("#cm-none").check();
    await page.locator("#cm-run").click();
    await expect(page.locator("#cm-verdict")).toContainText("Key byte leaked");
  });
});

test.describe("Chrome", () => {
  test("theme choice persists across reload", async ({ page }) => {
    await page.goto(".");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#cl-theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("major panels fit a narrow mobile viewport without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 900 });
    await page.goto(".");
    await expect(page.locator("#app main")).toBeVisible();
    await expect(page.locator(".cl-hero-title")).toBeVisible();
    await expect(page.locator("#cpa-canvas")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
