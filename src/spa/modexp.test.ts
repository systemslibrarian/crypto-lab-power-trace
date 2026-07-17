import { describe, it, expect } from "vitest";
import { spaExponentiate, readExponentFromOps, bitsOf } from "./modexp";

/** Reference modular exponentiation for cross-checking (independent of the SUT). */
function refModexp(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n % m;
  let base = b % m;
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return r;
}

describe("square-and-multiply modular exponentiation", () => {
  it("matches a reference implementation across many inputs", () => {
    const m = 3233n; // 61 * 53, the classic textbook RSA modulus
    for (let b = 2n; b < 40n; b++) {
      for (let e = 1n; e < 60n; e++) {
        expect(spaExponentiate(b, e, m).value).toBe(refModexp(b, e, m));
      }
    }
  });

  it("computes a known RSA value (65^17 mod 3233 = 2790)", () => {
    expect(spaExponentiate(65n, 17n, 3233n).value).toBe(2790n);
  });

  it("bitsOf is most-significant-first", () => {
    expect(bitsOf(0b10110n)).toEqual([1, 0, 1, 1, 0]);
    expect(bitsOf(1n)).toEqual([1]);
    expect(bitsOf(0n)).toEqual([0]);
  });
});

describe("SPA attack: read the exponent off the operation trace", () => {
  it("recovers the exponent from the square/multiply pattern alone", () => {
    for (const e of [17n, 255n, 65537n, 0b1011010011n]) {
      const { ops, bits } = spaExponentiate(7n, e, 3233n);
      const recovered = readExponentFromOps(ops);
      expect(recovered.bits).toEqual(bits);
      expect(recovered.value).toBe(e);
    }
  });

  it("a multiply after every square would read as all-ones", () => {
    const { ops } = spaExponentiate(7n, 0b1111n, 3233n);
    // 4 squares, 4 multiplies interleaved.
    expect(ops.filter((o) => o.kind === "multiply").length).toBe(4);
    expect(readExponentFromOps(ops).value).toBe(0b1111n);
  });
});
