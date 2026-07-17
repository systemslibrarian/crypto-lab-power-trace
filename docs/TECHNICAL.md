# Technical Appendix

The bridge from the on-page intuition to the formal machinery and its primary
sources. Everything below is implemented as stated; file references point at the
exact code.

## 1. The leakage model

A CMOS gate dissipates dynamic power roughly in proportion to the number of bits
that switch. Two standard first-order models capture this (`src/leakage/model.ts`):

- **Hamming weight** — `HW(v)` = number of 1-bits in `v`. Models a bus/register
  being loaded with value `v` from a zero (or data-independent) prior state.
- **Hamming distance** — `HD(a, b) = HW(a ⊕ b)`. Models a register transitioning
  from `a` to `b`; the more general model when the prior state is known.

This lab targets the AES-128 first-round S-box output `v = SBox(p ⊕ k)` under the
Hamming-weight model. The simulated power at the leaking sample is

```
power_i = template[t] + LEAK_AMP · HW(SBox(p_i ⊕ k*)) + N(0, σ²)
```

where `template[t]` is a data-independent operation envelope (constant across
traces, so it contributes nothing to the per-sample correlation — it exists only
to give trace alignment a feature to lock onto) and `N(0, σ²)` is Gaussian
measurement noise (`src/leakage/traces.ts`).

> **Simplification vs. practice.** Real silicon leaks a noisier, device-specific
> mixture of HW/HD plus glitches and coupling; profiled/template attacks estimate
> that leakage function from data. Here the model is assumed, not profiled. What
> transfers is the *shape* of the dependence and the statistics built on it.

## 2. AES-128 and the attack point

The cipher is real AES-128 (FIPS-197). The S-box is derived from first
principles rather than hardcoded (`src/aes/aes.ts`): for each byte `b`,

```
SBox(b) = Affine( b^(-1) in GF(2^8) )
```

with the inverse taken modulo the AES polynomial `x^8 + x^4 + x^3 + x + 1`
(`0x11B`), `0` mapping to `0`, and the AES affine transform

```
Affine(x) = x ⊕ (x <<< 1) ⊕ (x <<< 2) ⊕ (x <<< 3) ⊕ (x <<< 4) ⊕ 0x63
```

(`<<<` = rotate-left over 8 bits). Correctness is pinned by FIPS-197 known-answer
tests (`src/aes/aes.test.ts`).

CPA attacks the first-round SubBytes output `SBox(p ⊕ k)`, one key byte at a time.
Recovering all 16 bytes recovers round-key 0, which **in AES-128 is the cipher
key** — so this is encryption-key recovery, not a MAC/authentication key.

## 3. Correlation Power Analysis (CPA)

Brier, Clavier & Olivier (2004). For each key-byte guess `k ∈ {0,…,255}` and each
sample point `t`, compute the Pearson correlation between the predicted leakage
`H_i(k) = HW(SBox(p_i ⊕ k))` and the measured power `T_i(t)` over `N` traces:

```
                Σ_i (H_i(k) − H̄(k)) (T_i(t) − T̄(t))
ρ(k, t) = ───────────────────────────────────────────────────
          sqrt( Σ_i (H_i(k) − H̄(k))²  ·  Σ_i (T_i(t) − T̄(t))² )
```

(`src/attack/stats.ts` for `ρ`; `src/attack/cpa.ts` for the sweep, which uses the
algebraically identical single-pass form with running sums so it can be evaluated
at any trace count). The recovered byte is `argmax_k max_t |ρ(k, t)|`. The correct
guess predicts the true intermediate and peaks; the other 255 predict a
diffused, uncorrelated value and stay near zero.

## 4. Differential Power Analysis (DPA)

Kocher, Jaffe & Jun (1999) — the original, difference-of-means form. Choose a
single predicted bit `b` of the intermediate as the selection function
`D_i(k) = bit_b( SBox(p_i ⊕ k) )`, partition the traces, and subtract the mean
traces (`src/attack/dpa.ts`):

