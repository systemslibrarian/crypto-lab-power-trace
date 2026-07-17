import { describe, it, expect } from "vitest";
import { pearson } from "./stats";

describe("Pearson correlation", () => {
  it("is +1 for a perfect increasing linear relationship", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
  });

  it("is -1 for a perfect decreasing relationship", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("is ~0 for uncorrelated series", () => {
    expect(Math.abs(pearson([1, 2, 3, 4], [3, 1, 4, 1]))).toBeLessThan(0.5);
  });

  it("returns 0 when a series has no variance", () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });

  it("matches a hand-computed value", () => {
    // cov = 3.5, vx = 8.75, vy = 5 -> r = 3.5 / sqrt(43.75).
    expect(pearson([1, 2, 3, 5], [2, 1, 4, 3])).toBeCloseTo(0.52915, 5);
  });
});
