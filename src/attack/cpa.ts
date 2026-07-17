/**
 * Correlation Power Analysis (Brier–Clavier–Olivier, 2004).
 *
 * The attack, in full:
 *   for each key-byte guess k in 0..255:
 *     for each trace i: predict leakage H = HW(SBOX[pt_i ^ k])
 *     correlate the prediction vector against the measured power at every sample
 *   the guess whose prediction best correlates with the real power IS the key byte.
 *
 * 255 guesses produce a wrong intermediate, so their Hamming-weight prediction is
 * uncorrelated with the true power and stays in the noise. The one correct guess
 * predicts the real intermediate and spikes. Nothing here is faked — it is real
 * Pearson correlation (../attack/stats via the same formula) over real HW(SBOX[..]).
 */
import { SBOX } from "../aes/aes";
import { HW } from "../leakage/model";
import type { TraceSet } from "../leakage/traces";

export interface CpaResult {
  numTraces: number;
  numSamples: number;
  /** 256 correlation curves, one per guess, each of length numSamples. */
  curves: Float64Array[];
  /** Per-guess peak |correlation| across all samples. */
  scores: Float64Array;
  /** Per-guess sample index of the peak. */
  peakSample: Int32Array;
  /** Guess with the highest score — the recovered key byte. */
  best: number;
  /** All 256 guesses, sorted by score descending. */
  ranking: number[];
}

/** Streaming accumulator so cpaAttack and cpaSeparation share one code path. */
export class CpaAccumulator {
  private n = 0;
  private readonly sumP = new Float64Array(256);
  private readonly sumP2 = new Float64Array(256);
  private readonly sumT: Float64Array;
  private readonly sumT2: Float64Array;
  private readonly sumPT: Float64Array; // guess-major: [guess * numSamples + sample]
  private readonly pred = new Float64Array(256);

  constructor(readonly numSamples: number) {
    this.sumT = new Float64Array(numSamples);
    this.sumT2 = new Float64Array(numSamples);
    this.sumPT = new Float64Array(256 * numSamples);
  }

  get count(): number {
    return this.n;
  }

  add(plaintextByte: number, trace: ArrayLike<number>): void {
    this.n++;
    for (let g = 0; g < 256; g++) {
      const p = HW[SBOX[(plaintextByte ^ g) & 0xff]];
      this.pred[g] = p;
      this.sumP[g] += p;
      this.sumP2[g] += p * p;
    }
    for (let t = 0; t < this.numSamples; t++) {
      const st = trace[t];
      this.sumT[t] += st;
      this.sumT2[t] += st * st;
    }
    for (let g = 0; g < 256; g++) {
      const p = this.pred[g];
      if (p === 0) continue;
      const base = g * this.numSamples;
      for (let t = 0; t < this.numSamples; t++) this.sumPT[base + t] += p * trace[t];
    }
  }

  result(): CpaResult {
    const n = this.n;
    const ns = this.numSamples;
    const curves: Float64Array[] = [];
    const scores = new Float64Array(256);
    const peakSample = new Int32Array(256);
    for (let g = 0; g < 256; g++) {
      const curve = new Float64Array(ns);
      const denP = n * this.sumP2[g] - this.sumP[g] * this.sumP[g];
      let best = 0;
      let bestT = 0;
      for (let t = 0; t < ns; t++) {
        const denT = n * this.sumT2[t] - this.sumT[t] * this.sumT[t];
        const denom = Math.sqrt(denP * denT);
        const r = denom === 0 ? 0 : (n * this.sumPT[g * ns + t] - this.sumP[g] * this.sumT[t]) / denom;
        curve[t] = r;
        const abs = Math.abs(r);
        if (abs > best) {
          best = abs;
          bestT = t;
        }
      }
      curves.push(curve);
      scores[g] = best;
      peakSample[g] = bestT;
    }
    const ranking = Array.from({ length: 256 }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    return { numTraces: n, numSamples: ns, curves, scores, peakSample, best: ranking[0], ranking };
  }
}

/** Run CPA on the first `numTraces` traces (default: all). */
export function cpaAttack(ts: TraceSet, numTraces?: number): CpaResult {
  const n = Math.min(numTraces ?? ts.traces.length, ts.traces.length);
  const acc = new CpaAccumulator(ts.numSamples);
  for (let i = 0; i < n; i++) acc.add(ts.plaintextByte[i], ts.traces[i]);
  return acc.result();
}

export interface SeparationPoint {
  numTraces: number;
  correctScore: number; // peak correlation of the true key byte
  topWrongScore: number; // peak correlation of the best wrong guess
  correctRank: number; // 1 = true key byte is the top-ranked guess
  recovered: boolean; // true once the true key byte is rank 1
}

/**
 * Watch the spike separate: evaluate CPA at increasing trace counts in one pass.
 * Returns the correct byte's correlation and the best *wrong* guess's correlation
 * at each checkpoint — the gap between them is the whole lab.
 */
export function cpaSeparation(ts: TraceSet, checkpoints: number[]): SeparationPoint[] {
  const trueByte = ts.keyByte;
  const sorted = [...checkpoints].filter((n) => n >= 2).sort((a, b) => a - b);
  const acc = new CpaAccumulator(ts.numSamples);
  const out: SeparationPoint[] = [];
  let idx = 0;
  const maxN = Math.min(sorted[sorted.length - 1] ?? 0, ts.traces.length);
  for (let i = 0; i < maxN; i++) {
    acc.add(ts.plaintextByte[i], ts.traces[i]);
    while (idx < sorted.length && acc.count === Math.min(sorted[idx], ts.traces.length)) {
      const { scores, ranking } = acc.result();
      let topWrong = 0;
      for (let g = 0; g < 256; g++) if (g !== trueByte && scores[g] > topWrong) topWrong = scores[g];
      const correctRank = ranking.indexOf(trueByte) + 1;
      out.push({
        numTraces: acc.count,
        correctScore: scores[trueByte],
        topWrongScore: topWrong,
        correctRank,
        recovered: correctRank === 1,
      });
      idx++;
    }
  }
  return out;
}
