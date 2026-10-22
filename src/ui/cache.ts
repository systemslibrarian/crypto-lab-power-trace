import { consistentKeys, LINE_COUNT, observedLines } from "../leakage/cache";
import { el, hex } from "./dom";

/** One additional implementation channel, separate from the power-trace model. */
export function cacheSection(keyByte: number): HTMLElement {
  const plaintext = el("input", {
    id: "cache-plaintext",
    type: "text",
    value: "00",
    maxlength: "2",
    inputmode: "text",
    spellcheck: false,
  }) as HTMLInputElement;
  const run = el("button", { id: "cache-run", type: "button" }, ["Compare line observations"]);
  const indexedStrip = el("div", { class: "cache-strip", role: "img" });
  const uniformStrip = el("div", { class: "cache-strip", role: "img" });
  const indexedOutcome = el("p", { id: "cache-indexed-result", class: "cache-result" });
  const uniformOutcome = el("p", { id: "cache-uniform-result", class: "cache-result" });
  const status = el("p", { id: "cache-status", class: "note", role: "status", "aria-live": "polite" });

  function paint(strip: HTMLElement, lines: readonly number[]): void {
    const visible = new Set(lines);
    strip.replaceChildren(...Array.from({ length: LINE_COUNT }, (_, line) =>
      el("span", { class: `cache-line${visible.has(line) ? " observed" : ""}` }, [String(line)]),
    ));
    strip.setAttribute("aria-label", `Table lines observed: ${lines.join(", ")}`);
  }

  function compare(): void {
    const raw = plaintext.value.trim();
    if (!/^[0-9a-f]{1,2}$/i.test(raw)) {
      status.textContent = "Enter exactly one hexadecimal byte (00–FF).";
      return;
    }
    const p = Number.parseInt(raw, 16);
    const indexedLines = observedLines(p, keyByte, "indexed");
    const uniformLines = observedLines(p, keyByte, "uniform");
    const indexedKeys = consistentKeys(p, indexedLines, "indexed");
    const uniformKeys = consistentKeys(p, uniformLines, "uniform");
    paint(indexedStrip, indexedLines);
    paint(uniformStrip, uniformLines);
    indexedOutcome.textContent = `One observed line (${indexedLines[0]}) leaves ${indexedKeys.length} possible key bytes: ${hex(indexedKeys[0])}–${hex(indexedKeys[indexedKeys.length - 1])}.`;
    uniformOutcome.textContent = `All ${LINE_COUNT} lines observed leaves all ${uniformKeys.length} possible key bytes.`;
    status.textContent = `For plaintext ${hex(p)}, the fixed teaching key byte ${hex(keyByte)} is among the ${indexedKeys.length} survivors. The line does not identify that byte uniquely.`;
  }

  run.addEventListener("click", compare);
  plaintext.addEventListener("change", compare);
  queueMicrotask(compare);

  return el("section", { class: "panel", id: "cache-model", "aria-labelledby": "cache-title" }, [
    el("span", { class: "step" }, ["Exhibit 8 — a different leakage channel"]),
    el("h2", { id: "cache-title" }, ["What a table lookup can reveal through a cache line"]),
    el("p", { class: "note" }, [
      "Simulated cache observation, not a browser timing measurement. Imagine an older AES T-table with 4-byte entries and hypothetical 64-byte cache lines: 16 indices share a line. In the first round, the lookup index for one byte is plaintext ⊕ key byte. An ideal observer sees which line was touched, not the exact index.",
    ]),
    el("div", { class: "controls" }, [
      el("div", { class: "control-row" }, [
        el("label", { for: "cache-plaintext" }, ["Known plaintext byte (hex)"]),
        plaintext,
      ]),
    ]),
    el("div", { class: "btn-row" }, [run]),
    el("div", { class: "cache-compare" }, [
      el("div", { class: "cache-card" }, [
        el("h3", {}, ["Secret-dependent table address"]),
        el("p", { class: "note" }, ["Only the line containing the first-round lookup is visible in this ideal model."]),
        indexedStrip,
        indexedOutcome,
      ]),
      el("div", { class: "cache-card" }, [
        el("h3", {}, ["Secret-independent access control"]),
        el("p", { class: "note" }, ["The model touches every line, in the same pattern for every key byte."]),
        uniformStrip,
        uniformOutcome,
      ]),
    ]),
    status,
    el("p", { class: "note caveat" }, [
      "This is a one-byte, perfect-observation address model. The real JavaScript AES here uses a one-byte S-box, not this T-table layout; neither path above measures its cache or changes its encryption. The all-lines control illustrates a key-independent access set, not a production constant-time AES implementation. Real processors, memory layouts and attackers are more complex; this exhibit demonstrates neither full-key recovery nor a practical browser attack.",
    ]),
    el("p", { class: "note" }, [
      "Sources: ",
      el("a", { href: "https://eprint.iacr.org/2005/271" }, ["Osvik, Shamir and Tromer, Cache attacks and Countermeasures: the Case of AES (2005)"]),
      "; ",
      el("a", { href: "https://www.nist.gov/news-events/news/2022/12/announcement-proposal-update-fips-197-advanced-encryption-standard" }, ["NIST AES review announcement (19 December 2022), implementation security"]),
      ".",
    ]),
  ]);
}
