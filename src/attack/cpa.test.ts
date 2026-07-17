import { describe, it, expect } from "vitest";
import { generateTraces } from "../leakage/traces";
import { hexToBytes } from "../aes/aes";
import { cpaAttack, cpaSeparation } from "./cpa";

const KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

describe("Correlation Power Analysis", () => {
  it("recovers the correct key byte from enough traces (the whole point)", () => {
    const ts = generateTraces({ numTraces: 2000, key: KEY, noise: 3, seed: 11 });
    const res = cpaAttack(ts);
    expect(res.best).toBe(ts.keyByte); // = 0x2b, the first key byte
  });

  it("recovers each of several key-byte positions", () => {
    for (const targetByte of [0, 5, 15]) {
      const ts = generateTraces({ numTraces: 2500, key: KEY, noise: 3, seed: 21, targetByte });
      expect(cpaAttack(ts).best).toBe(KEY[targetByte]);
    }
  });

  it("the correct guess out-correlates every wrong guess at high N", () => {
    const ts = generateTraces({ numTraces: 2000, key: KEY, noise: 3, seed: 13 });
    const { scores } = cpaAttack(ts);
    let topWrong = 0;
    for (let g = 0; g < 256; g++) if (g !== ts.keyByte) topWrong = Math.max(topWrong, scores[g]);
    expect(scores[ts.keyByte]).toBeGreaterThan(topWrong);
  });

  it("the spike separates as trace count climbs", () => {
    const ts = generateTraces({ numTraces: 5000, key: KEY, noise: 3, seed: 17 });
    const sep = cpaSeparation(ts, [10, 100, 1000, 5000]);
    const margin = (p: (typeof sep)[number]) => p.correctScore - p.topWrongScore;
    // The gap between the true byte and the best impostor widens with more traces.
    expect(margin(sep[3])).toBeGreaterThan(margin(sep[0]));
    expect(sep[3].recovered).toBe(true);
  });

  it("needs more traces when the noise floor is raised (attacks cost, they don't fail)", () => {
    const quiet = generateTraces({ numTraces: 6000, key: KEY, noise: 2, seed: 31 });
    const loud = generateTraces({ numTraces: 6000, key: KEY, noise: 8, seed: 31 });
    const cps = [50, 100, 200, 400, 800, 1600, 3200, 6000];
    const first = (ts: ReturnType<typeof generateTraces>) =>
      cpaSeparation(ts, cps).find((p) => p.recovered)?.numTraces ?? Infinity;
    expect(first(quiet)).toBeLessThan(first(loud));
  });
});
