export interface TraceStyle {
  color: string;
  /** Signal units to fraction of trace height. */
  scale: number;
  /** Baseline position as a fraction of trace height from the top. */
  baseline: number;
  pxPerSec?: number;
}

const ERASE_GAP = 16;

/** Draws a signal like a bedside monitor: a fixed sweep that overwrites itself behind an erase bar. */
export class SweepTrace {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private style: Required<TraceStyle>;
  private w = 1;
  private h = 1;
  private prev: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, style: TraceStyle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.style = { pxPerSec: 150, ...style };
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.prev = null;
  }

  draw(t0: number, t1: number, sample: (t: number) => number) {
    const { ctx, w, h, style } = this;
    const step = 1 / style.pxPerSec;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const x = Math.floor(t * style.pxPerSec) % w;
      const y = Math.min(h - 1, Math.max(1, h * style.baseline - sample(t) * h * style.scale));
      if (this.prev && x > this.prev.x) {
        ctx.moveTo(this.prev.x, this.prev.y);
        ctx.lineTo(x, y);
      }
      ctx.clearRect(x + 1, 0, ERASE_GAP, h);
      if (x + 1 + ERASE_GAP > w) ctx.clearRect(0, 0, x + 1 + ERASE_GAP - w, h);
      this.prev = { x, y };
    }
    ctx.stroke();
  }
}
