import { expect, test } from "@playwright/test";
import { boot, driveAllStates, NARROW, reportCollected, watchPageErrors } from "./gate";

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches, and scanned after every step:
 * the arrival state, where SPA and CPA have already run themselves and the other
 * five exhibits are empty with their status regions collapsed; the skip link
 * focused; SPA's two error branches and a 14-bit exponent; CPA at both ends of
 * both sliders — the minimum is the only route to the "Not yet recovered"
 * neutral verdict and the maximum the only route to the ALARM one — then
 * re-seeded, frozen, cleared, permalinked and exported; the noise sweep;
 * misalignment DEFENDING (the only HELD verdict in that exhibit) and then
 * defeated; DPA raced against CPA; all four countermeasures, because masking is
 * the only one that produces a HELD verdict and the only one that renders the
 * second-order caveat; and the CSV importer in both its success and its
 * parse-failure branch. Every data table is opened by clicking its own
 * `<summary>`, and scanned shut as well as open.
 *
 * Four configurations: {dark, light} x {1280, 380}.
 *
 * See `gate.ts` for what the gate this replaces actually did: injected motion
 * suppression that bypassed the stylesheet's own reduced-motion block,
 * `<details>` opened by assignment from script, one scan after the whole drive,
 * one viewport, `violations` as the only oracle, and a 1.4.11 check aimed at the
 * two inputs its token was already correctly applied to.
 */

for (const theme of ["dark", "light"] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page, context }) => {
    test.setTimeout(1_800_000);
    // `#cpa-link` calls `navigator.clipboard.writeText`. Without the grant the
    // promise rejects and the drive would assert against the fallback path
    // rather than the one a reader gets.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join("\n")).toEqual([]);
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page, context }) => {
    test.setTimeout(1_800_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join("\n")).toEqual([]);
    reportCollected();
  });
}
