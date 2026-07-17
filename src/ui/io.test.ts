import { describe, it, expect } from "vitest";
import { parseHashState, encodeHashState, serializeGuessCsv, parseTracesCsv, exampleCsv } from "./io";

describe("permalink hash state", () => {
  it("round-trips", () => {
    const s = { traces: 2500, noise: 3, seed: 42 };
    expect(parseHashState(encodeHashState(s))).toEqual(s);
  });
  it("ignores junk and missing keys", () => {
    expect(parseHashState("#traces=100&noise=x")).toEqual({ traces: 100 });
    expect(parseHashState("")).toEqual({});
  });
});

describe("CSV export", () => {
  it("serializes per-guess correlations with a header", () => {
    const csv = serializeGuessCsv(new Float64Array([0.1, 0.5]));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("guess_hex,guess_dec,peak_abs_correlation");
    expect(lines[1]).toBe("0x00,0,0.100000");
    expect(lines[2]).toBe("0x01,1,0.500000");
  });
});

describe("CSV trace import", () => {
  it("parses a headered file", () => {
    const csv = "plaintext_byte,s0,s1\n10,1.5,2.5\n0x20,3,4\n255,5,6\n";
    const t = parseTracesCsv(csv);
    expect(t.numSamples).toBe(2);
    expect(Array.from(t.plaintextByte)).toEqual([10, 32, 255]);
    expect(Array.from(t.traces[1])).toEqual([3, 4]);
  });

  it("parses a headerless file", () => {
    const t = parseTracesCsv("1,0.1,0.2\n2,0.3,0.4\n");
    expect(t.traces.length).toBe(2);
    expect(t.numSamples).toBe(2);
  });

  it("rejects ragged rows, bad bytes, and too-few traces", () => {
    expect(() => parseTracesCsv("1,0.1,0.2\n2,0.3\n")).toThrow(/expected 2 samples/);
    expect(() => parseTracesCsv("300,0.1\n2,0.3\n")).toThrow(/0–255/);
    expect(() => parseTracesCsv("1,0.1\n")).toThrow(/at least 2 traces/);
    expect(() => parseTracesCsv("")).toThrow(/empty/);
  });

  it("re-imports its own exampleCsv losslessly (byte values)", () => {
    const pt = [17, 42, 200];
    const traces = [Float64Array.from([1, 2, 3]), Float64Array.from([4, 5, 6]), Float64Array.from([7, 8, 9])];
    const round = parseTracesCsv(exampleCsv(pt, traces));
    expect(Array.from(round.plaintextByte)).toEqual(pt);
    expect(round.numSamples).toBe(3);
  });
});
