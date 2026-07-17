/**
 * Trace generation. This is the ONE simulated part of the lab, and it is labeled
 * as such everywhere it surfaces in the UI.
 *
 * The intermediates are real: v_j = SBOX[pt_j ^ key_j] from the genuine AES-128
 * in ../aes/aes.ts. The power *model* is a model: each of the 16 first-round
 * S-box operations lands at one sample, contributing leakAmp · HW(intermediate),
 * on top of a fixed data-independent template (the "shape" of the operation, what
 * real trace-alignment locks onto) and Gaussian measurement noise.
 *
 * What transfers to a real oscilloscope bench: the leakage model, the statistics,
 * and the trace-count economics. What does NOT: the exact noise distribution of
 * physical silicon. Real captures come off hardware (e.g. ChipWhisperer).
 */
import { SBOX } from "../aes/aes";
import { HW } from "./model";
import { Rng } from "./rng";

export type Countermeasure = "none" | "masking" | "shuffling";

export interface TraceConfig {
  numTraces: number;
  key: Uint8Array; // 16-byte AES-128 key; we attack one byte of it
  targetByte?: number; // default 0
  noise?: number; // Gaussian sigma of the measurement noise, default 3
  seed?: number; // default 1
  countermeasure?: Countermeasure; // default "none"
  hiding?: number; // extra noise sigma injected (hiding countermeasure), default 0
  jitter?: number; // max per-trace horizontal shift (misalignment), default 0
  shuffleWindow?: number; // # of slots the shuffled target op spreads across, default 4
}

export interface TraceSet {
  traces: Float64Array[]; // N measured power waveforms, each length numSamples
  plaintextByte: Uint8Array; // N plaintext bytes at the target position
  numSamples: number;
  baseIndex: number; // first op sample
  leakSample: number; // nominal sample of the target byte's S-box op
  targetByte: number;
  keyByte: number; // ground truth, for display / verification only
  appliedShifts: Int16Array; // per-trace jitter that was applied
  config: Required<Omit<TraceConfig, "key">>;
}

export const NUM_SAMPLES = 40;
export const BASE_INDEX = 8; // the 16 S-box ops occupy samples 8..23
export const LEAK_AMP = 1.0; // volts of leak per Hamming-weight bit (model units)
const BUMP_AMP = 5.0;
const BUMP_CENTER = BASE_INDEX + 7.5;
const BUMP_WIDTH = 5.0;
export const TRIGGER_SAMPLE = 30; // a sharp, data-independent feature (like an IO trigger)
const TRIGGER_AMP = 16.0;
const TRIGGER_WIDTH = 1.2;

/**
 * Fixed, data-independent operation shape — what alignment cross-correlates on.
 * Being constant across traces at any given sample, it contributes nothing to the
 * per-sample Pearson correlation the attack uses; it exists only to give resync a
 * feature to lock onto (as a real power trace's operation envelope does).
 */
const TEMPLATE: Float64Array = (() => {
  const t = new Float64Array(NUM_SAMPLES);
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const db = i - BUMP_CENTER;
    const dt = i - TRIGGER_SAMPLE;
    t[i] =
      BUMP_AMP * Math.exp(-(db * db) / (2 * BUMP_WIDTH * BUMP_WIDTH)) +
      TRIGGER_AMP * Math.exp(-(dt * dt) / (2 * TRIGGER_WIDTH * TRIGGER_WIDTH));
  }
  return t;
})();

/** Shift a waveform by delta samples (positive = right), zero-filling the edges. */
function shift(src: Float64Array, delta: number) {
  const out = new Float64Array(src.length);
  if (delta === 0) {
    out.set(src);
    return out;
  }
  for (let i = 0; i < src.length; i++) {
    const j = i - delta;
    if (j >= 0 && j < src.length) out[i] = src[j];
  }
  return out;
}

/**
 * Generate a set of power traces from a real AES-128 first round.
 * The returned traces are what an attacker "measures"; only plaintextByte and the
 * traces are needed to mount the attack — keyByte is truth, kept for verification.
 */
export function generateTraces(cfg: TraceConfig): TraceSet {
  const targetByte = cfg.targetByte ?? 0;
  const noise = cfg.noise ?? 3;
  const seed = cfg.seed ?? 1;
  const countermeasure = cfg.countermeasure ?? "none";
  const hiding = cfg.hiding ?? 0;
  const jitter = cfg.jitter ?? 0;
  const shuffleWindow = cfg.shuffleWindow ?? 4;
  const totalNoise = noise + hiding;

  const rng = new Rng(seed);
  const traces: Float64Array[] = [];
  const plaintextByte = new Uint8Array(cfg.numTraces);
  const appliedShifts = new Int16Array(cfg.numTraces);

  for (let i = 0; i < cfg.numTraces; i++) {
    const pt = new Uint8Array(16);
    for (let j = 0; j < 16; j++) pt[j] = rng.byte();
    plaintextByte[i] = pt[targetByte];

    let s = new Float64Array(NUM_SAMPLES);
    s.set(TEMPLATE);
    for (let t = 0; t < NUM_SAMPLES; t++) s[t] += totalNoise * rng.gaussian();

    for (let j = 0; j < 16; j++) {
      const v = SBOX[pt[j] ^ cfg.key[j]];
      const leakByte = countermeasure === "masking" ? v ^ rng.byte() : v;
      let sample = BASE_INDEX + j;
      if (countermeasure === "shuffling" && j === targetByte) {
        sample = BASE_INDEX + rng.int(shuffleWindow);
      }
      s[sample] += LEAK_AMP * HW[leakByte];
    }

    if (jitter > 0) {
      const delta = rng.int(2 * jitter + 1) - jitter;
      appliedShifts[i] = delta;
      s = shift(s, delta);
    }

    traces.push(s);
  }

  return {
    traces,
    plaintextByte,
    numSamples: NUM_SAMPLES,
    baseIndex: BASE_INDEX,
    leakSample: BASE_INDEX + targetByte,
    targetByte,
    keyByte: cfg.key[targetByte],
    appliedShifts,
    config: { numTraces: cfg.numTraces, targetByte, noise, seed, countermeasure, hiding, jitter, shuffleWindow },
  };
}
