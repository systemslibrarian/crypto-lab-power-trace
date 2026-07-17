/**
 * Reproducibility plumbing: URL permalinks, JSON/CSV export, and CSV trace import.
 * The parse/serialize functions are pure (DOM-free) so they are unit-tested in
 * io.test.ts; only the download/clipboard helpers touch the document.
 */

export interface CpaFigureState {
  traces: number;
  noise: number; // sigma
  seed: number;
}

/** Read figure state from a `#traces=..&noise=..&seed=..` URL hash. */
export function parseHashState(hash: string): Partial<CpaFigureState> {
  const out: Partial<CpaFigureState> = {};
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const t = num("traces");
  const n = num("noise");
  const s = num("seed");
  if (t !== undefined) out.traces = t;
  if (n !== undefined) out.noise = n;
  if (s !== undefined) out.seed = s;
  return out;
}

/** Serialize figure state into a hash fragment (with leading `#`). */
export function encodeHashState(s: CpaFigureState): string {
  return `#traces=${s.traces}&noise=${s.noise}&seed=${s.seed}`;
}

/** Per-guess correlation table as CSV text. */
export function serializeGuessCsv(scores: ArrayLike<number>): string {
  const rows = ["guess_hex,guess_dec,peak_abs_correlation"];
  for (let g = 0; g < scores.length; g++) {
    rows.push(`0x${g.toString(16).toUpperCase().padStart(2, "0")},${g},${scores[g].toFixed(6)}`);
  }
  return rows.join("\n") + "\n";
}

export interface ImportedTraces {
  plaintextByte: Uint8Array;
  traces: Float64Array[];
  numSamples: number;
}

/**
 * Parse a trace CSV. Format: one trace per row, first column the plaintext byte
 * (decimal or 0x-hex), remaining columns the power samples. An optional header
 * row is auto-detected and skipped. Throws with a clear message on malformed input.
 */
export function parseTracesCsv(text: string): ImportedTraces {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("The file is empty.");

  // Detect a header row: first cell of first line is not a number.
  const firstCells = lines[0].split(",");
  const looksHeader = firstCells.length > 0 && Number.isNaN(Number(firstCells[0].trim()));
  const dataLines = looksHeader ? lines.slice(1) : lines;
  if (dataLines.length === 0) throw new Error("No data rows found (only a header).");

  const plaintext: number[] = [];
  const traces: Float64Array[] = [];
  let numSamples = -1;

  dataLines.forEach((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 2) throw new Error(`Row ${i + 1}: need a plaintext byte plus at least one sample.`);
    const pt = cells[0].startsWith("0x") || cells[0].startsWith("0X") ? parseInt(cells[0], 16) : Number(cells[0]);
    if (!Number.isFinite(pt) || pt < 0 || pt > 255) throw new Error(`Row ${i + 1}: plaintext byte must be 0–255.`);
    const samples = cells.slice(1).map((c) => Number(c));
    if (samples.some((v) => !Number.isFinite(v))) throw new Error(`Row ${i + 1}: a sample is not a number.`);
    if (numSamples === -1) numSamples = samples.length;
    else if (samples.length !== numSamples) throw new Error(`Row ${i + 1}: expected ${numSamples} samples, got ${samples.length}.`);
    plaintext.push(pt & 0xff);
    traces.push(Float64Array.from(samples));
  });

  if (traces.length < 2) throw new Error("Need at least 2 traces to correlate.");
  return { plaintextByte: Uint8Array.from(plaintext), traces, numSamples };
}

/** Build a small example CSV (from the lab's own simulated generator settings). */
export function exampleCsv(plaintextByte: ArrayLike<number>, traces: ArrayLike<number>[]): string {
  const ns = traces[0].length;
  const header = ["plaintext_byte", ...Array.from({ length: ns }, (_, i) => `s${i}`)].join(",");
  const rows = [header];
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i];
    const cells = [String(plaintextByte[i])];
    for (let j = 0; j < ns; j++) cells.push((t[j] as number).toFixed(4));
    rows.push(cells.join(","));
  }
  return rows.join("\n") + "\n";
}

/* ---- DOM side effects (not imported by unit tests) ------------------- */

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Copy text to the clipboard; resolves false if the browser blocks it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
