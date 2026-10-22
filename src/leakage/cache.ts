/**
 * A deliberately idealized cache-line observation, not measured browser timing.
 * A classic AES T-table has four-byte entries; for a hypothetical 64-byte line,
 * 16 adjacent indices occupy a line. The first-round index for byte 0 is p xor k.
 * The existing JavaScript AES instead has a one-byte S-box table; this model is
 * about a different, table-based implementation, not its physical cache layout.
 */
export const ENTRIES_PER_LINE = 16;
export const LINE_COUNT = 256 / ENTRIES_PER_LINE;

export type AccessPattern = "indexed" | "uniform";

function byte(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new RangeError("Expected one byte (0..255)");
}

/** The set of lines visible to an ideal observer for one known plaintext byte. */
export function observedLines(plaintextByte: number, keyByte: number, pattern: AccessPattern): number[] {
  byte(plaintextByte);
  byte(keyByte);
  if (pattern === "uniform") return Array.from({ length: LINE_COUNT }, (_, i) => i);
  if (pattern === "indexed") return [Math.floor((plaintextByte ^ keyByte) / ENTRIES_PER_LINE)];
  throw new Error("Unknown access pattern");
}

/** Key-byte guesses consistent with exactly that idealized line observation. */
export function consistentKeys(plaintextByte: number, lines: readonly number[], pattern: AccessPattern): number[] {
  byte(plaintextByte);
  const candidates: number[] = [];
  for (let guess = 0; guess < 256; guess++) {
    const predicted = observedLines(plaintextByte, guess, pattern);
    if (predicted.length === lines.length && predicted.every((line, i) => line === lines[i])) {
      candidates.push(guess);
    }
  }
  return candidates;
}
