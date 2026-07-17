import { describe, it, expect } from "vitest";
import { generateTraces } from "../leakage/traces";
import { hexToBytes } from "../aes/aes";
import { dpaAttack, minTracesToRecover } from "./dpa";

const KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

describe("Differential Power Analysis (difference of means)", () => {
  it("recovers the correct key byte given enough traces", () => {
    const ts = generateTraces({ numTraces: 6000, key: KEY, noise: 3, seed: 41 });
    expect(dpaAttack(ts, { bit: 0 }).best).toBe(ts.keyByte);
  });

  it("CPA recovers with fewer traces than DPA on the same measurements", () => {
    const ts = generateTraces({ numTraces: 8000, key: KEY, noise: 3, seed: 43 });
    const cps = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 8000];
    const cpaMin = minTracesToRecover("cpa", ts, cps);
    const dpaMin = minTracesToRecover("dpa", ts, cps, 0);
    expect(cpaMin).not.toBeNull();
    expect(dpaMin).not.toBeNull();
    expect(cpaMin!).toBeLessThan(dpaMin!);
  });
});
