/** Chart drawers — each illuminates one mechanism; none is decorative. */
import { frame, type ChartColors } from "./canvas";
import type { Op } from "../spa/modexp";
import type { SeparationPoint } from "../attack/cpa";

/**
 * The headline picture: 256 key guesses, each a vertical line at its peak
 * |correlation|. 255 stay in the noise; the true byte's line is drawn apart —
 * red when it has separated (key leaked), amber while it is still a candidate.
 */
export function drawGuessPlot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ChartColors,
  data: { scores: Float64Array; trueByte: number; recovered: boolean; frozen?: Float64Array },
): void {
  let maxScore = 0;
  for (const s of data.scores) if (s > maxScore) maxScore = s;
  if (data.frozen) for (const s of data.frozen) if (s > maxScore) maxScore = s;
  const yMax = Math.max(0.4, maxScore * 1.2);
  const p = frame(ctx, w, h, c, [0, 255], [0, yMax]);

  // Frozen baseline overlay (a previous parameter setting), drawn faint behind.
  if (data.frozen) {
    ctx.strokeStyle = c.accentText;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let g = 0; g < data.frozen.length; g++) {
      const X = p.px(g);
      ctx.moveTo(X, p.py(0));
      ctx.lineTo(X, p.py(data.frozen[g]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (let g = 0; g < 256; g++) {
    if (g === data.trueByte) continue;
    const x = p.px(g);
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, p.py(0));
    ctx.lineTo(x, p.py(data.scores[g]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const x = p.px(data.trueByte);
  ctx.strokeStyle = data.recovered ? c.danger : c.warn;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, p.py(0));
  ctx.lineTo(x, p.py(data.scores[data.trueByte]));
  ctx.stroke();
  ctx.fillStyle = data.recovered ? c.danger : c.warn;
  ctx.beginPath();
  ctx.arc(x, p.py(data.scores[data.trueByte]), 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = c.muted;
  ctx.font = "11px ui-monospace, monospace";
  for (const g of [0, 64, 128, 192, 255]) {
    ctx.fillText(String(g), p.px(g) - 8, h - 14);
  }
  ctx.fillText("key-byte guess (0–255)", w / 2 - 60, h - 2);
}

/** The spike separating: correct-byte vs best-wrong correlation as N climbs. */
export function drawSeparation(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ChartColors,
  points: SeparationPoint[],
): void {
  if (points.length === 0) return;
  const xs = points.map((p) => Math.log10(p.numTraces));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMax = 0.4;
  for (const p of points) yMax = Math.max(yMax, p.correctScore, p.topWrongScore);
  yMax *= 1.15;
  const plot = frame(ctx, w, h, c, [xMin, xMax], [0, yMax]);

  const line = (key: "correctScore" | "topWrongScore", color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((p, i) => {
      const X = plot.px(xs[i]);
      const Y = plot.py(p[key]);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.stroke();
  };
  line("topWrongScore", c.muted, 1.5);
  line("correctScore", c.danger, 2.5);

  ctx.fillStyle = c.muted;
  ctx.font = "11px ui-monospace, monospace";
  for (const p of points) {
    const X = plot.px(Math.log10(p.numTraces));
    ctx.fillText(String(p.numTraces), X - 10, h - 14);
  }
  ctx.fillStyle = c.danger;
  ctx.fillText("● correct byte", plot.x0 + 6, plot.y1 + 12);
  ctx.fillStyle = c.muted;
  ctx.fillText("● best wrong guess", plot.x0 + 6, plot.y1 + 26);
  ctx.fillStyle = c.muted;
  ctx.fillText("traces (log scale)", w / 2 - 44, h - 2);
}

/** Cost curve: traces needed to recover vs measurement noise (∝ σ²). */
export function drawNoiseCurve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ChartColors,
  points: { noise: number; traces: number | null; cap: number }[],
): void {
  if (points.length === 0) return;
  const xMax = Math.max(...points.map((p) => p.noise)) * 1.05;
  const cap = points[0].cap;
  const yMax = cap * 1.1;
  const plot = frame(ctx, w, h, c, [0, xMax], [0, yMax], { l: 54, r: 12, t: 12, b: 30 });

  ctx.strokeStyle = c.accentText;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const X = plot.px(p.noise);
    const Y = plot.py(p.traces ?? cap);
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  });
  ctx.stroke();
  for (const p of points) {
    ctx.fillStyle = p.traces === null ? c.danger : c.accentText;
    ctx.beginPath();
    ctx.arc(plot.px(p.noise), plot.py(p.traces ?? cap), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = c.muted;
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText("noise σ →", w / 2 - 30, h - 2);
  ctx.save();
  ctx.translate(12, h / 2 + 30);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("traces to recover", 0, 0);
  ctx.restore();
}

/**
 * One SPA trace: the square-and-multiply operation sequence. Squares (every bit)
 * are short; multiplies (only on a 1 bit) are long and drawn apart, so the bits
 * read straight off the widths.
 */
export function drawSpaTrace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: ChartColors,
  ops: Op[],
): void {
  ctx.fillStyle = c.surface;
  ctx.fillRect(0, 0, w, h);
  const pad = 10;
  const yLow = h - 24;
  const yHigh = 22;
  const gap = 0.5;
  const unit = (op: Op) => (op.kind === "square" ? 1 : 2.1);
  const totalUnits = ops.reduce((s, o) => s + unit(o) + gap, 0);
  const uw = (w - pad * 2) / (totalUnits || 1);

  ctx.strokeStyle = c.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, yLow + 0.5);
  ctx.lineTo(w - pad, yLow + 0.5);
  ctx.stroke();

  let x = pad;
  ctx.font = "10px ui-monospace, monospace";
  for (const op of ops) {
    const bw = unit(op) * uw;
    const isMul = op.kind === "multiply";
    ctx.fillStyle = isMul ? c.danger : c.accentText;
    ctx.globalAlpha = isMul ? 0.9 : 0.75;
    ctx.fillRect(x, yHigh, bw, yLow - yHigh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.surface;
    ctx.fillText(isMul ? "M" : "S", x + bw / 2 - 3, (yHigh + yLow) / 2 + 3);
    x += bw + gap * uw;
  }
  ctx.fillStyle = c.muted;
  ctx.fillText("time →   (S = square, every bit;  M = multiply, only on a 1 bit)", pad, h - 6);
}
