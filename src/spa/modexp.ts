/**
 * Simple Power Analysis on square-and-multiply modular exponentiation.
 *
 * This is the free win — the hook. A textbook left-to-right binary exponentiation
 * squares on every exponent bit and multiplies only when the bit is 1:
 *
 *   result = 1
 *   for each bit of e, most significant first:
 *     result = result^2 mod m         // a SQUARE — happens every bit
 *     if bit == 1: result = result·b mod m   // a MULTIPLY — only when bit is 1
 *
 * A squaring and a multiply take different amounts of work, so they look different
 * on the power rail. You don't need statistics or averaging — one trace, read with
 * your eyes: SQUARE-MULTIPLY is a 1, a lone SQUARE is a 0. The exponent (the RSA
 * private key, in the real thing) walks straight off the waveform.
 *
 * The modexp here is real (BigInt). The per-operation durations are a model of how
 * long each op takes; see crypto-lab-rsa-educational for the arithmetic itself.
 */

export type OpKind = "square" | "multiply";

export interface Op {
  kind: OpKind;
  bit: number; // which exponent bit (index from MSB) this op belongs to
}

export interface SpaTrace {
  value: bigint; // base^exp mod modulus — the genuine result
  bits: number[]; // exponent bits, MSB first
  ops: Op[]; // the operation sequence a single power trace would reveal
}

/** Exponent bits, most-significant first (empty exponent 0 -> [0]). */
export function bitsOf(exp: bigint): number[] {
  if (exp <= 0n) return [0];
  const bits: number[] = [];
  let e = exp;
  while (e > 0n) {
    bits.push(Number(e & 1n));
    e >>= 1n;
  }
  bits.reverse();
  return bits;
}

/** Run real square-and-multiply and record the operation sequence it performs. */
export function spaExponentiate(base: bigint, exp: bigint, modulus: bigint): SpaTrace {
  const bits = bitsOf(exp);
  const ops: Op[] = [];
  let result = 1n % modulus;
  for (let i = 0; i < bits.length; i++) {
    result = (result * result) % modulus;
    ops.push({ kind: "square", bit: i });
    if (bits[i] === 1) {
      result = (result * base) % modulus;
      ops.push({ kind: "multiply", bit: i });
    }
  }
  return { value: result, bits, ops };
}

/**
 * The SPA attack itself: reconstruct the exponent from nothing but the SQUARE /
 * MULTIPLY pattern. A square opens a new bit (0); a following multiply flips it to
 * 1. If this equals the real exponent, the trace leaked the whole secret.
 */
export function readExponentFromOps(ops: Op[]): { bits: number[]; value: bigint } {
  const bits: number[] = [];
  for (const op of ops) {
    if (op.kind === "square") bits.push(0);
    else if (op.kind === "multiply" && bits.length > 0) bits[bits.length - 1] = 1;
  }
  let value = 0n;
  for (const b of bits) value = (value << 1n) | BigInt(b);
  return { bits, value };
}
