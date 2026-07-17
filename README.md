# Power Trace

**Recover an AES-128 key byte from power consumption alone.** A timing attack measures
how long the secret took; a power attack measures how hard the transistors worked. The
cipher here is constant-time, its maths is correct, and it has no implementation bug — and
the key still walks out through the power rail, because CMOS gates draw current in
proportion to the bits they flip. This is the side channel that has nothing to do with your
code.

> **Not production crypto — a teaching demo.** The AES-128 and the statistics are real; the
> power traces are **simulated** from the cipher's real intermediate values. See
> [What Can Go Wrong](#what-can-go-wrong) and the in-page honesty panel for exactly what is
> real, what is modelled, and what this does **not** prove.

## What It Is

An interactive walk through power side-channel analysis against a real, hand-rolled
**AES-128** (FIPS-197). The leakage target is the first-round `SubBytes` output,
`SBox(p ⊕ k)`; the leakage model is `power = HammingWeight(intermediate) + noise`. Every
attack is genuine:

- **Real AES-128** — S-box derived from first principles (multiplicative inverse in GF(2⁸)
  + the AES affine transform), real key schedule and round function, validated by FIPS-197
  known-answer tests.
- **Real Pearson correlation**, **real DPA difference-of-means**, and **real
  cross-correlation resynchronization**.
- **Simulated traces** — generated from the cipher's real intermediates plus Gaussian
  noise, not captured from silicon.

**Security model:** this is a bench, not a device. No secrets are protected here; the AES
key is a fixed teaching value and everything runs in the browser with no backend. The point
is to show *why the class of attack works*, not to break any specific hardware.

## Exhibits

1. **Simple Power Analysis** — read a secret exponent off a *single* trace of
   square-and-multiply modular exponentiation. Squares are short, multiplies are long;
   square-then-multiply is a 1, a lone square is a 0. No statistics. The hook.
2. **Correlation Power Analysis (the headline)** — for each of the 256 guesses of key
   byte 0, predict `HW(SBox(p ⊕ k))` and correlate against the measured power. Drag the
   trace-count, noise, and **seed** sliders and watch the one correct byte spike out of the
   pack. The **cryptographic result** ("AES ran correctly") and the **security verdict**
   ("its key leaked") are shown as separate indicators — a correct cipher whose key leaked
   reads as ALARM, not green. **Freeze** a curve to compare parameter settings, **copy a
   permalink** that reopens the exact figure, or **export** the result as JSON / the 256
   correlations as CSV.
3. **The economics of noise** — raise the noise floor and watch the required trace count
   climb (roughly ∝ σ²). Attacks don't fail from noise; they just cost more traces.
4. **Trace misalignment** — jitter the traces and CPA collapses; cross-correlate to a
   reference, undo the shift, and it recovers. The cheapest real-world defense, and the
   easiest to defeat.
5. **DPA vs CPA** — Kocher–Jaffe–Jun's 1999 difference-of-means beside Brier–Clavier
   –Olivier's 2004 correlation, on the same measurements. DPA came first; CPA needs far
   fewer traces.
6. **Countermeasures** — Boolean masking (first-order), shuffling, and hiding/noise, each
   attacked with the identical CPA. Masking removes the first-order leak; shuffling and
   hiding only raise the price. The second-order attack that defeats masking is **named,
   not built.**
7. **Bring your own traces** — the same real CPA runs on any traces in a documented CSV
   format (plaintext byte + power samples per row). Download the example CSV or drop in your
   own capture (e.g. exported from ChipWhisperer). What transfers is stated plainly.
8. **Honesty panel** — what is real, what is simulated, and what this does not prove.

## When to Use It

- **Do** use it to build intuition for why constant-time, bug-free code is not enough, and
  how trace-count economics drive real evaluations.
- **Do** use it to see the difference between a countermeasure that closes a channel and one
  that only raises the cost.
- **Do NOT** use it to conclude that any specific chip is (or isn't) vulnerable, to size a
  real attack, or as a source of trace-capture or DSP code — the traces here are modelled,
  not measured.

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-power-trace/**

Move the CPA sliders to watch the spike separate; press the countermeasure and misalignment
buttons to defend the chip, then defeat (or fail to defeat) the defense yourself. Every
button runs the real primitive against the real analysis.

## What Can Go Wrong

The honest scope, stated plainly:

- **The traces are simulated.** They come from the cipher's real intermediates plus Gaussian
  noise — not from an oscilloscope. Real silicon leaks a noisier, more complex function; the
  exact noise characteristics do **not** transfer.
- **What transfers:** the leakage model (power tracks Hamming weight), the statistics, and
  the trace-count economics. **What doesn't:** the physics of a particular device.
- **The recovered value is precisely** byte 0 of the AES-128 key. In AES-128 the first round
  key *is* the cipher key, so this is a real **encryption**-key byte — not a MAC or
  authentication key. The maths is intact; the leak is in the hardware model, not the
  algorithm.
- **Masking is only shown to kill first-order CPA.** It does **not** prove masking is secure:
  second-order attacks combine two sample points and can defeat it. That attack is named,
  not built.
- **Out of scope by design:** higher-order DPA, template attacks, real capture, and PQC
  power analysis.

## Real-World Usage

Power and EM side-channel analysis is a standard part of evaluating smart cards, TPMs,
HSMs, and IoT silicon (Common Criteria, EMVCo, FIPS 140-3 side-channel testing). The
open-source **ChipWhisperer** platform captures real traces and runs exactly this CPA
pipeline. Masking, shuffling, and hiding are the countermeasures deployed in real secure
elements — with the higher-order caveats this lab is careful to name.

## How to Run Locally

```bash
npm install
npm run dev        # http://localhost:5173/crypto-lab-power-trace/
npm test           # unit tests incl. FIPS-197 KATs
npm run build      # typecheck + production build
npm run test:a11y  # WCAG 2.1 AA gate (both themes) against the built preview
```

Local a11y preview runs on port **4288** (`npm run preview -- --port 4288 --strictPort`).

## Related Demos

- [crypto-lab-rsa-educational](https://systemslibrarian.github.io/crypto-lab-rsa-educational/)
  — the RSA arithmetic behind the SPA exhibit.
- [crypto-lab-timing-sidechannel](https://systemslibrarian.github.io/crypto-lab-timing-sidechannel/)
  — timing attacks measure *duration*, this one measures *current*.
- [crypto-lab-timing-oracle](https://systemslibrarian.github.io/crypto-lab-timing-oracle/)
  — a remote timing oracle.
- [crypto-lab-lattice-fault](https://systemslibrarian.github.io/crypto-lab-lattice-fault/)
  — fault injection and PQC/NTT leakage, a different physical channel.

## Build & Verify

- **45 unit tests** (Vitest), colocated as `src/**/*.test.ts`, all passing.
- **Spec KATs:** 3 FIPS-197 AES-128 known-answer encryption vectors (`src/aes/aes.test.ts`),
  plus FIPS-197 S-box and key-expansion checks. The attack tests prove CPA recovers the key
  byte, DPA needs more traces than CPA, jitter collapses CPA and resync restores it, masking
  decorrelates the first-order leak, and SPA reads the exponent off the operation trace.
- **Behavior E2E** (`e2e/behavior.spec.ts`): Playwright drives the shipped UI to verify the
  teaching outcomes — CPA recovers `0x2B`, the verdict flips as trace count climbs, jitter
  blocks the attack and resync restores it, masking defeats first-order CPA, a permalink
  restores the exact figure, the example CSV round-trips through the real import pipeline and
  recovers `0x2B`, and the theme choice persists across reload.
- **Accessibility gate:** `@axe-core/playwright` scans the production build for zero WCAG
  2.1 A/AA violations in **both** themes, and blocks the GitHub Pages deploy on any failure.
- **CI on every PR** (`.github/workflows/ci.yml`) runs unit tests, the typechecked build, a
  **bundle-size budget** (`npm run size`), and the a11y + behavior gate before merge;
  `deploy.yml` runs the same on `main` and only then publishes.

## Performance

CPA over all 256 guesses at 5,000 traces runs in well under a second in the browser; the
headline sliders recompute on `requestAnimationFrame`. Trace sets are generated once per
`(noise, seed)` pair and cached. Everything is deterministic: the same seed, trace count, and
noise reproduce the exact figure, so README/appendix claims regenerate from documented
settings.

## References & Further Reading

Full derivations, the leakage model, and the exact formulas are in
[`docs/TECHNICAL.md`](docs/TECHNICAL.md). Primary sources:

- **FIPS-197** — *Advanced Encryption Standard (AES)*, NIST, 2001 (rev. 2023).
- **Kocher, Jaffe & Jun** — *Differential Power Analysis*, CRYPTO 1999.
- **Brier, Clavier & Olivier** — *Correlation Power Analysis with a Leakage Model*, CHES 2004.
- **Mangard, Oswald & Popp** — *Power Analysis Attacks*, Springer 2007.
- **ChipWhisperer** (NewAE) — the open-source platform that runs this pipeline on real hardware.

Contributing guidelines and the module architecture are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
