import { describe, it, expect } from "vitest";
import { generateTraces } from "../leakage/traces";
import { hexToBytes } from "../aes/aes";
import { cpaAttack } from "./cpa";

/**
 * Performance tripwire, not a benchmark. A full 256-guess CPA over 5,000 traces
 * runs in ~100-300ms locally; the generous ceiling exists to catch an accidental
 * complexity blow-up (e.g. an O(N²) regression), non-flaky even on slow CI.
 */
describe("CPA performance budget", () => {
  it("attacks 5000 traces in well under the ceiling", () => {
    const key = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");
    const ts = generateTraces({ numTraces: 5000, key, noise: 3, seed: 1 });
    const start = performance.now();
    const res = cpaAttack(ts);
    const ms = performance.now() - start;
    expect(res.best).toBe(ts.keyByte); // still correct
    expect(ms).toBeLessThan(8000);
  });
});
