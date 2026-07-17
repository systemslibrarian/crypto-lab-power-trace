/**
 * Trace misalignment and resynchronization.
 *
 * Jitter — random horizontal shifts between traces — is the cheapest real-world
 * defense: if the leak sample lands in a different column on every trace, CPA
 * correlates the prediction against a moving target and collapses. It is also the
 * easiest to defeat: the operations still have a consistent *shape*, so the
 * attacker cross-correlates each trace against a reference, undoes the shift, and
 * the alignment comes right back. This models that resync (Sum-of-Absolute
 * -Differences / cross-correlation alignment, standard in trace preprocessing).
 */
import { pearson } from "./stats";
import type { TraceSet } from "../leakage/traces";

/** Shift a waveform by delta samples (positive = right), zero-filling the edges. */
export function shiftTrace(src: ArrayLike<number>, delta: number): Float64Array {
  const out = new Float64Array(src.length);
  if (delta === 0) {
    for (let i = 0; i < src.length; i++) out[i] = src[i];
    return out;
  }
  for (let i = 0; i < src.length; i++) {
    const j = i - delta;
    if (j >= 0 && j < src.length) out[i] = src[j];
  }
  return out;
}

export interface AlignResult {
  aligned: Float64Array[];
  /** Shift applied to each trace to bring it into the reference frame. */
  correction: Int16Array;
}

/**
 * Align every trace to a reference (default: the first trace) by searching shifts
 * in [-maxShift, maxShift] for the one that maximizes cross-correlation.
 */
export function alignTraces(traces: Float64Array[], maxShift: number, reference?: ArrayLike<number>): AlignResult {
  const ref = reference ?? traces[0];
  const aligned: Float64Array[] = [];
  const correction = new Int16Array(traces.length);
  for (let i = 0; i < traces.length; i++) {
    let bestDelta = 0;
    let bestCorr = -Infinity;
    for (let d = -maxShift; d <= maxShift; d++) {
      const corr = pearson(shiftTrace(traces[i], d), ref);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestDelta = d;
      }
    }
    correction[i] = bestDelta;
    aligned.push(shiftTrace(traces[i], bestDelta));
  }
  return { aligned, correction };
}

/** Build a new TraceSet that reuses everything but swaps in a different waveform set. */
export function withTraces(ts: TraceSet, traces: Float64Array[]): TraceSet {
  return { ...ts, traces };
}
