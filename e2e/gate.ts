import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { auditContrast, formatContrastFailures } from "./contrast";
import { auditNonText, formatNonTextFailures } from "./nontext";

export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Rules to run ALONGSIDE the WCAG tags, by id.
 *
 * The four landmark rules are axe "best-practice" rather than WCAG-tagged, and
 * this page is the shape they catch: a `<header role="banner">` above a `<div
 * id="app">` whose `<main>` opens with a SECOND `<header>` containing an
 * `<aside role="complementary">`.
 *
 * `label-content-name-mismatch` is SC 2.5.3 (Label in Name, WCAG 2.1 A) and axe
 * ships it flagged `experimental`, which means a default run does not execute it
 * at all. It is enabled explicitly below because this lab has three controls
 * whose visible `<label>` and `aria-label` were written separately, which is
 * exactly the shape 2.5.3 exists for.
 */
export const EXTRA_RULES = [
  "landmark-no-duplicate-banner",
  "landmark-unique",
  "landmark-one-main",
  "landmark-complementary-is-top-level",
  "label-content-name-mismatch",
];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Six things the gate this replaces (`e2e/a11y.spec.ts`) did, each corrected
 * here:
 *
 *  1. IT INJECTED MOTION SUPPRESSION. `killMotion()` pushed
 *     `animation:none!important; transition:none!important;
 *     scroll-behavior:auto!important` through `addStyleTag`, which BYPASSES this
 *     stylesheet's own `@media (prefers-reduced-motion: reduce)` block instead of
 *     exercising it. The two happen to be identical here — the block declares
 *     those same three properties and nothing else — but that is a fact about
 *     the stylesheet, and the whole class of defect this guards against is a
 *     reduced-motion block that cancels an animation without restoring its end
 *     state. `boot` asks for the preference and ASSERTS it took effect;
 *     `expectNotBlank` then measures the end state in every driven state.
 *
 *  2. IT FORCE-OPENED EVERY `<details>` FROM SCRIPT, with
 *     `d.open = true` over `document.querySelectorAll("details")`. Those
 *     disclosures hold the DATA TABLES that are the accessible text alternative
 *     to all seven `<canvas>` figures — the only form of this lab's output that
 *     any contrast oracle can read at all. Opening them by assignment skips the
 *     `<summary>` a reader has to operate, and it opened them once, at the very
 *     end. This gate clicks each summary, and scans with them shut as well as
 *     open, because a closed disclosure is the state a reader arrives at.
 *
 *  3. IT SCANNED ONCE, AFTER THE WHOLE DRIVE. `driveDemos()` ran all seven
 *     exhibits — SPA, CPA at 2500 traces, the noise sweep, misalignment defend
 *     AND defeat, DPA-vs-CPA, masking, and a CSV round trip — and only then
 *     called `scan()`. Every state it built was overwritten before anything
 *     measured it. The misalignment "Attack blocked" verdict in particular is
 *     painted `.indicator.held` with `--warn` ink on a 12% warn tint, and the
 *     very next line of the drive replaced it with the `.alarm` rendering. This
 *     drive scans after every single step.
 *
 *  4. IT SCANNED ONE VIEWPORT. There was no `setViewportSize` anywhere, so
 *     WCAG 1.4.10 had never been asked about this page. `main` is a
 *     `display: grid` with no `grid-template-columns`, which is an implicit
 *     `auto` track taking a min-content minimum, and every panel is a grid item
 *     — so one wide panel sizes the whole page's column.
 *
 *  5. `violations` WAS THE ONLY ORACLE. `scan()` asserted `results.violations`
 *     and nothing else — not `incomplete`, not contrast arithmetically, not
 *     non-text contrast, not reflow, not keyboard reachability. On this page
 *     `incomplete` is where the real answers are: every `.panel` is a
 *     `linear-gradient`, so axe declines to resolve the backdrop of essentially
 *     every word on the page.
 *
 *  6. ITS 1.4.11 CHECK POINTED AT THE ONE PLACE THE RULE WAS ALREADY KEPT.
 *     `controlBorderContrasts()` queried `select, textarea, input[type="text"]`.
 *     `--control-border` — the token whose own comment says "text-field
 *     boundary: >=3.9:1 on panels and field fill (SC 1.4.11)" — is applied to
 *     exactly one rule, `input[type="text"]`, and there is no `<select>` or
 *     `<textarea>` on this page. So the check measured the two text inputs the
 *     correct token was already on, and could not fail. Every BUTTON, both
 *     range sliders, the file input and the four radios went unmeasured.
 *     `nontext.ts` measures all of them, and every `::before`/`::after` too.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead. This also absorbs the
 * `requestAnimationFrame` the CPA slider handler schedules its re-render on, so
 * a scan never lands between a slider move and the redraw it triggered.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === "running");
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: "raf" },
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state.
 *
 * This page cannot currently be in that shape, and the assertion is what makes
 * that a MEASUREMENT rather than a reading: `styles/main.css` contains no
 * `@keyframes` and no `animation` shorthand, and its only `opacity` declaration
 * is `button:disabled { opacity: 0.55 }`. The check runs in every state anyway,
 * because all of those are properties of the current stylesheet rather than of
 * the page, and this is the cheapest place to catch the first exception.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Nothing inside `#app` may be `aria-hidden`.
 *
 * `aria-hidden` is the shared blind spot: axe's `color-contrast` rule skips it
 * and so does the arithmetic walk in `contrast.ts`, by design, because neither
 * exists to be stricter than the other on decorative content. That makes it the
 * one place a live readout can hide from an entire accessibility gate — and this
 * page is full of live readouts, every one of them a recovered key byte, a rank,
 * a correlation or a security verdict.
 *
 * The lab currently hides nothing of its own; the only `aria-hidden` elements in
 * the document are the shared top bar's two SVG glyphs, which is why the
 * assertion is scoped to `#app`. Asserting it in every driven state is what
 * keeps the two oracles' shared exclusion from quietly starting to cover
 * something.
 */
