/**
 * Deterministic PRNG + Gaussian noise. Seeded so that traces, and therefore the
 * whole attack, are reproducible — the teaching claims ("the spike separates at
 * ~N traces") stay stable, and the unit tests are not flaky.
 *
 * This randomness is for the *measurement noise model*, not for any key or mask
 * that needs to be secret. The AES key and per-trace masks are drawn from it too,
 * but nothing here is a security boundary: it is a teaching bench, not a device.
 */
export class Rng {
  private a: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** mulberry32 — a small, fast, well-distributed 32-bit generator. */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** A random byte in [0, 256). */
  byte(): number {
    return this.int(256);
  }

  /** Standard normal via Box-Muller (mean 0, sd 1). */
  gaussian(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this.spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  }

  /** Fisher-Yates shuffle of 0..n-1 (used by the shuffling countermeasure). */
  permutation(n: number): number[] {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  }
}
