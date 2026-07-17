import "../../styles/main.css";
import { el, hex, fmt } from "./dom";
import { bindChart, initCanvasTheming } from "./canvas";
import { drawGuessPlot, drawSeparation, drawNoiseCurve, drawSpaTrace } from "./charts";
import { hexToBytes } from "../aes/aes";
import { generateTraces, type TraceSet } from "../leakage/traces";
import { cpaAttack, cpaSeparation, cpaFromArrays, type CpaResult } from "../attack/cpa";
import { dpaAttack, minTracesToRecover } from "../attack/dpa";
import { alignTraces, withTraces } from "../attack/align";
import { spaExponentiate, readExponentFromOps } from "../spa/modexp";
import {
  parseHashState,
  encodeHashState,
  serializeGuessCsv,
  parseTracesCsv,
  exampleCsv,
  download,
  copyText,
} from "./io";

/** The fixed demo target: byte 0 of this AES-128 key (0x2B). */
const DEMO_KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");
const KEY_BYTE = DEMO_KEY[0];
const MAX_TRACES = 5000;

function geometric(min: number, max: number, count: number): number[] {
  const out: number[] = [];
  const lo = Math.log(min);
  const hi = Math.log(max);
  for (let i = 0; i < count; i++) {
    out.push(Math.round(Math.exp(lo + ((hi - lo) * i) / (count - 1))));
  }
  return Array.from(new Set(out.filter((n) => n >= 2)));
}

function statusRegion(id: string): HTMLParagraphElement {
  return el("p", { id, class: "status-region", role: "status", "aria-live": "polite" });
}

function setAria(canvas: HTMLCanvasElement, label: string): void {
  canvas.setAttribute("aria-label", label);
}

/* ===================================================================== */
/* Hero + intro                                                          */
/* ===================================================================== */

function hero(): HTMLElement {
  return el("header", { class: "cl-hero" }, [
    el("div", { class: "cl-hero-main" }, [
      el("h1", { class: "cl-hero-title" }, ["Power Trace"]),
      el("p", { class: "cl-hero-sub" }, ["SPA · DPA · CPA · masking countermeasures"]),
      el("p", { class: "cl-hero-desc" }, [
        "Correlate a Hamming-weight model against traces a real AES-128 leaked just by running, and watch one key-byte guess spike out of 256 as the trace count climbs — no bug, no timing, the key still walks out through the power rail.",
      ]),
    ]),
    el("aside", { class: "cl-hero-why", "aria-label": "Why it matters" }, [
      el("span", { class: "cl-hero-why-label" }, ["WHY IT MATTERS"]),
      el("p", { class: "cl-hero-why-text" }, [
        "Constant-time, spec-correct, bug-free code is not enough: smart cards, TPMs, and IoT chips leak their keys through power and EM whether or not the software is perfect. Side-channel resistance is a hardware-and-countermeasure problem, and pretending the maths being right settles it is how real keys get extracted.",
      ]),
    ]),
  ]);
}

function intro(): HTMLElement {
  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Start here"]),
    el("h2", {}, ["What is a power side-channel?"]),
    el("p", { class: "lead" }, [
      "Every time a chip computes, its transistors switch, and switching draws current. A CMOS gate pulls roughly as much current as the number of bits it flips. So the power a chip consumes is quietly correlated with the data it is handling — including secret data.",
    ]),
    el("p", { class: "note" }, [
      "A ",
      el("em", {}, ["timing"]),
      " attack measures how long the secret took. A ",
      el("em", {}, ["power"]),
      " attack measures how hard the transistors worked. This lab is about the second one: the cipher below is constant-time, its maths is correct, and it has no implementation bug — and its key still leaks. Nothing here depends on your code being wrong.",
    ]),
    el("p", { class: "note caveat" }, [
      "The AES-128 and the Pearson correlation on this page are real. The power traces are ",
      el("strong", {}, ["simulated"]),
      " from the cipher's real intermediate values (leakage = Hamming weight of the real S-box output, plus noise). Real attacks capture on an oscilloscope; what transfers is the leakage model, the statistics, and the trace-count economics — see the honesty panel at the bottom.",
    ]),
  ]);
}

/* ===================================================================== */
/* SPA — the free win                                                    */
/* ===================================================================== */