async function expectNothingAriaHidden(page: Page, label: string): Promise<void> {
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#app [aria-hidden="true"]')).map((el) => {
      const cls = el.getAttribute("class");
      return (
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        (cls ? `.${cls.trim().split(/\s+/).join(".")}` : "")
      );
    }),
  );
  expect(hidden, `nothing in #app may be aria-hidden in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page is
 * created. A renderer that throws halfway through leaves an earlier state on
 * screen, and a gate that scans that state reports green for a page that is
 * broken.
 *
 * That is a live risk here rather than a theoretical one: every exhibit runs
 * thousands of trace generations and a 256-guess correlation on the main thread,
 * and each writes its whole result panel with `replaceChildren`. A throw
 * anywhere inside one leaves the PREVIOUS panel rendered and entirely plausible.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark: the shared bar.
 *
 * `initUi()` deliberately builds the hero `<header class="cl-hero">` INSIDE
 * `<main>`, which scopes it out of the banner role on its own, and
 * `index.html`'s `dedupeBanner()` skips it for that reason. Asserting the
 * OUTCOME rather than either mechanism means a change to the nesting is caught
 * too — and the nesting is a one-line decision in `initUi` that would be easy to
 * undo.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(["MAIN", "ARTICLE", "ASIDE", "NAV", "SECTION"]);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute("role") === "banner") return true;
      if (el.tagName !== "HEADER") return false;
      if (el.getAttribute("role")) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, "exactly one banner landmark").toBe(1);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really there — including the LAB'S
 * DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then asserted
 * from inside the page.
 *
 * The theme is seeded through `localStorage` rather than by clicking the toggle,
 * which also pins down a real failure mode: `index.html`'s anti-flash script
 * reads `localStorage.getItem('theme')` and the shared bar's toggle writes
 * `localStorage.setItem('theme', …)`. If those keys drift apart the theme
 * silently stops persisting, and this boot fails on `data-theme` rather than
 * quietly scanning dark twice.
 *
 * TWO OF THE SEVEN EXHIBITS HAVE ALREADY RUN AT FIRST PAINT, and that is the
 * default that matters most here. `spaSection` and `cpaSection` each end with
 * `queueMicrotask(run)`, so the page a reader arrives at already shows an SPA
 * trace read off to bits and a full 256-guess CPA at 400 traces — while the
 * other five exhibits are empty and their `.status-region`s are collapsed by
 * `:empty { display: none }`. A gate that only ever measured the fully-driven
 * page never measured either half of that.
 */
export async function boot(page: Page, theme: "dark" | "light"): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(".");
  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    "reduced-motion emulation must actually be in effect",
  ).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

  // `#app` ships EMPTY in index.html and every element below is built by
  // `initUi()`, so a navigation that resolves proves nothing at all.
  await expect(page.locator("#app main > section.panel")).toHaveCount(9);
  await assertSingleBanner(page);

  // ── The two exhibits that have already run ───────────────────────────────
  await expect(page.locator("#spa-status")).not.toBeEmpty();
  await expect(page.locator("#spa-bits .bit-cell")).toHaveCount(9);
  await expect(page.locator("#cpa-verdict")).not.toBeEmpty();
  await expect(page.locator("#cpa-recovered .byte-box")).toHaveCount(1);

  // ── The five that have not ───────────────────────────────────────────────
  for (const sel of ["#noise-status", "#align-status", "#dpacpa-status", "#import-status"]) {
    await expect(page.locator(sel)).toBeEmpty();
    // `.status-region:empty { display: none }` — the empty state is a COLLAPSED
    // region, not an empty box, and that is what a reader meets.
    await expect(page.locator(sel)).toBeHidden();
  }
  await expect(page.locator("#align-verdict")).toBeEmpty();
  await expect(page.locator("#cm-verdict")).toBeEmpty();
  await expect(page.locator("#cpa-repro-status")).toBeHidden();

  // ── Every shipped control default ────────────────────────────────────────
  await expect(page.locator("#spa-exp")).toHaveValue("0b110101101");
  await expect(page.locator("#cpa-traces")).toHaveValue("400");
  await expect(page.locator("#cpa-noise")).toHaveValue("30");
  await expect(page.locator("#cpa-seed")).toHaveValue("1234");
  await expect(page.locator("#cpa-traces-val")).toHaveText("400");
  await expect(page.locator("#cpa-noise-val")).toHaveText("3.0");
  // The countermeasure radio group ships on the BASELINE, so the "defended"
  // renderings — including the only `.indicator.held` in Exhibit 6 — exist only
  // once the drive selects them.
  await expect(page.locator("#cm-none")).toBeChecked();
  for (const sel of ["#cm-masking", "#cm-shuffling", "#cm-hiding"]) {
    await expect(page.locator(sel)).not.toBeChecked();
  }

  // Every data table ships SHUT. The gate this replaces set `.open = true` on
  // all of them from script; here the count is asserted so that a table which
  // stops shipping shut is noticed rather than absorbed.
  await expect(page.locator("details.data")).toHaveCount(2); // SPA + CPA have run
  await expect(page.locator("details[open]")).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling (WCAG 1.4.10).
 *
 * axe has no rule for this at all, and the gate this replaces never opened a
 * narrow viewport, so nothing in this repo had ever asked the question. The page
 * is the shape that breaks it: `main` is a `display: grid` with no
 * `grid-template-columns`, so every panel is a grid item in an implicit `auto`
 * track whose automatic minimum size is its min-content — meaning ONE wide panel
 * sizes the whole page's column. The wide candidates are the five data tables,
 * the `.recovered` and `.bit-read` rows, and the long `code` spans.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. Every
    // `.tablewrap` on this page is exactly that decoy.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll("body *"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    const name = (el: Element): string => {
      const cls = el.getAttribute("class");
      return (
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        (cls ? `.${cls.trim().split(/\s+/).join(".")}` : "")
      );
    };
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? "[clipped] " : ""}${name(widest.el)} @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : "(none identified)",
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * `<body>` must not clip its own overflow (a guard on the fix, not a checker).
 *
 * `overflow` set on `<body>` propagates to the VIEWPORT when `<html>` is
 * `overflow: visible`, so `documentElement.scrollWidth === clientWidth` becomes
 * true no matter how wide the content is — and the reflow assertion above turns
 * into one that can never fail. It also does not make anything fit: it CLIPS,
 * and clipped content is unreachable, which under 1.4.10 is strictly worse than
 * a scrollbar.
 *
 * This stylesheet does not do it today. The assertion exists because it is the
 * standard "fix" for a reflow failure and would silently disable the oracle that
 * found the failure in the first place.
 */
