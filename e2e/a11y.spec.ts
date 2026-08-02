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

  // Exhibit 2 — CPA (also exercise the sliders, freeze, and the export status)
  await page.locator("#cpa-traces").fill("2500");
  await page.locator("#cpa-noise").fill("30");
  await page.locator("#cpa-run").click();
  await expect(page.locator("#cpa-verdict")).not.toBeEmpty();
  await page.locator("#cpa-freeze").click();
  await expect(page.locator("#cpa-repro-status")).not.toBeEmpty();

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

  // Exhibit 7 — import: round-trip the example CSV so the result region gets scanned
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#import-example").click(),
  ]);
  await page.locator("#import-file").setInputFiles(await download.path());
  await expect(page.locator("#import-recovered")).not.toBeEmpty();

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

/**
 * SC 1.4.11 (non-text contrast): text-field boundaries must reach 3:1 against
 * the adjacent surface AND the field's own fill, in both themes. Panels here
 * are subtle gradients, so every gradient stop of the backdrop is checked as a
 * worst-case surface. Axe does not flag border-vs-surface, so this asserts it
 * directly from rendered computed styles.
 */
async function controlBorderContrasts(
  page: Page,
): Promise<Array<{ id: string; ratio: number }>> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    const parse = (s: string): C => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return { r: 0, g: 0, b: 0, a: 0 };
      const p = m[1].split(/[,\s/]+/).map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg: C, bg: C): C => {
      const a = fg.a + bg.a * (1 - fg.a);
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const lum = (c: C) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };
    /** Every opaque surface that can sit directly behind `el`. */
    const surfacesBehind = (el: Element): C[] => {
      const layers: C[] = [];
      const bases: C[] = [];
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const bg = parse(cs.backgroundColor);
        const grad = cs.backgroundImage && cs.backgroundImage !== "none";
        if (grad) {
          for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) {
            const stop = parse(m[0]);
            if (stop.a >= 1) bases.push(stop);
          }
          if (bases.length) break;
        }
        if (bg.a > 0) {
          if (bg.a >= 1) {
            bases.push(bg);
            break;
          }
          layers.push(bg);
        }
      }
      if (bases.length === 0) bases.push({ r: 255, g: 255, b: 255, a: 1 });
      return bases.map((b) => {
        let out = b;
        for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
        return out;
      });
    };
    const out: Array<{ id: string; ratio: number }> = [];
    document
      .querySelectorAll<HTMLElement>('select, textarea, input[type="text"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.borderTopWidth) === 0) return;
        const borderRaw = parse(cs.borderTopColor);
        const fillRaw = parse(cs.backgroundColor);
        let worst = Infinity;
        for (const surface of surfacesBehind(el)) {
          const fill = fillRaw.a > 0 ? over(fillRaw, surface) : surface;
          const border = over(over(borderRaw, fill), surface);
          worst = Math.min(worst, ratio(border, surface), ratio(border, fill));
        }
        out.push({ id: el.id || el.tagName.toLowerCase(), ratio: worst });
      });
    return out;
  });
}

async function assertControlBorders(page: Page): Promise<void> {
  const results = await controlBorderContrasts(page);
  expect(results.length).toBeGreaterThan(0);
  for (const { id, ratio } of results) {
    expect(ratio, `#${id} border contrast`).toBeGreaterThanOrEqual(3);
  }
}

test("text-field borders reach 3:1 — dark theme (SC 1.4.11)", async ({ page }) => {
  await page.goto(".");
  await page.waitForSelector("#spa-exp");
  await assertControlBorders(page);
});

test("text-field borders reach 3:1 — light theme (SC 1.4.11)", async ({ page }) => {
  await page.goto(".");
  await page.locator("#cl-theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForSelector("#spa-exp");
  await assertControlBorders(page);
});

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
