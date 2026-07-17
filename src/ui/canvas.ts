/**
 * Theme-aware canvas plumbing. Charts read their colors from the live CSS
 * variables so they repaint correctly when the shared top bar flips the theme,
 * and every canvas carries a text/table alternative elsewhere for the a11y gate
 * (axe cannot read pixels — an unlabeled canvas is an ungated region).
 */

export interface ChartColors {
  surface: string;
  grid: string;
  axis: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  ok: string;
  warn: string;
}

export function chartColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: v("--chart-surface"),
    grid: v("--chart-grid"),
    axis: v("--chart-axis"),
    text: v("--text"),
    muted: v("--muted"),
    accent: v("--accent"),
    accentText: v("--accent-text"),
    danger: v("--danger-line"),
    ok: v("--ok"),
    warn: v("--warn"),
  };
}

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, c: ChartColors) => void;

const registry: { canvas: HTMLCanvasElement; draw: DrawFn; height: number }[] = [];

/** Size a canvas for the device pixel ratio and run its draw callback. */
function paint(canvas: HTMLCanvasElement, draw: DrawFn, height: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, height);
  draw(ctx, cssW, height, chartColors());
}

/**
 * Bind a draw function to a canvas. Returns a `redraw` you call after new data;
 * the chart also repaints itself on theme change and window resize.
 */
export function bindChart(canvas: HTMLCanvasElement, height: number): (draw: DrawFn) => void {
  let current: DrawFn = () => {};
  const entry = { canvas, draw: current, height };
  registry.push(entry);
  const redraw = (draw: DrawFn) => {
    current = draw;
    entry.draw = draw;
    paint(canvas, draw, height);
  };
  return redraw;
}

let wired = false;
/** Install the theme-change + resize listeners once. */
export function initCanvasTheming(): void {
  if (wired) return;
  wired = true;
  const repaintAll = () => {
    for (const e of registry) paint(e.canvas, e.draw, e.height);
  };
  new MutationObserver(repaintAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  let t: number | undefined;
  window.addEventListener("resize", () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(repaintAll, 150);
  });
}

/* ---- small drawing primitives ---------------------------------------- */

export interface Plot {
  ctx: CanvasRenderingContext2D;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: (v: number) => number; // data-x -> pixel
  py: (v: number) => number; // data-y -> pixel
}

/** Draw axes + gridlines and return a mapping into the plot rectangle. */
export function frame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ChartColors,
  xRange: [number, number],
  yRange: [number, number],
  pad = { l: 46, r: 12, t: 12, b: 30 },
): Plot {
  const x0 = pad.l;
  const y0 = h - pad.b;
  const x1 = w - pad.r;
  const y1 = pad.t;
  const px = (v: number) => x0 + ((v - xRange[0]) / (xRange[1] - xRange[0] || 1)) * (x1 - x0);
  const py = (v: number) => y0 + ((v - yRange[0]) / (yRange[1] - yRange[0] || 1)) * (y1 - y0);
  ctx.fillStyle = c.surface;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = c.muted;
  ctx.font = "11px ui-monospace, monospace";
  for (let i = 0; i <= 4; i++) {
    const gy = y1 + ((y0 - y1) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, gy);
    ctx.lineTo(x1, gy);
    ctx.stroke();
    const val = yRange[1] - ((yRange[1] - yRange[0]) * i) / 4;
    ctx.fillText(val.toFixed(2), 4, gy + 3);
  }
  ctx.strokeStyle = c.axis;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();
  return { ctx, x0, y0, x1, y1, px, py };
}