export async function expectReflowFalsifiable(page: Page): Promise<void> {
  const clipping = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    const h = getComputedStyle(document.documentElement);
    return { bodyX: b.overflowX, bodyY: b.overflowY, htmlX: h.overflowX, htmlY: h.overflowY };
  });
  expect(
    clipping,
    "overflow on <body> propagates to the viewport and makes the reflow check unfalsifiable",
  ).toEqual({ bodyX: "visible", bodyY: "visible", htmlX: "visible", htmlY: "visible" });
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * `ui.ts` already builds every `.tablewrap` with `role="region"`, `tabindex="0"`
 * and an `aria-label`, and it is the only route by which a wide table reaches
 * this page. The assertion stays because that is a convention rather than an
 * enforcement, and because those tables are the accessible alternative to all
 * seven canvas figures — the single piece of this lab's output a screen-reader
 * or high-zoom user has.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el.getAttribute("class") ?? "").trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`,
  ).toEqual([]);
}

/**
 * Every visible `tabindex="0"` region on the page right now, as a descriptor.
 *
 * The `aria-label` is part of the descriptor, not decoration: all three of this
 * page's focusable regions are `div.tablewrap` with no id, so a class-only name
 * collapses them into one indistinguishable entry and any set-based assertion
 * about "did we reach all of them" becomes vacuous.
 */
async function focusableRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[tabindex="0"]'))
      .filter((el) => el.checkVisibility?.())
      .map((el) => {
        const cls = el.getAttribute("class");
        const label = el.getAttribute("aria-label");
        return (
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (cls ? `.${cls.trim().split(/\s+/).join(".")}` : "") +
          (label ? ` [${label}]` : "")
        );
      }),
  );
}

/**
 * Every `tabindex="0"` region must show a focus indicator when a keyboard
 * actually reaches it (WCAG 2.4.7).
 *
 * IT WALKS THE REAL TAB ORDER, and that is the whole point. A scripted
 * `el.focus()` cannot answer this question: Chromium only applies
 * `:focus-visible` STYLING when the focus arrived through a keyboard-ish route,
 * so a programmatic focus leaves the element matching `:focus-visible` to
 * `Element.matches()` while the style engine still paints the plain default
 * ring. Elsewhere in this sweep that artefact produced a confident, wrong
 * finding in every driven state. Pressing Tab is not a convenience here; it is
 * the only way to measure the thing being asserted.
 *
 * Run once per configuration rather than per state: focus styling is a property
 * of the stylesheet, not of the driven state, and a tab walk costs a round trip
 * per stop. What IS re-checked in every state is the SET of focusable regions —
 * see `expectNoUnverifiedFocusRegions` — which matters on this page, because
 * every `.tablewrap` is created by running an exhibit and none of them exists at
 * boot.
 */
export async function verifyFocusIndicators(page: Page): Promise<Set<string>> {
  // No assertion that this is non-empty. It legitimately IS empty at boot: every
  // focusable region on this page is a `.tablewrap` living inside a
  // `<details class="data">` that ships SHUT, and `checkVisibility()` is false
  // for a closed disclosure's subtree. The "did we actually measure anything"
  // guard is at the end of `driveAllStates` instead, where it can name the
  // number of regions the whole drive reached.
  const wanted = new Set(await focusableRegions(page));
  if (wanted.size === 0) return new Set<string>();

  await page.evaluate(() => {
    const b = document.body;
    b.setAttribute("tabindex", "-1");
    b.focus();
    b.removeAttribute("tabindex");
  });

  const verified = new Set<string>();
  const bad: string[] = [];
  for (let i = 0; i < 120 && verified.size < wanted.size; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.getAttribute("tabindex") !== "0") return null;
      const cs = getComputedStyle(el);
      const cls = el.getAttribute("class");
      const label = el.getAttribute("aria-label");
      return {
        // MUST match `focusableRegions` exactly, aria-label included. It did not
        // at first, and the mismatch was silent in the worst way: `wanted` held
        // "div.tablewrap [SPA operation sequence]" while the walk recorded
        // "div.tablewrap", so nothing ever matched, the early exit never fired,
        // and the check reported that a region the walk had in fact focused was
        // "never reached".
        sel:
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (cls ? `.${cls.trim().split(/\s+/).join(".")}` : "") +
          (label ? ` [${label}]` : ""),
        width: parseFloat(cs.outlineWidth || "0"),
        style: cs.outlineStyle,
        shadow: cs.boxShadow,
      };
    });
    if (!hit) continue;
    verified.add(hit.sel);
    const outlined = hit.style !== "none" && hit.width >= 1;
    if (!outlined && hit.shadow === "none") {
      bad.push(`${hit.sel} — outline ${hit.width}px ${hit.style}, box-shadow ${hit.shadow}`);
    }
  }
  expect(bad, "focusable regions with no visible focus indicator under real keyboard focus").toEqual(
    [],
  );
  expect(
    Array.from(wanted).filter((w) => !verified.has(w)),
    "focusable regions the tab walk never reached",
  ).toEqual([]);
  return verified;
}

/**
 * No driven state may introduce a focusable region whose indicator was never
 * measured. Cheap enough to run in every scan, and it is what keeps the
 * once-per-configuration tab walk honest.
 */
export async function expectNoUnverifiedFocusRegions(
  page: Page,
  verified: Set<string>,
  label: string,
): Promise<void> {
  const present = await focusableRegions(page);
  expect(
    Array.from(new Set(present.filter((p) => !verified.has(p)))),
    `focusable regions with no verified focus indicator in state: ${label}`,
  ).toEqual([]);
}

/**
 * SC 2.5.3 (Label in Name) for FORM FIELDS — the half axe cannot see.
 *
 * axe's `label-content-name-mismatch` only applies to roles that take their name
 * from their own content: buttons, links, headings. A `<input>` never does, so
 * the rule skips every text field, range slider, radio and file input on this
 * page — and those are exactly where the mismatch arises here, because each one
 * was given BOTH a visible `<label for>` and a separately-worded `aria-label`,
 * and `aria-label` wins.
 *
 * The failure is not cosmetic. A speech-input user says what they can see; if
 * the visible words are not in the accessible name, the command does not match
 * the control. So: for every form field that has a visible `<label>`, the
 * label's text must appear inside the computed accessible name.
 *
 * Comparison is whitespace-normalised and case-insensitive, which is what the
 * success criterion asks for. Punctuation is NOT normalised away — a name that
 * rewords the visible label is the failure, and stripping punctuation would let
 * some of those through.
 */
export async function expectLabelInName(page: Page, label: string): Promise<void> {
  const mismatches = await page.evaluate(() => {
    const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("#app input, #app select, #app textarea"),
    )) {
      if (!el.checkVisibility?.()) continue;
      // The visible label: an explicit `for=`, or an ancestor <label>.
      const explicit = el.id
        ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`)
        : null;
      const visibleLabel = explicit ?? el.closest("label");
      if (!visibleLabel) continue;
      const visible = norm(visibleLabel.textContent ?? "");
      if (!visible) continue;

      // The accessible name, in the order the accname spec resolves it.
      const ariaLabelledby = el.getAttribute("aria-labelledby");
      const fromIds = ariaLabelledby
        ? ariaLabelledby
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
        : "";
      const name = norm(fromIds || el.getAttribute("aria-label") || visible);
      if (!name.includes(visible)) {
        out.push(
          `${el.tagName.toLowerCase()}#${el.id} — visible "${visible}" is not contained in the accessible name "${name}"`,
        );
      }
    }
    return out;
  });
  expect(mismatches, `SC 2.5.3 label-in-name failures in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run with it
 * set prints every finding as it happens and then FAILS at the end via
 * `reportCollected()`, so a green collection run cannot be mistaken for a green
 * gate.
 */
// Reached through `globalThis` rather than a bare `process`, because this
// repo's tsconfig includes `e2e` and its `types` field is `["vite/client"]` —
// there is no `@types/node`, and adding one for a debugging flag would be a
// dependency the gate does not need.
const COLLECTING = !!(globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

/** Run a throwing async assertion, collecting instead when `A11Y_COLLECT` is set. */
async function soft(label: string, fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    record(`${label}\n  ${String(e).slice(0, 900)}`);
  }
}

/**
 * The focusable regions whose indicator has been measured under a real keyboard
 * Tab, refreshed by `driveAllStates` as exhibits create new `.tablewrap`s.
 */
let verifiedFocusRegions = new Set<string>();

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array — which is all the gate this
 * replaces looked at — is not a complete oracle:
 *
 *  - reduced-motion end state (`expectNotBlank`).
 *  - nothing in `#app` is `aria-hidden` (`expectNothingAriaHidden`), which is the
 *    one exclusion both contrast oracles share.
 *  - `violations`, over axe's FULL default rule set, filtered to the WCAG tags
 *    plus `EXTRA_RULES`.
 *  - `incomplete`, the "could not decide" bucket that never reaches
 *    `violations`. `color-contrast` is the one id allowed to stay there, because
 *    the next assertion computes those ratios arithmetically — and on this page
 *    that is nearly all of them, since every `.panel` is a `linear-gradient` axe
 *    declines to resolve. Everything ELSE in the bucket is a real result axe
 *    simply could not finish, including `aria-prohibited-attr`, where an
 *    `aria-label` on a role-less element hides.
 *  - arithmetic contrast: composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content: SC 1.4.11 plus every
 *    `::before`/`::after`. axe has no rule for either, and the text walk cannot
 *    reach either.
 *  - keyboard reachability of scrolling regions (WCAG 2.1.1), and a verified
 *    focus indicator on everything that reachability makes focusable (2.4.7).
 *  - reflow (WCAG 1.4.10), which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  await soft(`aria-hidden in ${label}`, () => expectNothingAriaHidden(page, label));

  // NOT `.withTags(TAGS).withRules(EXTRA_RULES)`. `AxeBuilder` maps both onto
  // the single `runOnly` option, so the second call OVERWRITES the first — its
  // own docblock says "Cannot be used with AxeBuilder#withTags". Measured
  // elsewhere in this sweep: chained that way a run executes 4 rules where a
  // default run executes 89, silently switching off the entire WCAG rule set.
  // So: run everything and filter the RESULTS. That is also strictly broader,
  // because a rule that gains a WCAG tag in a future axe release starts being
  // enforced without anyone editing a list.
  const results = await new AxeBuilder({ page })
    .options({ rules: { "label-content-name-mismatch": { enabled: true } } })
    .analyze();
  const inScope = (v: { id: string; tags: string[] }): boolean =>
    EXTRA_RULES.includes(v.id) || v.tags.some((t) => TAGS.includes(t));

  // THE SHARED TOP BAR IS EXCLUDED FROM SC 2.5.3, AS A DECISION.
  // `label-content-name-mismatch` fires on `.cl-brand` (visible "CRYPTO LAB
  // systemslibrarian.dev", accessible name "Crypto Lab home") and on
  // `#cl-theme-toggle` (visible "☀", name "Toggle color theme"). Both are in
  // `.cl-topbar`, which every repo in this catalog carries as a byte-identical
  // inline copy; the catalog's own instructions say a change every lab should
  // get is a reviewed pass across the repos, never an overwrite driven from one
  // of them. Reported upward instead. The exclusion is BY NODE, not by rule, so
  // the same rule still fires on anything inside `#app` — and the lab's own
  // 2.5.3 defects, which axe's rule does not reach at all because it skips form
  // fields, are covered by `expectLabelInName` below.
  const outsideSharedBar = (v: { id: string; nodes: { target: unknown[] }[] }) =>
    v.id !== "label-content-name-mismatch" ||
    v.nodes.some((n) => !/cl-brand|cl-theme-toggle|cl-btn|cl-topbar/.test(n.target.join(" ")));

  const violations = results.violations
    .filter(inScope)
    .filter(outsideSharedBar)
    .map((v) => ({
      state: label,
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 8),
    }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter(inScope)
    .filter(outsideSharedBar)
    .filter((v) => v.id !== "color-contrast")
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  const nonText = await auditNonText(page);
  expect(
    await page.locator("#app button:not([disabled])").count(),
    `no controls found to measure in state: ${label}`,
  ).toBeGreaterThan(0);
  softExpect(
    Array.from(new Set(formatNonTextFailures(nonText))),
    `non-text contrast / generated content failures (SC 1.4.11) in state: ${label}`,
    [],
  );

  await soft(`label-in-name in ${label}`, () => expectLabelInName(page, label));
  await soft(`scrollers in ${label}`, () => expectScrollersReachable(page, label));
  await soft(`focus regions in ${label}`, () =>
    expectNoUnverifiedFocusRegions(page, verifiedFocusRegions, label),
  );
  await soft(`reflow in ${label}`, async () => {
    await expectReflowFalsifiable(page);
    await expectNoHorizontalOverflow(page, label);
  });
}

// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Re-measure focus indicators after a step that can create a new focusable
 * region.
 *
 * Every `.tablewrap` on this page is built by running an exhibit, so the set of
 * `tabindex="0"` regions GROWS during the drive — unlike most labs, where it is
 * fixed at boot. Calling this after each exhibit keeps the per-state subset
 * assertion in `scan` meaningful instead of vacuous.
 */
async function refreshFocusRegions(page: Page): Promise<void> {
  const seen = verifiedFocusRegions;
  const fresh = await verifyFocusIndicators(page);
  verifiedFocusRegions = new Set([...seen, ...fresh]);
  // The walk leaves the sequential focus navigation starting point wherever it
  // stopped; put it back so a later Tab assertion means what it says.
  await page.evaluate(() => {
    const b = document.body;
    b.setAttribute("tabindex", "-1");
    b.focus();
    b.removeAttribute("tabindex");
  });
}

/** Open every visible shut `<details>` by clicking its own summary. */
async function openAllDisclosures(page: Page): Promise<number> {
  const shut = page.locator("details:not([open]) > summary:visible");
  let opened = 0;
  for (let n = await shut.count(); n > 0 && opened < 20; n = await shut.count()) {
    await shut.first().click();
    opened += 1;
  }
  await expect(page.locator("details:not([open]) > summary:visible")).toHaveCount(0);
  return opened;
}

/**
 * Drive the lab through every state it renders, scanning each.
 *
 * Six things shape this drive, and every one of them is a state the gate it
 * replaces never measured:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, and it is a mixed one: SPA and CPA have
 *    already run themselves, while the other five exhibits are empty and their
 *    `.status-region`s are collapsed by `:empty { display: none }`. The old gate
 *    ran all seven exhibits before its single scan, so neither half existed when
 *    anything looked.
 *
 *  - EVERY ERROR STATE. `#spa-exp` rejects a non-integer and prints a message
 *    instead of a trace; the CSV importer catches a parse failure and prints
 *    what it expected. Both are real renderings a reader reaches by typing or by
 *    dropping the wrong file, and neither had ever been scanned.
 *
 *  - THE EXTREMES OF EVERY SLIDER, NOT THE DEFAULTS. `#cpa-traces` at its
 *    minimum is the only route to the "Not yet recovered" `.indicator.neutral`
 *    and the `.byte-box.pending` grey; at its maximum, and with `#cpa-noise`
 *    driven to both ends, the rendering flips to `.indicator.alarm` and
 *    `.byte-box.leaked`. Those are different inks on different tinted fills, and
 *    which one a single-configuration gate sees is decided by the shipped
 *    default.
 *
 *  - EVERY BRANCH OF EVERY FORK. Misalignment is driven DEFEND (the only
 *    `.indicator.held` in Exhibit 4) and then DEFEAT. All four countermeasure
 *    radios are run, because masking is the only one that produces `held` and
 *    the only one that renders the second-order caveat. The old gate ran exactly
 *    one of the four.
 *
 *  - THE DISCLOSURES ARE OPENED THROUGH THEIR SUMMARIES, and scanned shut as
 *    well as open. They hold the data tables that are the accessible alternative
 *    to all seven canvas figures.
 *
 *  - NO FIXED TIMEOUTS. Every exhibit is real work on the main thread and every
 *    one has a DOM completion signal — a status region gaining text, a verdict
 *    changing class, a table appearing. The drive waits on those. (The old drive
 *    ended on `waitForTimeout(300)`.)
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await refreshFocusRegions(page);
  await scanAt("first paint: SPA and CPA already run, five exhibits empty");

  await page.keyboard.press("Tab");
  await expect(page.locator("a.cl-skip-link")).toBeFocused();
  await scanAt("skip link focused");

  // ── Exhibit 1 — SPA, including its error branch ─────────────────────────
  await page.fill("#spa-exp", "not a number");
  await page.click("#spa-run");
  await expect(page.locator("#spa-status")).toHaveText(/Enter a non-negative integer/);
  await scanAt("SPA rejects a non-integer exponent");

  await page.fill("#spa-exp", "-1");
  await page.click("#spa-run");
  await expect(page.locator("#spa-status")).toHaveText(/Enter a non-negative integer/);
  await scanAt("SPA rejects a negative exponent");

  // A wider exponent than the default, which is also the widest `.bit-read` row
  // the page can produce and therefore the reflow worst case for this panel.
  await page.fill("#spa-exp", "0b11111111111111");
  await page.click("#spa-run");
  await expect(page.locator("#spa-bits .bit-cell")).toHaveCount(14);
  await expect(page.locator("#spa-bits .bit-cell.one")).toHaveCount(14);
  await expect(page.locator("#spa-status")).toContainText("Matches the secret exponent exactly");
  await scanAt("SPA read off a 14-bit exponent, every bit a 1");

  await openAllDisclosures(page);
  await refreshFocusRegions(page);
  // 14 bits: a square for each, plus a multiply for each of the 14 ones, minus
  // the leading bit that seeds the accumulator — 28 operations, asserted so the
  // table alternative is known to hold the whole trace and not a truncation.
  await expect(page.locator("#spa-table .tablewrap table tbody tr")).toHaveCount(28);
  await scanAt("SPA and CPA data tables open");

  // ── Exhibit 2 — CPA at both ends of both sliders ────────────────────────
  await page.locator("#cpa-traces").fill("10");
  await expect(page.locator("#cpa-traces-val")).toHaveText("10");
  await expect(page.locator("#cpa-verdict")).toHaveClass(/neutral/);
  await expect(page.locator("#cpa-recovered .byte-box.pending")).toBeVisible();
  await expect(page.locator("#cpa-verdict")).toContainText("Not yet recovered");
  await scanAt("CPA at 10 traces: not yet recovered, the neutral verdict");

  await page.locator("#cpa-traces").fill("5000");
  await expect(page.locator("#cpa-traces-val")).toHaveText("5000");
  await expect(page.locator("#cpa-verdict")).toHaveClass(/alarm/);
  await expect(page.locator("#cpa-recovered .byte-box.leaked")).toBeVisible();
  await expect(page.locator("#cpa-verdict")).toContainText("Key byte leaked");
  await scanAt("CPA at 5000 traces: key byte leaked, the alarm verdict");

  await page.locator("#cpa-noise").fill("120");
  await expect(page.locator("#cpa-noise-val")).toHaveText("12.0");
  await scanAt("CPA at maximum noise");

  await page.locator("#cpa-noise").fill("5");
  await expect(page.locator("#cpa-noise-val")).toHaveText("0.5");
  await scanAt("CPA at minimum noise");

  await page.fill("#cpa-seed", "99");
  await page.locator("#cpa-seed").blur();
  await expect(page.locator("#cpa-recovered .byte-box")).toBeVisible();
  await scanAt("CPA re-seeded with an independent trace set");

  // ── Exhibit 2 — the reproducibility controls ────────────────────────────
  await page.click("#cpa-freeze");
  await expect(page.locator("#cpa-repro-status")).toContainText("Froze the current curve");
  await scanAt("a baseline curve frozen, the repro status region revealed");

  await page.click("#cpa-clear-frozen");
  await expect(page.locator("#cpa-repro-status")).toHaveText("Cleared the frozen baseline.");
  await scanAt("frozen baseline cleared");

  await page.click("#cpa-link");
  await expect(page.locator("#cpa-repro-status")).toContainText(/Copied a permalink|Permalink:/);
  await scanAt("permalink copied to the clipboard");

  for (const [btn, expected] of [
    ["#cpa-json", "Downloaded the result as JSON"],
    ["#cpa-csv", "Downloaded the per-guess correlations as CSV"],
  ] as const) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(btn)]);
    expect(await dl.failure(), `${btn} must produce a real download`).toBeNull();
    await expect(page.locator("#cpa-repro-status")).toContainText(expected);
    await scanAt(`export via ${btn}`);
  }

  // ── Exhibit 3 — the noise sweep ─────────────────────────────────────────
  await page.click("#noise-run");
  await expect(page.locator("#noise-status")).toContainText("only raised the price", {
    timeout: 120_000,
  });
  await expect(page.locator("#noise-table .tablewrap table tbody tr")).toHaveCount(7);
  await refreshFocusRegions(page);
  await scanAt("noise sweep complete, its table shut");

  await openAllDisclosures(page);
  // AFTER the open, not before. A `.tablewrap` inside a shut `<details>` fails
  // `checkVisibility()`, so verifying focus indicators while it is still closed
  // verifies nothing and the next scan then reports it as an unverified region.
  await refreshFocusRegions(page);
  await scanAt("noise-cost table open");

  // ── Exhibit 4 — misalignment: defend, then defeat ───────────────────────
  await page.click("#align-run");
  await expect(page.locator("#align-verdict")).toHaveClass(/held/, { timeout: 60_000 });
  await expect(page.locator("#align-verdict")).toContainText("Attack blocked");
  await expect(page.locator("#align-status")).toContainText("Resync & re-attack");
  await scanAt("misalignment defends: the HELD verdict, on its warn tint");

  await page.click("#align-fix");
  await expect(page.locator("#align-verdict")).toHaveClass(/alarm/, { timeout: 60_000 });
  await expect(page.locator("#align-verdict")).toContainText("Defense defeated");
  await scanAt("resync defeats it: the ALARM verdict, on its danger tint");

  // ── Exhibit 5 — DPA vs CPA ──────────────────────────────────────────────
  await page.click("#dpacpa-run");
  await expect(page.locator("#dpacpa-status")).toContainText("Same measurements, two statistics", {
    timeout: 120_000,
  });
  await scanAt("DPA raced against CPA on the same measurements");

  // ── Exhibit 6 — every countermeasure, not one ───────────────────────────
  for (const [id, mode, cls, text] of [
    ["#cm-none", "baseline", /alarm/, "Key byte leaked"],
    ["#cm-masking", "Boolean masking", /held/, "First-order CPA defeated"],
    ["#cm-shuffling", "shuffling", /alarm/, "Recovered anyway"],
    ["#cm-hiding", "hiding", /alarm/, "Recovered anyway"],
  ] as const) {
    await page.check(id);
    await expect(page.locator(id)).toBeChecked();
    await page.click("#cm-run");
    await expect(page.locator("#cm-verdict")).toHaveClass(cls, { timeout: 60_000 });
    await expect(page.locator("#cm-verdict")).toContainText(text);
    await scanAt(`countermeasure: ${mode}`);
  }
  // Masking is the only mode that renders the second-order caveat; leave the
  // page on it so the caveat is the state the import exhibit is scanned beside.
  await page.check("#cm-masking");
  await page.click("#cm-run");
  await expect(page.locator("#cm-note")).toContainText("Second-order attacks");
  await scanAt("masking's honest second-order caveat");

  // ── Exhibit 7 — import, both the success and the failure branch ─────────
  const [example] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#import-example"),
  ]);
  await expect(page.locator("#import-status")).toContainText("Downloaded a 400-trace example CSV");
  await scanAt("example CSV offered for download");

  const csvPath = await example.path();
  await page.setInputFiles("#import-file", csvPath);
  await expect(page.locator("#import-recovered .byte-box")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#import-status")).toContainText("imported traces");
  await scanAt("imported CSV attacked: a top CANDIDATE, never asserted as recovered");

  // The parse-failure branch. `parseTracesCsv` throws and `handleFile` catches,
  // printing what it expected — a real rendering, reached by dropping the wrong
  // file, that no gate here had ever scanned.
  // Built in the page rather than passed as a Node `Buffer`, for the same
  // tsconfig reason as above. It is the same `change` event a file picker fires,
  // on the same input, carrying a real `File` — not a reach into app state.
  await page.evaluate(() => {
    const input = document.getElementById("import-file") as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File(["this is not a trace file\n"], "not-traces.csv", { type: "text/csv" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#import-status")).toContainText("Could not read that file");
  await scanAt("importer rejects a malformed CSV and says what it expected");

  // ── Everything open, everything populated ───────────────────────────────
  await openAllDisclosures(page);
  await refreshFocusRegions(page);
  await scanAt("the finished page with every data table open");

  // The drive must have MEASURED a focus indicator on every scrolling region
  // this lab can produce. All three are `.tablewrap`s created by running an
  // exhibit and hidden inside a shut `<details>` until it is opened, so "zero
  // regions verified" is a plausible-looking outcome of a drive that quietly
  // stopped reaching them — which is exactly the failure this whole exercise is
  // about.
  expect(
    Array.from(verifiedFocusRegions).sort(),
    "every .tablewrap must have had its focus indicator measured under a real Tab",
  ).toEqual([
    "div.tablewrap [CPA candidate ranking]",
    "div.tablewrap [Noise cost table]",
    "div.tablewrap [SPA operation sequence]",
  ]);
}
