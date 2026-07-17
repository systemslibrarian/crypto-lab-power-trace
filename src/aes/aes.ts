/**
 * Hand-rolled AES-128 — the real cipher whose intermediate values leak.
 *
 * This is genuine AES-128 (FIPS-197). Nothing here is simulated: the S-box is
 * derived from first principles (multiplicative inverse in GF(2^8) followed by
 * the AES affine transform), the key schedule and round function are the real
 * ones, and the KATs in aes.test.ts are the FIPS-197 vectors.
 *
 * The teaching target is `sBoxOut(p, k) = SBOX[p ^ k]`: the output of the very
 * first-round SubBytes on a single byte. That intermediate is what a real chip
 * computes, and its Hamming weight is what leaks onto the power rail.
 */

/** Multiply two GF(2^8) elements modulo the AES polynomial x^8+x^4+x^3+x+1 (0x11b). */
export function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p & 0xff;
}

/** Multiplicative inverse in GF(2^8): b^254 (and inv(0) = 0 by AES convention). */
export function gInverse(b: number): number {
  if (b === 0) return 0;
  let result = 1;
  let base = b;
  let exp = 254;
  while (exp > 0) {
    if (exp & 1) result = gmul(result, base);
    base = gmul(base, base);
    exp >>= 1;
  }
  return result;
}

const rotl8 = (x: number, n: number): number => ((x << n) | (x >> (8 - n))) & 0xff;

/** AES affine transform applied to a byte (the second half of the S-box). */
function affine(x: number): number {
  return (x ^ rotl8(x, 1) ^ rotl8(x, 2) ^ rotl8(x, 3) ^ rotl8(x, 4) ^ 0x63) & 0xff;
}

/** The AES S-box, built as affine(inverse(b)) for every byte. */
export const SBOX: Uint8Array = (() => {
  const s = new Uint8Array(256);
  for (let b = 0; b < 256; b++) s[b] = affine(gInverse(b));
  return s;
})();

/** The first-round SubBytes output for one byte — the intermediate that leaks. */
export function sBoxOut(plaintextByte: number, keyByte: number): number {
  return SBOX[(plaintextByte ^ keyByte) & 0xff];
}

const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

/** Expand a 16-byte AES-128 key into 11 round keys (176 bytes). */
export function keyExpansion(key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error("AES-128 key must be 16 bytes");
  const w = new Uint8Array(176);
  w.set(key, 0);
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4];
    let t1 = w[i - 3];
    let t2 = w[i - 2];
    let t3 = w[i - 1];
    if (i % 16 === 0) {
      // RotWord + SubWord + Rcon
      const r = t0;
      t0 = SBOX[t1] ^ RCON[i / 16 - 1];
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[r];
    }
    w[i] = w[i - 16] ^ t0;
    w[i + 1] = w[i - 15] ^ t1;
    w[i + 2] = w[i - 14] ^ t2;
    w[i + 3] = w[i - 13] ^ t3;
  }
  return w;
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
}

function shiftRows(state: Uint8Array): void {
  const t = state.slice();
  // Column-major state; row r is shifted left by r. Indices: state[col*4 + row].
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[col * 4 + row] = t[((col + row) % 4) * 4 + row];
    }
  }
}

function mixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
    state[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
    state[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
    state[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
    state[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
  }
}

function addRoundKey(state: Uint8Array, roundKey: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) state[i] ^= roundKey[offset + i];
}

/** Encrypt one 16-byte block with AES-128. Real cipher — used by the KATs. */
export function encryptBlock(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  if (plaintext.length !== 16) throw new Error("AES block must be 16 bytes");
  const rk = keyExpansion(key);
  const state = plaintext.slice();
  addRoundKey(state, rk, 0);
  for (let round = 1; round <= 9; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, rk, round * 16);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, rk, 160);
  return state;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
