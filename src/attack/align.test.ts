import { describe, it, expect } from "vitest";
import { generateTraces } from "../leakage/traces";
import { hexToBytes } from "../aes/aes";
import { cpaAttack } from "./cpa";
import { alignTraces, withTraces, shiftTrace } from "./align";

const KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

describe("misalignment and resynchronization", () => {
  it("shiftTrace moves samples and zero-fills the edge", () => {
    const s = shiftTrace([1, 2, 3, 4], 1);
    expect(Array.from(s)).toEqual([0, 1, 2, 3]);
  });

  it("jitter collapses CPA, and resync brings it back", () => {
    const aligned = generateTraces({ numTraces: 800, key: KEY, noise: 4, seed: 51 });
    const jittered = generateTraces({ numTraces: 800, key: KEY, noise: 4, seed: 51, jitter: 8 });

    // Baseline: clean traces recover the byte.
    expect(cpaAttack(aligned).best).toBe(aligned.keyByte);

    // Jitter should knock the true byte off the top rank.
    const jitterRank = cpaAttack(jittered).ranking.indexOf(jittered.keyByte) + 1;
    expect(jitterRank).toBeGreaterThan(1);

    // Cross-correlation resync then recovers it.
    const { aligned: fixed } = alignTraces(jittered.traces, 10);
    const resynced = cpaAttack(withTraces(jittered, fixed));
    expect(resynced.best).toBe(jittered.keyByte);
  });
});
