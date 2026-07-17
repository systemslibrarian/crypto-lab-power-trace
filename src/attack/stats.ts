/**
 * Real Pearson product-moment correlation. This is the statistic that turns a
 * pile of noisy traces into a key: it measures how tightly the predicted leakage
 * (Hamming weight of a guessed intermediate) tracks the measured power.
 */

/** Pearson r between two equal-length series. Returns 0 if either has no variance. */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0 || y.length !== n) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
