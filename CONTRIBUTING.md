# Contributing

Thanks for looking. This is one of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/)
teaching demos; the bar is **honest, correct, verified, accessible.**

## Prerequisites

- Node **22+** (see `.nvmrc`; `nvm use` picks it up).
- `npm install` once.

## Quality gates (run before every push)

```bash
npm test           # Vitest unit tests, incl. FIPS-197 KATs
npm run build      # tsc --noEmit (typecheck) + vite build
npm run test:a11y  # Playwright: WCAG 2.1 AA + behavior E2E, both themes, on the built preview
```

CI (`.github/workflows/ci.yml`) runs the same three on every pull request and
branch push; `deploy.yml` runs them again on `main` and only then publishes to
GitHub Pages. A red gate does not ship.

## Architecture

The cryptographic logic is isolated from the UI so it can be tested and audited on
its own:

| Area | Path | What lives here |
| --- | --- | --- |
| Cipher | `src/aes/` | Real AES-128; S-box from GF(2⁸) first principles; FIPS-197 KATs |
| Leakage | `src/leakage/` | HW/HD models, seeded RNG, simulated trace generation |
| Attacks | `src/attack/` | Pearson, CPA, DPA, cross-correlation alignment |
| SPA | `src/spa/` | Square-and-multiply modexp + exponent read-off |
| UI | `src/ui/` | DOM/canvas helpers, chart drawers, panel wiring |
| Gate | `e2e/` | `a11y.spec.ts` (axe) and `behavior.spec.ts` (teaching outcomes) |

See [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for the formulas, the leakage model,
and primary-source citations.

## House rules

- **Real crypto only.** Never fake or simulate the maths. The *traces* are
  modelled (and labelled as such everywhere); the cipher and statistics are real.
- **No precision drift.** Every consequence claim must be exactly true for the
  exact construction (e.g. "byte 0 of the AES-128 key" — an encryption key, not a
  MAC). Overstating an attack is a correctness bug.
- **Honest scope.** If a countermeasure only raises the cost, say so; if a defense
  is only first-order, name the higher-order attack that defeats it.
- **Accessibility is not optional.** Author to the WCAG checklist; the gate is
  enforced in CI in both themes.
- **Tests colocated** as `src/**/*.test.ts`; new claims get a test.
- **Don't hand-build the header/theme toggle** — the shared top bar owns those.
