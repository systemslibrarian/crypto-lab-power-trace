# What Would Make This the Gold Standard

## Bottom Line

This repo is already closer to "gold standard" than most educational crypto demos. The big reasons are clear technical honesty, real cryptographic and statistical machinery, meaningful tests, a working accessibility gate, and a deploy pipeline that refuses to ship if the baseline breaks.

What keeps it from being the gold standard is not the core attack logic. The missing step is turning a very strong demo into a fully reproducible, citation-backed, behavior-verified teaching artifact that can stand up equally well to students, engineers, accessibility reviewers, and side-channel practitioners.

## What Is Already Strong

- The scope is honest. The README and UI are explicit that the traces are simulated while the AES, leakage target, and statistics are real.
- The implementation is not toy crypto. AES is hand-rolled and backed by FIPS-197 known-answer tests.
- The attack pipeline is substantive. CPA, DPA, SPA, masking, shuffling, hiding, and alignment are present as actual code rather than presentation-only animations.
- Verification is better than typical demo repos. Unit tests cover the core claims, the build is typechecked, and Playwright + axe enforces WCAG A/AA in both themes.
- Deployment quality is disciplined. The Pages workflow runs tests, build, browser install, and accessibility checks before deploy.

## Verified Current Baseline

Validated locally on 2026-07-17:

- `npm test`: 37/37 tests passing
- `npm run build`: passing, exit code 0
- `npm run test:a11y`: 2/2 Playwright accessibility tests passing

## What Would Actually Make It Gold Standard

### 1. Add Reproducibility That Extends Beyond the Source Code

Right now the code is deterministic internally, but the repo does not yet make reproducibility a first-class user feature.

Highest-value additions:

- Expose the trace-generation seed in the UI.
- Add shareable permalinks for the current lab state: trace count, noise, countermeasure, jitter, target byte, seed, and theme.
- Add export/import for traces and results in JSON or CSV.
- Add a "reproduce this figure" action for each major chart so the README claims can be regenerated from documented settings.

Why this matters:

- It upgrades the project from a convincing demo to a reproducible experiment.
- It makes bugs and regressions easier to isolate.
- It lets teachers and reviewers cite exact parameter settings instead of screenshots.

### 2. Add Behavior-Level End-to-End Tests, Not Just Accessibility Tests

The current Playwright coverage is strong for accessibility, but it is not yet verifying the core user-visible learning outcomes.

To reach gold standard, add E2E assertions for:

- CPA actually recovering the correct byte under documented "should succeed" settings.
- CPA failing under intentionally hard settings and recovering when traces increase.
- Jitter breaking CPA and resynchronization restoring it.
- Masking suppressing first-order recovery while shuffling and hiding only increase trace cost.
- Theme toggle persistence across reload.
- Mobile viewport layout sanity for the major panels.

Why this matters:

- The repo already tests the algorithms in isolation.
- Gold standard means the shipped interface is also verified to teach the intended result.

### 3. Split CI from Deployment and Run It on Pull Requests

The existing workflow is good, but it is deploy-oriented and only triggers on pushes to `main` or manual dispatch.

Gold-standard improvement:

- Add a dedicated CI workflow for `pull_request` and `push` that runs unit tests, build, and a11y.
- Keep deployment as a separate workflow that depends on CI success.
- Publish artifacts for failed Playwright runs so regressions are diagnosable.

Why this matters:

- It catches regressions before merge instead of at deploy time.
- It makes review quality materially better.
- It aligns the repo with how serious educational and research demos are maintained.

### 4. Back Every Major Claim With a Citation or a Derivation Appendix

The repo explains the attacks well, but gold standard requires a stronger bridge between implementation and primary sources.

Add:

- A short references section in the README.
- A technical appendix covering the exact Pearson correlation formula, DPA difference-of-means setup, Hamming-weight leakage model, and alignment method.
- Explicit citations to FIPS-197, Kocher-Jaffe-Jun 1999, and Brier-Clavier-Olivier 2004.
- A section distinguishing what is pedagogically simplified from what is standard practice in real labs.

Why this matters:

- It increases trust with experts.
- It gives advanced readers a path from intuition to formal grounding.
- It reduces the chance that the demo is remembered as persuasive but underspecified.

### 5. Add Evidence-Backed Performance and Bundle Budgets

The README makes performance claims, but there is no automated budget enforcing them.

Gold-standard additions:

- A small benchmark harness for CPA over representative trace counts.
- CI thresholds for runtime on a standard environment.
- A bundle-size check to prevent slow drift.
- Optional chart-render timing checks for interaction smoothness.

Why this matters:

- Performance claims stop being anecdotal.
- Regressions become visible immediately.
- It protects the teaching experience as the lab grows.

### 6. Add a Stronger Bridge to Real-World Side-Channel Practice

The repo is already admirably honest about simulation. The next step is to show how this maps to actual practice without pretending the browser demo is a bench.

Best upgrade path:

- Support importing a small real capture dataset, such as ChipWhisperer-format traces or a simplified CSV.
- Add a side-by-side comparison view: simulated trace vs measured trace, what transfers and what does not.
- Include a short "from this lab to a real bench" guide covering capture, triggering, alignment, noise, and higher-order attacks.

Why this matters:

- It closes the main gap between educational value and practitioner relevance.
- It preserves honesty while making the repo a more authoritative reference.

### 7. Make the Pedagogy More Inspectable, Not Just More Polished

The UI already appears thoughtful. Gold standard would make every result easier to inspect and explain step by step.

High-value additions:

- Freeze-and-compare mode for charts so users can compare two parameter settings directly.
- Hover or focus explanations for why a wrong key guess stays near noise.
- A sample-by-sample walkthrough of one CPA point: predicted vector, measured vector, covariance intuition, final correlation.
- Clear "you just learned X" summaries at the end of each exhibit.

Why this matters:

- It improves retention.
- It helps the repo teach statistics, not just demonstrate outcomes.

### 8. Tighten the Repo Metadata for Long-Term Reuse

For a project this good, packaging and contributor ergonomics matter more than usual.

Worth adding:

- `engines` in `package.json` and a checked-in Node version file.
- A CONTRIBUTING guide with expected test commands and quality gates.
- A LICENSE file if distribution is intended.
- A short architecture note describing the separation between AES, leakage, attacks, SPA, and UI.

Why this matters:

- It makes the repo easier to maintain and reuse.
- It reduces friction for outside contributors and future-you.

## Highest-Leverage Roadmap

If the goal is to become the gold standard with the fewest changes, I would prioritize in this order:

1. Add PR CI plus behavior-level Playwright tests.
2. Add reproducibility features: seed control, permalinks, export/import.
3. Add references plus a technical appendix.
4. Add performance and bundle budgets.
5. Add optional real-trace import and comparison mode.

## The Real Standard To Aim For

The gold standard version of this repo is not "more animation" or "more crypto topics." It is a lab that is simultaneously:

- technically honest,
- cryptographically correct,
- statistically reproducible,
- accessibility-gated,
- CI-enforced before merge,
- citation-backed,
- and visibly connected to real bench practice.

This repo already has most of the hard part. The remaining work is mostly about reproducibility, evidence, and verification depth.