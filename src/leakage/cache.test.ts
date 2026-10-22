import { describe, expect, it } from "vitest";
import { consistentKeys, observedLines } from "./cache";

describe("idealized AES T-table cache-line observation", () => {
  it("exposes only a 16-entry line, leaving 16 key-byte candidates, not a unique key", () => {
    const observed = observedLines(0, 0x2b, "indexed");
    expect(observed).toEqual([2]);
    expect(consistentKeys(0, observed, "indexed"))
      .toEqual(Array.from({ length: 16 }, (_, i) => 0x20 + i));
  });

  it("agrees with independent 4-byte-entry, 64-byte-line arithmetic for every byte", () => {
    for (const plaintext of [0, 1, 15, 16, 42, 128, 255]) {
      for (let key = 0; key < 256; key++) {
        const line = Math.floor(((plaintext ^ key) * 4) / 64);
        const observed = observedLines(plaintext, key, "indexed");
        expect(observed).toEqual([line]);
        const candidates = consistentKeys(plaintext, observed, "indexed");
        expect(candidates).toHaveLength(16);
        expect(candidates).toContain(key);
        expect(candidates.every((guess) => Math.floor(((plaintext ^ guess) * 4) / 64) === line)).toBe(true);
      }
    }
  });

  it("uniform all-lines access conveys no key-byte information for every plaintext", () => {
    for (const plaintext of [0, 15, 64, 128, 255]) {
      const reference = observedLines(plaintext, 0, "uniform");
      expect(reference).toEqual(Array.from({ length: 16 }, (_, i) => i));
      for (const key of [1, 0x2b, 0x80, 0xff]) {
        expect(observedLines(plaintext, key, "uniform")).toEqual(reference);
      }
      expect(consistentKeys(plaintext, reference, "uniform")).toHaveLength(256);
    }
  });

  it("rejects non-byte input rather than silently wrapping", () => {
    expect(() => observedLines(256, 0, "indexed")).toThrow(RangeError);
    expect(() => observedLines(0, -1, "uniform")).toThrow(RangeError);
    expect(() => consistentKeys(NaN, [0], "indexed")).toThrow(RangeError);
  });
});