function spaSection(): HTMLElement {
  const BASE = 3n;
  const MOD = 3233n;
  const input = el("input", {
    type: "text",
    id: "spa-exp",
    value: "0b110101101",
    "aria-label": "Secret exponent (decimal, 0x hex, or 0b binary)",
    spellcheck: false,
  }) as HTMLInputElement;
  const runBtn = el("button", { id: "spa-run", type: "button" }, ["Capture one trace & read it"]);
  const canvas = el("canvas", { id: "spa-canvas", role: "img", "aria-label": "Power trace of square-and-multiply exponentiation (press the button to render)" }) as HTMLCanvasElement;
  const bitRow = el("div", { id: "spa-bits", class: "bit-read" });
  const status = statusRegion("spa-status");
  const table = el("div", { id: "spa-table" });
  const redraw = bindChart(canvas, 150);

  function run(): void {
    let exp: bigint;
    try {
      exp = BigInt(input.value.trim());
      if (exp < 0n) throw new Error();
    } catch {
      status.textContent = "Enter a non-negative integer (decimal, 0x…, or 0b…).";
      return;
    }
    const trace = spaExponentiate(BASE, exp, MOD);
    const recovered = readExponentFromOps(trace.ops);
    redraw((ctx, w, h, c) => drawSpaTrace(ctx, w, h, c, trace.ops));
    setAria(
      canvas,
      `Power trace of square-and-multiply for a ${trace.bits.length}-bit exponent: ${trace.ops.length} operations, short squares and long multiplies in sequence.`,
    );

    bitRow.replaceChildren(
      ...trace.bits.map((b, i) =>
        el("div", { class: `bit-cell${b === 1 ? " one" : ""}` }, [
          el("span", { class: "bit" }, [String(b)]),
          el("span", { class: "pat" }, [b === 1 ? "S·M" : "S"]),
          el("span", { class: "pat" }, [`b${i}`]),
        ]),
      ),
    );

    const match = recovered.value === exp;
    status.textContent =
      `Read ${trace.bits.length} bits straight off the widths — square-then-multiply is a 1, a lone square is a 0: ` +
      `${recovered.bits.join("")} = ${recovered.value} (decimal). ${match ? "Matches the secret exponent exactly" : "Mismatch"}. ` +
      `One trace, no averaging. In RSA this exponent is the private key.`;

    table.replaceChildren(
      el("details", { class: "data" }, [
        el("summary", {}, ["Operation sequence (table)"]),
        el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": "SPA operation sequence" }, [
          el("table", {}, [
            el("caption", {}, [`base^exp mod ${MOD} = ${trace.value}`]),
            el("thead", {}, [el("tr", {}, [th("Step"), th("Operation"), th("Bit index"), th("Reads as")])]),
            el(
              "tbody",
              {},
              trace.ops.map((op, i) =>
                el("tr", {}, [
                  el("th", { scope: "row" }, [String(i + 1)]),
                  td(op.kind),
                  td(String(op.bit)),
                  td(op.kind === "multiply" ? "1" : "·"),
                ]),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  runBtn.addEventListener("click", run);
  queueMicrotask(run);

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 1 — Simple Power Analysis"]),
    el("h2", {}, ["Read a secret exponent off a single trace"]),
    el("p", { class: "note" }, [
      "Square-and-multiply exponentiation (the core of textbook RSA) squares on every exponent bit and multiplies only when the bit is 1. A square and a multiply take different amounts of work, so they look different on the power rail. No statistics — one trace, read with your eyes. (The exponentiation is real BigInt maths; the arithmetic itself lives in ",
      el("a", { href: "https://systemslibrarian.github.io/crypto-lab-rsa-educational/" }, ["crypto-lab-rsa-educational"]),
      ".)",
    ]),
    el("div", { class: "controls" }, [
      el("div", { class: "control-row" }, [
        el("label", { for: "spa-exp" }, ["Secret exponent"]),
        input,
      ]),
    ]),
    el("div", { class: "btn-row" }, [runBtn]),
    el("figure", {}, [el("figcaption", {}, [`One power trace of 3^exp mod ${MOD} — square-and-multiply`]), canvas]),
    bitRow,
    status,
    table,
    el("p", { class: "note" }, [
      'This is the hook and the "what this isn\'t": SPA reads structure off one trace. The rest of the lab is about the harder case — when the secret does not change the ',
      el("em", {}, ["control flow"]),
      " at all, only the ",
      el("em", {}, ["data"]),
      ", and you need statistics to pull it out.",
    ]),
  ]);
}

/* ===================================================================== */
/* CPA — the headline                                                    */
/* ===================================================================== */

function cpaSection(): HTMLElement {
  const traceSlider = rangeInput("cpa-traces", 10, MAX_TRACES, 10, 400);
  const noiseSlider = rangeInput("cpa-noise", 5, 120, 5, 30); // /10 -> 0.5..12.0
  const seedInput = el("input", {
    type: "text",
    id: "cpa-seed",
    value: "1234",
    inputmode: "numeric",
    spellcheck: false,
    "aria-label": "Trace-generation seed (for reproducible figures)",
  }) as HTMLInputElement;
  const traceVal = el("span", { class: "val", id: "cpa-traces-val" });
  const noiseVal = el("span", { class: "val", id: "cpa-noise-val" });
  const runBtn = el("button", { id: "cpa-run", type: "button" }, ["Run the attack"]);

  const canvas = el("canvas", { id: "cpa-canvas", role: "img", "aria-label": "Peak correlation per key-byte guess" }) as HTMLCanvasElement;
  const sepCanvas = el("canvas", { id: "cpa-sep-canvas", role: "img", "aria-label": "Correct-byte vs best-wrong correlation as traces climb" }) as HTMLCanvasElement;
  const drawGuess = bindChart(canvas, 220);
  const drawSep = bindChart(sepCanvas, 180);

  const cipherInd = el("div", { class: "indicator factual", id: "cpa-cipher" });
  const verdictInd = el("div", { class: "indicator neutral", id: "cpa-verdict", role: "status", "aria-live": "polite" });
  const recovered = el("div", { class: "recovered", id: "cpa-recovered" });
  const table = el("div", { id: "cpa-table" });

  // Reproducibility: permalink + freeze-and-compare + export.
  const freezeBtn = el("button", { id: "cpa-freeze", type: "button", class: "secondary" }, ["Freeze current"]);
  const clearBtn = el("button", { id: "cpa-clear-frozen", type: "button", class: "secondary" }, ["Clear frozen"]);
  const linkBtn = el("button", { id: "cpa-link", type: "button", class: "secondary" }, ["Copy figure link"]);
  const jsonBtn = el("button", { id: "cpa-json", type: "button", class: "secondary" }, ["Download JSON"]);
  const csvBtn = el("button", { id: "cpa-csv", type: "button", class: "secondary" }, ["Download CSV"]);
  const repoStatus = statusRegion("cpa-repro-status");
  let frozen: Float64Array | undefined;
  let lastRes: CpaResult | null = null;

  let cache: { noise: number; seed: number; ts: TraceSet } | null = null;
  function tracesFor(noise: number, seed: number): TraceSet {
    if (!cache || cache.noise !== noise || cache.seed !== seed) {
      cache = { noise, seed, ts: generateTraces({ numTraces: MAX_TRACES, key: DEMO_KEY, noise, seed }) };
    }
    return cache.ts;
  }

  function currentSeed(): number {
    const s = parseInt(seedInput.value, 10);
    return Number.isFinite(s) ? s : 1234;
  }

  function render(): void {
    const n = Number(traceSlider.value);
    const noise = Number(noiseSlider.value) / 10;
    traceVal.textContent = String(n);
    noiseVal.textContent = fmt(noise, 1);

    const seed = currentSeed();
    const ts = tracesFor(noise, seed);
    const res = cpaAttack(ts, n);
    lastRes = res;
    const rank = res.ranking.indexOf(KEY_BYTE) + 1;
    const isRecovered = res.best === KEY_BYTE;

    // Keep the URL a live permalink to the current figure (no navigation).
    history.replaceState(null, "", encodeHashState({ traces: n, noise, seed }));

    drawGuess((ctx, w, h, c) => drawGuessPlot(ctx, w, h, c, { scores: res.scores, trueByte: KEY_BYTE, recovered: isRecovered, frozen }));
    setAria(
      canvas,
      `Peak correlation for all 256 key-byte guesses at ${n} traces. The true byte ${hex(KEY_BYTE)} ` +
        (isRecovered ? `stands alone at correlation ${fmt(res.scores[KEY_BYTE], 2)} — recovered.` : `ranks #${rank}, not yet separated from the pack.`),
    );

    const sep = cpaSeparation(ts, geometric(10, Math.max(20, n), 8));
    drawSep((ctx, w, h, c) => drawSeparation(ctx, w, h, c, sep));
    setAria(
      sepCanvas,
      `Correlation of the correct key byte versus the best wrong guess as traces climb to ${n}. The gap widens with more traces.`,
    );

    // Indicator 1 — the cryptographic result (factual, never "green success").
    cipherInd.replaceChildren(
      el("span", { class: "ind-label" }, ["Cryptographic result"]),
      el("p", { class: "ind-value" }, ["AES-128 encryption: correct ✓"]),
      el("p", { class: "ind-sub" }, [
        "Constant-time, spec-conformant (FIPS-197 KATs pass), no implementation bug. The cipher did nothing wrong.",
      ]),
    );

    // Indicator 2 — the security verdict (separate; ALARM tracks integrity, not the return value).
    verdictInd.className = "indicator " + (isRecovered ? "alarm" : "neutral");
    verdictInd.replaceChildren(
      el("span", { class: "ind-label" }, ["Security verdict"]),
      el("p", { class: "ind-value" }, [isRecovered ? "⚠ Key byte leaked" : "Not yet recovered"]),
      el("p", { class: "ind-sub" }, [
        isRecovered
          ? `Byte 0 of the AES-128 key recovered as ${hex(KEY_BYTE)} from power alone, at ${n} traces. In AES-128 the first round key is the cipher key, so this is a real encryption-key byte — not a MAC or authentication key. The maths is intact; the leak is in the hardware model, not the algorithm.`
          : `Best guess ${hex(res.best)} ranks #${rank} of 256 at ${n} traces (correlation ${fmt(res.scores[res.best], 2)}). Drag traces up or noise down and watch the true byte separate.`,
      ]),
    );

    recovered.replaceChildren(
      el("span", { class: "muted" }, ["Recovered byte 0:"]),
      el("span", { class: `byte-box ${isRecovered ? "leaked" : "pending"}` }, [isRecovered ? hex(KEY_BYTE) : hex(res.best)]),
      el("span", { class: "stat-line muted" }, [
        `rank #${rank} of 256 · peak r = ${fmt(res.scores[res.best], 3)} · ${n} traces`,
      ]),
    );

    table.replaceChildren(
      el("details", { class: "data" }, [
        el("summary", {}, ["Top 8 key-byte candidates (table)"]),
        el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": "CPA candidate ranking" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, [th("Rank"), th("Guess"), th("Peak |r|"), th("Is key?")])]),
            el(
              "tbody",
              {},
              res.ranking.slice(0, 8).map((g, i) =>
                el("tr", {}, [
                  el("th", { scope: "row" }, [String(i + 1)]),
                  td(hex(g)),
                  td(fmt(res.scores[g], 3)),
                  td(g === KEY_BYTE ? "yes" : "—"),
                ]),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  let scheduled = false;
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }
  traceSlider.addEventListener("input", () => {
    traceVal.textContent = traceSlider.value;
    schedule();
  });
  noiseSlider.addEventListener("input", () => {
    noiseVal.textContent = fmt(Number(noiseSlider.value) / 10, 1);
    schedule();
  });
  seedInput.addEventListener("change", render);
  runBtn.addEventListener("click", render);

  freezeBtn.addEventListener("click", () => {
    if (!lastRes) return;
    frozen = lastRes.scores.slice();
    repoStatus.textContent = `Froze the current curve at ${traceSlider.value} traces / σ=${fmt(Number(noiseSlider.value) / 10, 1)}. Move the sliders to compare against it (faint gold overlay).`;
    render();
  });
  clearBtn.addEventListener("click", () => {
    frozen = undefined;
    repoStatus.textContent = "Cleared the frozen baseline.";
    render();
  });
  linkBtn.addEventListener("click", async () => {
    const url = location.href;
    const ok = await copyText(url);
    repoStatus.textContent = ok ? "Copied a permalink to this exact figure to your clipboard." : `Permalink: ${url}`;
  });
  jsonBtn.addEventListener("click", () => {
    if (!lastRes) return;
    const payload = {
      lab: "crypto-lab-power-trace",
      attack: "CPA (Brier-Clavier-Olivier 2004)",
      settings: { traces: Number(traceSlider.value), noise: Number(noiseSlider.value) / 10, seed: currentSeed() },
      target: { key_byte_index: 0, true_byte_hex: hex(KEY_BYTE) },
      result: {
        recovered_byte_hex: hex(lastRes.best),
        recovered: lastRes.best === KEY_BYTE,
        true_byte_rank: lastRes.ranking.indexOf(KEY_BYTE) + 1,
        peak_correlation: Number(lastRes.scores[lastRes.best].toFixed(6)),
      },
    };
    download("power-trace-cpa-result.json", JSON.stringify(payload, null, 2), "application/json");
    repoStatus.textContent = "Downloaded the result as JSON (settings + recovered byte + rank).";
  });
  csvBtn.addEventListener("click", () => {
    if (!lastRes) return;
    download("power-trace-cpa-correlations.csv", serializeGuessCsv(lastRes.scores), "text/csv");
    repoStatus.textContent = "Downloaded the per-guess correlations as CSV (256 rows).";
  });

  // Restore figure state from a shared permalink, if present.
  const restored = parseHashState(location.hash);
  if (restored.traces !== undefined) traceSlider.value = String(Math.max(10, Math.min(MAX_TRACES, restored.traces)));
  if (restored.noise !== undefined) noiseSlider.value = String(Math.max(5, Math.min(120, Math.round(restored.noise * 10))));
  if (restored.seed !== undefined) seedInput.value = String(restored.seed);
  queueMicrotask(render);

  return el("section", { class: "panel headline" }, [
    el("span", { class: "step" }, ["Exhibit 2 — Correlation Power Analysis · the headline"]),
    el("h2", {}, ["Break it yourself: pull an AES key byte out of the noise"]),
    el("p", { class: "note" }, [
      "For each of the 256 possible values of key byte 0, predict the leakage ",
      el("code", {}, ["HW(SBox(p ⊕ k))"]),
      " for every trace and correlate that prediction against the measured power. The wrong 255 predict the wrong intermediate and stay in the noise. The one correct guess predicts the real intermediate and spikes. ",
      el("strong", {}, ["Drag the sliders"]),
      " and watch the true byte separate.",
    ]),
    el("div", { class: "controls" }, [
      el("div", { class: "control-row" }, [
        el("label", { for: "cpa-traces" }, ["Traces used: ", traceVal]),
        traceSlider,
      ]),
      el("div", { class: "control-row" }, [
        el("label", { for: "cpa-noise" }, ["Measurement noise σ: ", noiseVal]),
        noiseSlider,
      ]),
      el("div", { class: "control-row" }, [
        el("label", { for: "cpa-seed" }, ["Trace seed (reproducible figures)"]),
        seedInput,
      ]),
    ]),
    el("p", { class: "note" }, [
      "Everything here is deterministic: the same seed, trace count, and noise reproduce the exact figure. Change the seed to draw a fresh independent trace set and confirm the result is not a fluke of one sample.",
    ]),
    el("div", { class: "btn-row" }, [runBtn]),
    el("figure", {}, [
      el("figcaption", {}, ["Peak correlation per key-byte guess — one line spikes out of 256"]),
      canvas,
    ]),
    el("div", { class: "indicators two" }, [cipherInd, verdictInd]),
    recovered,
    el("figure", {}, [
      el("figcaption", {}, ["The spike separating: correct byte (red) vs best wrong guess (grey) as traces climb"]),
      sepCanvas,
    ]),
    table,
    el("p", { class: "subhead" }, ["Reproduce & compare"]),
    el("p", { class: "note" }, [
      "Freeze the current curve to leave a faint baseline, then move a slider and compare. Copy a permalink that reopens this exact figure, or export the numbers.",
    ]),
    el("div", { class: "btn-row" }, [freezeBtn, clearBtn, linkBtn, jsonBtn, csvBtn]),
    repoStatus,
    el("p", { class: "note caveat" }, [
      "This is verdict separation in one screen: the ",
      el("strong", {}, ["cryptographic result"]),
      " (AES ran correctly) and the ",
      el("strong", {}, ["security verdict"]),
      " (its key leaked) are independent. A correct cipher whose key leaked reads as ALARM, not green — because color tracks whether the secret is still secret, not whether the function returned the right bytes.",
    ]),
  ]);
}

/* ===================================================================== */
/* Noise economics — the √N / σ² cost                                    */
/* ===================================================================== */

function noiseSection(): HTMLElement {
  const runBtn = el("button", { id: "noise-run", type: "button" }, ["Sweep the noise floor"]);
  const canvas = el("canvas", { id: "noise-canvas", role: "img", "aria-label": "Traces needed to recover versus measurement noise (press the button to run)" }) as HTMLCanvasElement;
  const status = statusRegion("noise-status");
  const table = el("div", { id: "noise-table" });
  const redraw = bindChart(canvas, 240);

  function run(): void {
    const noises = [1, 2, 3, 4, 6, 8, 10];
    const cps = geometric(20, MAX_TRACES, 12);
    const points = noises.map((noise) => {
      const ts = generateTraces({ numTraces: MAX_TRACES, key: DEMO_KEY, noise, seed: 777 });
      const traces = minTracesToRecover("cpa", ts, cps);
      return { noise, traces, cap: MAX_TRACES };
    });
    redraw((ctx, w, h, c) => drawNoiseCurve(ctx, w, h, c, points));
    setAria(
      canvas,
      "Traces needed to recover the key byte versus measurement noise: the count grows steeply with noise, roughly as the square of sigma.",
    );

    const shown = points.filter((p) => p.traces !== null);
    const first = shown[0];
    const last = shown[shown.length - 1];
    status.textContent =
      `Raising the noise never closed the channel — it only raised the price. At σ = ${first.noise} the key byte fell in ${first.traces} traces; ` +
      `at σ = ${last.noise} it took ${last.traces}. Roughly, traces-to-recover grows with σ² (double the noise ≈ 4× the traces), so the attacker's cost scales with noise but the leak stays.`;

    table.replaceChildren(
      el("details", { class: "data" }, [
        el("summary", {}, ["Traces-to-recover vs noise (table)"]),
        el("div", { class: "tablewrap", role: "region", tabindex: "0", "aria-label": "Noise cost table" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, [th("Noise σ"), th("Traces to recover")])]),
            el(
              "tbody",
              {},
              points.map((p) =>
                el("tr", {}, [el("th", { scope: "row" }, [String(p.noise)]), td(p.traces === null ? `> ${MAX_TRACES}` : String(p.traces))]),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  runBtn.addEventListener("click", run);

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 3 — the economics of noise"]),
    el("h2", {}, ["Noise doesn't stop the attack. It sets the price."]),
    el("p", { class: "note" }, [
      "The correlation of a wrong guess falls as roughly 1/√N with the number of traces N, so to lift a weaker signal above the noise you need proportionally more traces. Raising the measurement noise σ pushes the required trace count up (about σ²) — but the channel is still open. This is why real evaluations quote a trace budget, not a yes/no.",
    ]),
    el("div", { class: "btn-row" }, [runBtn]),
    el("figure", {}, [el("figcaption", {}, ["Traces needed to recover vs noise σ"]), canvas]),
    status,
    table,
  ]);
}

/* ===================================================================== */
/* Misalignment — cheapest defense, easiest to defeat                    */
/* ===================================================================== */

function misalignSection(): HTMLElement {
  const runBtn = el("button", { id: "align-run", type: "button" }, ["1. Jitter the traces (defend)"]);
  const fixBtn = el("button", { id: "align-fix", type: "button", class: "secondary" }, ["2. Resync & re-attack"]);
  const canvas = el("canvas", { id: "align-canvas", role: "img", "aria-label": "CPA guess plot for jittered and resynchronized traces (press the buttons to run)" }) as HTMLCanvasElement;
  const verdict = el("div", { class: "indicator neutral", id: "align-verdict", role: "status", "aria-live": "polite" });
  const status = statusRegion("align-status");
  const redraw = bindChart(canvas, 220);

  const N = 1500;
  const JIT = 8;

  function attack(aligned: boolean): void {
    const jittered = generateTraces({ numTraces: N, key: DEMO_KEY, noise: 3, seed: 2024, jitter: JIT });
    let ts = jittered;
    if (aligned) {
      const { aligned: fixed } = alignTraces(jittered.traces, JIT + 2);
      ts = withTraces(jittered, fixed);
    }
    const res = cpaAttack(ts);
    const rank = res.ranking.indexOf(KEY_BYTE) + 1;
    const ok = res.best === KEY_BYTE;
    redraw((c2, w, h, c) => drawGuessPlot(c2, w, h, c, { scores: res.scores, trueByte: KEY_BYTE, recovered: ok }));
    setAria(
      canvas,
      `CPA on ${aligned ? "resynchronized" : "jittered"} traces: the true byte ${hex(KEY_BYTE)} ranks #${rank}${ok ? " — recovered" : " — buried in the noise"}.`,
    );

    if (!aligned) {
      verdict.className = "indicator held";
      verdict.replaceChildren(
        el("span", { class: "ind-label" }, ["Security verdict"]),
        el("p", { class: "ind-value" }, ["Attack blocked — for now"]),
        el("p", { class: "ind-sub" }, [
          `With ±${JIT} samples of random jitter, the leak sample lands in a different column on every trace, so CPA correlates against a moving target and collapses (true byte at rank #${rank}). Misalignment is the cheapest real-world defense.`,
        ]),
      );
      status.textContent = "Now press “Resync & re-attack”: the operations still have a consistent shape, so we can cross-correlate each trace to a reference, undo the shift, and try again.";
    } else {
      verdict.className = "indicator " + (ok ? "alarm" : "neutral");
      verdict.replaceChildren(
        el("span", { class: "ind-label" }, ["Security verdict"]),
        el("p", { class: "ind-value" }, [ok ? "⚠ Defense defeated — key byte leaked" : "Partly recovered"]),
        el("p", { class: "ind-sub" }, [
          ok
            ? `Cross-correlation resync re-aligned the traces and CPA recovered ${hex(KEY_BYTE)} again. Jitter raised the attacker's effort (an alignment pass), not the outcome — which is why misalignment alone is not counted as a real countermeasure.`
            : `Alignment improved the rank to #${rank}; add traces to finish. Even imperfect resync claws most of the signal back.`,
        ]),
      );
      status.textContent = `Resynchronized ${N} traces by cross-correlation and re-ran the identical attack.`;
    }
  }

  runBtn.addEventListener("click", () => attack(false));
  fixBtn.addEventListener("click", () => attack(true));

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 4 — trace misalignment"]),
    el("h2", {}, ["The cheapest defense, and why it barely counts"]),
    el("p", { class: "note" }, [
      "If every trace is shifted by a random amount, the leak sample no longer lines up across traces and CPA falls apart. But the operations still have a consistent envelope, so an attacker cross-correlates each trace to a reference, undoes the shift, and re-runs the same attack. Defend, then defeat it.",
    ]),
    el("div", { class: "btn-row" }, [runBtn, fixBtn]),
    el("figure", {}, [el("figcaption", {}, ["CPA guess plot — jittered, then resynchronized"]), canvas]),
    verdict,
    status,
  ]);
}

/* ===================================================================== */
/* DPA vs CPA — the history                                              */
/* ===================================================================== */

function dpaCpaSection(): HTMLElement {
  const runBtn = el("button", { id: "dpacpa-run", type: "button" }, ["Race DPA against CPA"]);
  const dpaCanvas = el("canvas", { id: "dpacpa-dpa", role: "img", "aria-label": "DPA difference-of-means peaks per guess (press the button to run)" }) as HTMLCanvasElement;
  const cpaCanvas = el("canvas", { id: "dpacpa-cpa", role: "img", "aria-label": "CPA correlation peaks per guess (press the button to run)" }) as HTMLCanvasElement;
  const status = statusRegion("dpacpa-status");
  const drawDpa = bindChart(dpaCanvas, 200);
  const drawCpa = bindChart(cpaCanvas, 200);

  function run(): void {
    const ts = generateTraces({ numTraces: 8000, key: DEMO_KEY, noise: 3, seed: 909 });
    const cps = [50, 100, 200, 400, 800, 1600, 3200, 6400, 8000];
    const cpaMin = minTracesToRecover("cpa", ts, cps) ?? 8000;
    const dpaMin = minTracesToRecover("dpa", ts, cps, 0) ?? 8000;
    const contrast = Math.min(8000, Math.max(cpaMin * 2, 200));

    const dpaRes = dpaAttack(ts, { bit: 0, numTraces: contrast });
    const cpaRes = cpaAttack(ts, contrast);
    const dpaOk = dpaRes.best === KEY_BYTE;
    const cpaOk = cpaRes.best === KEY_BYTE;

    drawDpa((c2, w, h, c) => drawGuessPlot(c2, w, h, c, { scores: dpaRes.scores, trueByte: KEY_BYTE, recovered: dpaOk }));
    drawCpa((c2, w, h, c) => drawGuessPlot(c2, w, h, c, { scores: cpaRes.scores, trueByte: KEY_BYTE, recovered: cpaOk }));
    setAria(dpaCanvas, `DPA difference-of-means peaks per guess at ${contrast} traces; true byte ${dpaOk ? "recovered" : "not yet separated"}.`);
    setAria(cpaCanvas, `CPA correlation peaks per guess at ${contrast} traces; true byte ${cpaOk ? "recovered" : "not yet separated"}.`);

    status.textContent =
      `Same measurements, two statistics. DPA (Kocher–Jaffe–Jun, 1999) first ranked the key byte #1 at ${dpaMin} traces; ` +
      `CPA (Brier–Clavier–Olivier, 2004) needed only ${cpaMin} — about ${fmt(dpaMin / cpaMin, 1)}× fewer. At the ${contrast}-trace snapshot above, ` +
      `CPA has ${cpaOk ? "already recovered" : "not yet recovered"} the byte and DPA has ${dpaOk ? "also recovered" : "not yet recovered"} it. ` +
      `DPA came first and is why this field exists; CPA's Hamming-weight model simply wrings more out of each trace.`;
  }

  runBtn.addEventListener("click", run);

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 5 — DPA vs CPA"]),
    el("h2", {}, ["The original attack, and the one that replaced it"]),
    el("p", { class: "note" }, [
      "Before correlation, Kocher's Differential Power Analysis partitioned traces by a single predicted bit and subtracted the two average traces; a spike appeared for the correct guess. It works — it just needs many more traces than CPA, which correlates a full Hamming-weight model. Watch both on the same measurements.",
    ]),
    el("div", { class: "btn-row" }, [runBtn]),
    el("figure", {}, [el("figcaption", {}, ["DPA — difference of means (1999)"]), dpaCanvas]),
    el("figure", {}, [el("figcaption", {}, ["CPA — Pearson correlation (2004)"]), cpaCanvas]),
    status,
  ]);
}

/* ===================================================================== */
/* Countermeasures                                                       */
/* ===================================================================== */

function countermeasuresSection(): HTMLElement {
  const modes = [
    ["none", "None (baseline)"],
    ["masking", "Boolean masking"],
    ["shuffling", "Shuffling"],
    ["hiding", "Hiding / noise"],
  ] as const;
  const radios = modes.map(([val, label], i) =>
    el("label", {}, [
      el("input", { type: "radio", name: "cm-mode", value: val, id: `cm-${val}`, ...(i === 0 ? { checked: true } : {}) }),
      label,
    ]),
  );
  const runBtn = el("button", { id: "cm-run", type: "button" }, ["Attack the defended chip"]);
  const canvas = el("canvas", { id: "cm-canvas", role: "img", "aria-label": "First-order CPA against the selected countermeasure (press the button to run)" }) as HTMLCanvasElement;
  const verdict = el("div", { class: "indicator neutral", id: "cm-verdict", role: "status", "aria-live": "polite" });
  const note = el("p", { class: "note caveat", id: "cm-note" });
  const redraw = bindChart(canvas, 220);

  function run(): void {
    const checked = document.querySelector<HTMLInputElement>('input[name="cm-mode"]:checked');
    const mode = (checked?.value ?? "none") as "none" | "masking" | "shuffling" | "hiding";
    const ts = generateTraces({
      numTraces: 4000,
      key: DEMO_KEY,
      noise: 3,
      seed: 555,
      countermeasure: mode === "hiding" ? "none" : mode === "shuffling" ? "shuffling" : mode === "masking" ? "masking" : "none",
      hiding: mode === "hiding" ? 5 : 0,
    });
    const res = cpaAttack(ts);
    const rank = res.ranking.indexOf(KEY_BYTE) + 1;
    const ok = res.best === KEY_BYTE;
    redraw((c2, w, h, c) => drawGuessPlot(c2, w, h, c, { scores: res.scores, trueByte: KEY_BYTE, recovered: ok }));
    setAria(canvas, `First-order CPA against the ${mode} countermeasure at 4000 traces: true byte ${ok ? "recovered" : `hidden (rank #${rank})`}.`);

    const held = !ok && mode === "masking";
    verdict.className = "indicator " + (ok ? "alarm" : held ? "held" : "neutral");
    const value =
      mode === "none"
        ? "⚠ Key byte leaked"
        : held
          ? "First-order CPA defeated"
          : ok
            ? "⚠ Recovered anyway — cost only"
            : `Not recovered (rank #${rank})`;
    const sub: Record<string, string> = {
      none: `Baseline: no countermeasure. Byte 0 recovered as ${hex(KEY_BYTE)} at rank #1.`,
      masking: `Each trace splits the intermediate as s ⊕ m with a fresh random mask m, so no single sample correlates with HW(SBox(p ⊕ k)). First-order CPA finds nothing — the true byte sits at rank #${rank}.`,
      shuffling: `Shuffling spread the target S-box operation across a few time slots. The attack still recovered ${hex(KEY_BYTE)} — it just needed more traces. Shuffling raises the price, it does not close the channel.`,
      hiding: `Injected noise raised σ. The attack still recovered ${hex(KEY_BYTE)} — hiding moves the trace-count cost up, it does not close the channel (see Exhibit 3).`,
    };
    verdict.replaceChildren(
      el("span", { class: "ind-label" }, ["Security verdict"]),
      el("p", { class: "ind-value" }, [value]),
      el("p", { class: "ind-sub" }, [sub[mode]]),
    );

    if (mode === "masking") {
      note.replaceChildren(
        el("strong", {}, ["Honest scope of this defense: "]),
        "first-order masking defeats first-order CPA only. ",
        el("strong", {}, ["Second-order attacks"]),
        " combine two sample points (the one handling the mask and the one handling the masked value) and can defeat it. That higher-order attack is ",
        el("em", {}, ["named here, not built"]),
        " — this panel does not prove masking is secure, only that the first-order correlation is gone.",
      );
    } else {
      note.replaceChildren(
        "Masking is the only defense here that removes the first-order leak; shuffling and hiding raise the attacker's trace budget without closing the channel. Pick “Boolean masking” to see the difference — and its honest caveat.",
      );
    }
  }

  runBtn.addEventListener("click", run);

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 6 — countermeasures"]),
    el("h2", {}, ["Defended, defeated, or just more expensive?"]),
    el("p", { class: "note" }, [
      "Run the identical first-order CPA against three defenses. One removes the leak; two only raise the price. The point is to feel the difference — and to be honest about exactly what each one does and does not buy.",
    ]),
    el("fieldset", {}, [
      el("legend", {}, ["Countermeasure"]),
      el("div", { class: "radio-row" }, radios),
    ]),
    el("div", { class: "btn-row" }, [runBtn]),
    el("figure", {}, [el("figcaption", {}, ["First-order CPA against the selected defense (4000 traces)"]), canvas]),
    verdict,
    note,
  ]);
}

/* ===================================================================== */
/* Bring your own traces — the bench bridge                              */
/* ===================================================================== */

function importSection(): HTMLElement {
  const fileInput = el("input", {
    type: "file",
    id: "import-file",
    accept: ".csv,text/csv",
    "aria-label": "CSV file of power traces to attack",
  }) as HTMLInputElement;
  const exampleBtn = el("button", { id: "import-example", type: "button", class: "secondary" }, ["Download example CSV"]);
  const canvas = el("canvas", { id: "import-canvas", role: "img", "aria-label": "CPA on imported traces (load a CSV to run)" }) as HTMLCanvasElement;
  const recovered = el("div", { class: "recovered", id: "import-recovered" });
  const status = statusRegion("import-status");
  const redraw = bindChart(canvas, 220);

  async function handleFile(file: File): Promise<void> {
    try {
      const { plaintextByte, traces, numSamples } = parseTracesCsv(await file.text());
      const res = cpaFromArrays(plaintextByte, traces, numSamples);
      // We cannot verify the key for imported data, so the winner is the top
      // CANDIDATE (amber), never asserted as "recovered".
      redraw((ctx, w, h, c) => drawGuessPlot(ctx, w, h, c, { scores: res.scores, trueByte: res.best, recovered: false }));
      setAria(canvas, `CPA on ${traces.length} imported traces of ${numSamples} samples: top candidate byte ${hex(res.best)}.`);
      recovered.replaceChildren(
        el("span", { class: "muted" }, ["Top candidate byte:"]),
        el("span", { class: "byte-box pending" }, [hex(res.best)]),
        el("span", { class: "stat-line muted" }, [`peak r = ${fmt(res.scores[res.best], 3)} · ${traces.length} traces · ${numSamples} samples`]),
      );
      status.textContent =
        `Ran the identical real Pearson-correlation CPA on ${traces.length} imported traces (${numSamples} samples each). ` +
        `Top candidate for the target key byte: ${hex(res.best)}. Only the traces changed — the attack code is the same one used above.`;
    } catch (e) {
      status.textContent = `Could not read that file: ${(e as Error).message} Expected: one trace per row — plaintext byte, then the power samples.`;
    }
  }

  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
  });
  exampleBtn.addEventListener("click", () => {
    const ts = generateTraces({ numTraces: 400, key: DEMO_KEY, noise: 3, seed: 2025 });
    download("power-trace-example.csv", exampleCsv(ts.plaintextByte, ts.traces), "text/csv");
    status.textContent =
      "Downloaded a 400-trace example CSV (simulated, from this lab's generator). Re-import it to watch the same CPA surface 0x2B — then try your own capture.";
  });

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Exhibit 7 — bring your own traces"]),
    el("h2", {}, ["Run the real attack on your own data"]),
    el("p", { class: "note" }, [
      "No real hardware capture ships with this lab — but the attack is real, so it will run on any traces in a documented format. Export a capture from a tool like ",
      el("a", { href: "https://www.newae.com/chipwhisperer" }, ["ChipWhisperer"]),
      " to CSV and drop it in: ",
      el("strong", {}, ["one trace per row — the plaintext byte first, then the power samples"]),
      " (an optional header row is fine). The same Pearson-correlation CPA runs on it unchanged.",
    ]),
    el("div", { class: "controls" }, [
      el("div", { class: "control-row" }, [
        el("label", { for: "import-file" }, ["Trace CSV to attack"]),
        fileInput,
      ]),
    ]),
    el("div", { class: "btn-row" }, [exampleBtn]),
    el("figure", {}, [el("figcaption", {}, ["CPA on the imported traces — top candidate highlighted"]), canvas]),
    recovered,
    status,
    el("p", { class: "note caveat" }, [
      "What transfers from this simulated bench to a real one: the leakage model, the statistics, and the trace-count economics. What doesn't: the exact noise physics of a given chip. Imported real traces will usually have many more samples and need alignment and point-of-interest selection first — this importer runs the raw correlation, not a full capture pipeline.",
    ]),
  ]);
}

/* ===================================================================== */
/* Honest scoping + non-goals                                            */
/* ===================================================================== */

function scopingSection(): HTMLElement {
  const li = (label: string, href: string, tail: string) =>
    el("li", {}, [el("a", { href }, [label]), " — ", tail]);

  return el("section", { class: "panel" }, [
    el("span", { class: "step" }, ["Honesty — what this proves and what it doesn't"]),
    el("h2", {}, ["Real crypto, simulated traces"]),
    el("div", { class: "proof two" }, [
      el("div", { class: "proof-col real" }, [
        el("h3", {}, ["What is real here"]),
        el("ul", {}, [
          el("li", {}, ["The AES-128 (hand-rolled, FIPS-197 KATs pass) and its S-box output — the leakage target."]),
          el("li", {}, ["The Pearson correlation, the DPA difference-of-means, and the cross-correlation resync."]),
          el("li", {}, ["The leakage model: power ∝ Hamming weight of the real intermediate value."]),
          el("li", {}, ["The trace-count economics — how the spike separates and how noise raises the cost."]),
        ]),
      ]),
      el("div", { class: "proof-col notreal" }, [
        el("h3", {}, ["What is simulated / NOT proven"]),
        el("ul", {}, [
          el("li", {}, ["The traces are generated from the cipher's real intermediates plus Gaussian noise — not captured from silicon."]),
          el("li", {}, ["Real chips leak a noisier, more complex function; the exact noise characteristics of hardware do not transfer."]),
          el("li", {}, ["This does not prove any specific device is vulnerable — it shows why the class of attack works."]),
          el("li", {}, ["Masking here is shown to kill first-order CPA only; it does not prove second-order security."]),
        ]),
      ]),
    ]),
    el("p", { class: "note" }, [
      "Real captures come off an oscilloscope on real hardware (e.g. the open-source ChipWhisperer). What transfers from this bench to that one: the leakage model, the statistics, and the trace-count economics. What doesn't: the physics of a particular chip.",
    ]),
    el("p", { class: "subhead" }, ["What this lab is not (and where to go instead)"]),
    el("ul", { class: "linklist" }, [
      li("crypto-lab-timing-sidechannel", "https://systemslibrarian.github.io/crypto-lab-timing-sidechannel/", "timing attacks measure how long the secret took; this measures how much current it drew."),
      li("crypto-lab-timing-oracle", "https://systemslibrarian.github.io/crypto-lab-timing-oracle/", "a remote timing oracle — again duration, not power."),
      li("crypto-lab-lattice-fault", "https://systemslibrarian.github.io/crypto-lab-lattice-fault/", "fault injection and PQC/NTT leakage — a different physical channel, not covered here."),
      li("crypto-lab-rsa-educational", "https://systemslibrarian.github.io/crypto-lab-rsa-educational/", "the RSA arithmetic behind the SPA exhibit."),
    ]),
    el("p", { class: "note" }, [
      "Also out of scope by design: second-order / higher-order DPA (named, not built), template attacks, real oscilloscope capture, and PQC power analysis.",
    ]),
  ]);
}

/* ===================================================================== */

export function initUi(): void {
  const app = document.getElementById("app");
  if (!app) return;
  initCanvasTheming();
  // The hero lives INSIDE <main> so its <header> is page content, not a second
  // banner landmark — the shared top bar is the page's only banner.
  const main = el("main", {}, [
    hero(),
    intro(),
    spaSection(),
    cpaSection(),
    noiseSection(),
    misalignSection(),
    dpaCpaSection(),
    countermeasuresSection(),
    importSection(),
    scopingSection(),
  ]);
  app.append(main);
}

/* ---- small element helpers ------------------------------------------ */

function th(label: string): HTMLTableCellElement {
  return el("th", { scope: "col" }, [label]);
}
function td(label: string): HTMLTableCellElement {
  return el("td", {}, [label]);
}
function rangeInput(id: string, min: number, max: number, step: number, value: number): HTMLInputElement {
  return el("input", { type: "range", id, min, max, step, value }) as HTMLInputElement;
}
