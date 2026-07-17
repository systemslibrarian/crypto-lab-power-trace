/**
 * Leakage models. A CMOS gate draws current in proportion to the number of bits
 * it drives high (Hamming weight) or the number it flips (Hamming distance).
 * These two functions ARE the leakage model — the honest core of the whole lab.
 *
 * The model is a model. Real silicon leaks a noisier, more complex function of
 * its state; what transfers from here to a real bench is the *shape* of the
 * dependence (power tracks bits, not values) and the statistics built on top.
 */

/** Precomputed Hamming weight of every byte (popcount 0..8). */
export const HW: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let b = 0; b < 256; b++) {
    let v = b;
    let c = 0;
    while (v) {
      c += v & 1;
      v >>= 1;
    }
    t[b] = c;
  }
  return t;
})();

/** Hamming weight: number of 1 bits (models a register loaded with a value). */
export function hammingWeight(byte: number): number {
  return HW[byte & 0xff];
}

/** Hamming distance: bits that flip from a to b (models a register transition). */
export function hammingDistance(a: number, b: number): number {
  return HW[(a ^ b) & 0xff];
}