```
Δ(k, t) = mean{ T_i(t) : D_i(k) = 1 } − mean{ T_i(t) : D_i(k) = 0 }
```

For the correct guess a spike appears at the leak sample; for wrong guesses the
partition is effectively random and the means cancel. DPA works but needs many
more traces than CPA, because a one-bit difference-of-means discards most of the
signal the full Hamming-weight model in CPA keeps. The lab demonstrates this
ordering empirically (`minTracesToRecover` in `src/attack/dpa.ts`).

## 5. Trace-count economics

The standard error of an estimated correlation falls as ≈ `1/√N`, so the peak of
the best *wrong* guess shrinks like `1/√N` while the correct peak converges to its
model ceiling. Recovery happens once the correct peak clears the wrong-guess band.
Since the correct-guess correlation under additive noise scales as

```
ρ ≈ ρ_0 / sqrt(1 + σ² / var_signal)
```

the traces needed to recover grow roughly as `σ²` (double the noise ≈ 4× the
traces). Exhibit 3 measures this directly. Noise raises the attacker's cost; it
does not close the channel.

## 6. Trace alignment (resync)

Random horizontal jitter makes the leak sample land in a different column on each
trace, so CPA correlates against a moving target and collapses. Because the
operation envelope is consistent across traces, the attacker cross-correlates each
trace against a reference and undoes the shift (`src/attack/align.ts`,
`alignTraces`). This is the elementary form of the alignment/resynchronization
step (SAD / cross-correlation) that is standard trace preprocessing. Jitter raises
effort (an alignment pass), not outcome — which is why misalignment alone is not
counted as a real countermeasure.

## 7. Countermeasures (and their honest scope)

- **Boolean masking (first-order).** Each intermediate is split as `s ⊕ m` with a
  fresh uniform mask `m` per trace, so no single sample correlates with `HW(s)`.
  First-order CPA finds nothing. **This does not prove masking is secure:**
  second-order attacks combine two sample points (the one handling `m` and the one
  handling `s ⊕ m`) and defeat it. That higher-order attack is named, not built.
- **Shuffling.** Randomizing the S-box operation order spreads the target leak
  over several time slots, reducing per-sample correlation by ≈ `1/√d` for `d`
  slots — so recovery needs ≈ `d²` more traces. Cost, not closure.
- **Hiding / noise injection.** Raises `σ`; by §5 this raises the trace budget
  (≈ `σ²`) without closing the channel.

## References

1. **FIPS-197**, *Advanced Encryption Standard (AES)*, NIST, 2001 (updated 2023).
   The AES-128 specification and the known-answer vectors used in the tests.
2. **P. Kocher, J. Jaffe, B. Jun**, *Differential Power Analysis*, CRYPTO 1999,
   LNCS 1666, pp. 388–397. The original DPA.
3. **É. Brier, C. Clavier, F. Olivier**, *Correlation Power Analysis with a
   Leakage Model*, CHES 2004, LNCS 3156, pp. 16–29. CPA and the HW leakage model.
4. **S. Mangard, E. Oswald, T. Popp**, *Power Analysis Attacks: Revealing the
   Secrets of Smart Cards*, Springer, 2007. Standard reference for leakage models,
   alignment, masking, and higher-order attacks.
5. **NewAE Technology**, *ChipWhisperer* — the open-source capture/analysis
   platform that runs this exact CPA pipeline on real hardware.

## What is pedagogically simplified vs. standard practice

| Aspect | This lab | Real bench |
| --- | --- | --- |
| Traces | Simulated from real intermediates + Gaussian noise | Captured on an oscilloscope/ChipWhisperer |
| Leakage function | Assumed Hamming weight | Profiled or assumed; often HD, with glitches |
| Samples per trace | 40 (one op ≈ one sample) | thousands–millions; needs point-of-interest selection |
| Alignment feature | One clean template bump + trigger | Real operation envelope, often much noisier |
| Higher-order attacks | Named, not implemented | Implemented (2nd-order, template, ML) |
