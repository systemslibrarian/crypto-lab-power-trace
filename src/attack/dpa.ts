/**
 * Differential Power Analysis (Kocher–Jaffe–Jun, 1999) — the original.
 *
 * DPA predates CPA and is why this whole field exists. Instead of correlating a
 * Hamming-weight model, it partitions the traces by a single predicted bit of the
 * intermediate (the "selection function") and subtracts the two average traces:
 *
 *   D_i = bit b of SBOX[pt_i ^ guess]
 *   diff[t] = mean{ trace_i[t] : D_i = 1 } - mean{ trace_i[t] : D_i = 0 }
 *
 * For the correct guess the partition lines up with reality and a spike appears at
 * the leak sample. For wrong guesses the partition is essentially random and the
 * two means cancel. It works — it just needs many more traces than CPA, because a
 * one-bit difference-of-means throws away most of the signal a full HW model keeps.
 */
import { SBOX } from "../aes/aes";
import type { TraceSet } from "../leakage/traces";

export interface DpaResult {
  numTraces: number;
  numSamples: number;
  curves: Float64Array[]; // 256 difference-of-means traces
  scores: Float64Array; // per-guess peak |diff|
  peakSample: Int32Array;
  best: number;
  ranking: number[];
  bit: number;
}

class DpaAccumulator {
  private n = 0;
  private readonly count1 = new Int32Array(256);
  private readonly sum1: Float64Array; // [guess * numSamples + sample] over D=1 traces
  private readonly sumT: Float64Array; // total per sample

  constructor(readonly numSamples: number, readonly bit: number) {
    this.sum1 = new Float64Array(256 * numSamples);
    this.sumT = new Float64Array(numSamples);
  }

  get count(): number {
    return this.n;
  }

  add(plaintextByte: number, trace: ArrayLike<number>): void {
    this.n++;
    const ns = this.numSamples;
    for (let t = 0; t < ns; t++) this.sumT[t] += trace[t];
    for (let g = 0; g < 256; g++) {
      const d = (SBOX[(plaintextByte ^ g) & 0xff] >> this.bit) & 1;
      if (d === 1) {
        this.count1[g]++;
        const base = g * ns;
        for (let t = 0; t < ns; t++) this.sum1[base + t] += trace[t];
      }
    }
  }

  result(): DpaResult {
    const n = this.n;
    const ns = this.numSamples;
    const curves: Float64Array[] = [];
    const scores = new Float64Array(256);
    const peakSample = new Int32Array(256);
    for (let g = 0; g < 256; g++) {
      const c1 = this.count1[g];
      const c0 = n - c1;
      const curve = new Float64Array(ns);
      let best = 0;
      let bestT = 0;
      if (c1 > 0 && c0 > 0) {
        const base = g * ns;
        for (let t = 0; t < ns; t++) {
          const mean1 = this.sum1[base + t] / c1;
          const mean0 = (this.sumT[t] - this.sum1[base + t]) / c0;
          const diff = mean1 - mean0;
          curve[t] = diff;
          const abs = Math.abs(diff);
          if (abs > best) {
            best = abs;
            bestT = t;
          }
        }
      }
      curves.push(curve);
      scores[g] = best;
      peakSample[g] = bestT;
    }
    const ranking = Array.from({ length: 256 }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    return { numTraces: n, numSamples: ns, curves, scores, peakSample, best: ranking[0], ranking, bit: this.bit };
  }

  /** Rank of the true byte at the current trace count (1 = recovered). */
  rankOf(trueByte: number): number {
    return this.result().ranking.indexOf(trueByte) + 1;
  }
}

export function dpaAttack(ts: TraceSet, opts?: { bit?: number; numTraces?: number }): DpaResult {
  const bit = opts?.bit ?? 0;
  const n = Math.min(opts?.numTraces ?? ts.traces.length, ts.traces.length);
  const acc = new DpaAccumulator(ts.numSamples, bit);
  for (let i = 0; i < n; i++) acc.add(ts.plaintextByte[i], ts.traces[i]);
  return acc.result();
}

/**
 * Smallest trace count (from `checkpoints`) at which the method ranks the true key
 * byte first. Returns null if it never recovers within the given traces.
 */
export function minTracesToRecover(
  method: "cpa" | "dpa",
  ts: TraceSet,
  checkpoints: number[],
  bit = 0,
): number | null {
  const sorted = [...checkpoints].filter((n) => n >= 2).sort((a, b) => a - b);
  const maxN = Math.min(sorted[sorted.length - 1] ?? 0, ts.traces.length);
  if (method === "dpa") {
    const acc = new DpaAccumulator(ts.numSamples, bit);
    let idx = 0;
    for (let i = 0; i < maxN; i++) {
      acc.add(ts.plaintextByte[i], ts.traces[i]);
      while (idx < sorted.length && acc.count === Math.min(sorted[idx], ts.traces.length)) {
        if (acc.rankOf(ts.keyByte) === 1) return acc.count;
        idx++;
      }
    }
    return null;
  }
  // cpa
  const sep = cpaFirstRecovery(ts, sorted);
  return sep;
}

// Local import to avoid a cycle in the public surface.
import { cpaSeparation } from "./cpa";
function cpaFirstRecovery(ts: TraceSet, checkpoints: number[]): number | null {
  const pts = cpaSeparation(ts, checkpoints);
  for (const p of pts) if (p.recovered) return p.numTraces;
  return null;
}
