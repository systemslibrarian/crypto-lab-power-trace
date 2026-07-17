import { describe, it, expect } from "vitest";
import { SBOX, gmul, gInverse, sBoxOut, encryptBlock, keyExpansion, hexToBytes, bytesToHex } from "./aes";

describe("GF(2^8) arithmetic", () => {
  it("multiplies with the AES reduction polynomial", () => {
    // Classic FIPS-197 example: 0x57 · 0x83 = 0xc1.
    expect(gmul(0x57, 0x83)).toBe(0xc1);
    expect(gmul(0x57, 0x13)).toBe(0xfe);
    expect(gmul(0x00, 0xab)).toBe(0x00);
    expect(gmul(0x01, 0xab)).toBe(0xab);
  });

  it("computes multiplicative inverses (a · a^-1 = 1)", () => {
    for (let a = 1; a < 256; a++) {
      expect(gmul(a, gInverse(a))).toBe(1);
    }
    expect(gInverse(0)).toBe(0);
  });
});

describe("AES S-box (derived from first principles)", () => {
  it("matches known FIPS-197 S-box entries (KAT)", () => {
    expect(SBOX[0x00]).toBe(0x63);
    expect(SBOX[0x01]).toBe(0x7c);
    expect(SBOX[0x10]).toBe(0xca);
    expect(SBOX[0x53]).toBe(0xed);
    expect(SBOX[0x7a]).toBe(0xda);
    expect(SBOX[0xff]).toBe(0x16);
  });

  it("is a bijection over all 256 bytes", () => {
    const seen = new Set(SBOX);
    expect(seen.size).toBe(256);
  });

  it("exposes the first-round intermediate SBOX[p ^ k]", () => {
    expect(sBoxOut(0x00, 0x00)).toBe(0x63);
    expect(sBoxOut(0x32, 0x2b)).toBe(SBOX[0x32 ^ 0x2b]);
  });
});

describe("AES-128 key expansion", () => {
  it("matches FIPS-197 Appendix A round keys", () => {
    const rk = keyExpansion(hexToBytes("2b7e151628aed2a6abf7158809cf4f3c"));
    // Word 4 (first word of round key 1) = 0xa0fafe17.
    expect(bytesToHex(rk.slice(16, 20))).toBe("a0fafe17");
    // Last round-key word (word 43) = 0xb6630ca6.
    expect(bytesToHex(rk.slice(172, 176))).toBe("b6630ca6");
  });
});

describe("AES-128 encryption — FIPS-197 known-answer tests", () => {
  const vectors = [
    {
      name: "FIPS-197 §C.1",
      key: "000102030405060708090a0b0c0d0e0f",
      pt: "00112233445566778899aabbccddeeff",
      ct: "69c4e0d86a7b0430d8cdb78070b4c55a",
    },
    {
      name: "FIPS-197 Appendix B",
      key: "2b7e151628aed2a6abf7158809cf4f3c",
      pt: "3243f6a8885a308d313198a2e0370734",
      ct: "3925841d02dc09fbdc118597196a0b32",
    },
    {
      name: "Zero key / zero block",
      key: "00000000000000000000000000000000",
      pt: "00000000000000000000000000000000",
      ct: "66e94bd4ef8a2c3b884cfa59ca342b2e",
    },
  ];

  for (const v of vectors) {
    it(`${v.name}`, () => {
      const out = encryptBlock(hexToBytes(v.pt), hexToBytes(v.key));
      expect(bytesToHex(out)).toBe(v.ct);
    });
  }
});
