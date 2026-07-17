import { describe, it, expect } from "vitest";
import { generateTraces } from "./traces";
import { hexToBytes } from "../aes/aes";
import { SBOX } from "../aes/aes";
import { HW } from "./model";
import { pearson } from "../attack/stats";

const KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

/** Correlate the correct-key HW prediction against one measured sample column. */
function corrAtSample(ts: ReturnType<typeof generateTraces>, sample: number): number {
  const pred = Array.from(ts.plaintextByte, (p) => HW[SBOX[p ^ ts.keyByte]]);
  const col = ts.traces.map((tr) => tr[sample]);
  return pearson(pred, col);
}

describe("trace generation", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateTraces({ numTraces: 50, key: KEY, seed: 7 });
    const b = generateTraces({ numTraces: 50, key: KEY, seed: 7 });
    expect(Array.from(a.traces[0])).toEqual(Array.from(b.traces[0]));
    expect(Array.from(a.plaintextByte)).toEqual(Array.from(b.plaintextByte));
  });

  it("differs for a different seed", () => {
    const a = generateTraces({ numTraces: 50, key: KEY, seed: 1 });
    const b = generateTraces({ numTraces: 50, key: KEY, seed: 2 });
    expect(Array.from(a.traces[0])).not.toEqual(Array.from(b.traces[0]));
  });

  it("leaks HW(SBOX[pt^key]) at the target sample, not at an idle sample", () => {
    const ts = generateTraces({ numTraces: 3000, key: KEY, noise: 3, seed: 3 });
    expect(corrAtSample(ts, ts.leakSample)).toBeGreaterThan(0.25);
    expect(Math.abs(corrAtSample(ts, 0))).toBeLessThan(0.1); // sample 0 is template+noise only
  });

  it("boolean masking decorrelates the leak from HW(SBOX[pt^key])", () => {
    const plain = generateTraces({ numTraces: 3000, key: KEY, noise: 3, seed: 5 });
    const masked = generateTraces({ numTraces: 3000, key: KEY, noise: 3, seed: 5, countermeasure: "masking" });
    expect(corrAtSample(plain, plain.leakSample)).toBeGreaterThan(0.25);
    expect(Math.abs(corrAtSample(masked, masked.leakSample))).toBeLessThan(0.08);
  });

  it("applies bounded jitter when misalignment is on", () => {
    const ts = generateTraces({ numTraces: 100, key: KEY, jitter: 4, seed: 9 });
    let maxAbs = 0;
    let anyNonZero = false;
    for (const d of ts.appliedShifts) {
      maxAbs = Math.max(maxAbs, Math.abs(d));
      if (d !== 0) anyNonZero = true;
    }
    expect(maxAbs).toBeLessThanOrEqual(4);
    expect(anyNonZero).toBe(true);
  });
});
