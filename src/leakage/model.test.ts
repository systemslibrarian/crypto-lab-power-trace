import { describe, it, expect } from "vitest";
import { hammingWeight, hammingDistance, HW } from "./model";

describe("leakage model", () => {
  it("computes Hamming weight (popcount)", () => {
    expect(hammingWeight(0x00)).toBe(0);
    expect(hammingWeight(0xff)).toBe(8);
    expect(hammingWeight(0x01)).toBe(1);
    expect(hammingWeight(0b10110100)).toBe(4);
  });

  it("computes Hamming distance (bits flipped)", () => {
    expect(hammingDistance(0x00, 0xff)).toBe(8);
    expect(hammingDistance(0xff, 0xff)).toBe(0);
    expect(hammingDistance(0b1010, 0b0011)).toBe(2);
  });

  it("has a HW table consistent with the function over all bytes", () => {
    for (let b = 0; b < 256; b++) expect(HW[b]).toBe(hammingWeight(b));
  });

  it("HW of a uniform byte has the binomial mean of 4", () => {
    let sum = 0;
    for (let b = 0; b < 256; b++) sum += HW[b];
    expect(sum / 256).toBe(4);
  });
});
