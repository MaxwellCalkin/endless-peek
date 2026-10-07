import { type CrosshairProfile, type LineSettings, type SniperSettings, profileColor } from './crosshairCode';

const SIZE = 640;

/**
 * Draws the crosshair on a small canvas pinned to the exact screen center, in device pixels so
 * 1 px lines stay crisp. Line sizes are in screen pixels like VALORANT's settings.
 */
export class CrosshairView {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'crosshair';
    this.el.width = SIZE;
    this.el.height = SIZE;
    parent.appendChild(this.el);
    const ctx = this.el.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.layout();
  }

  /** Re-center after a resize. Aligns the canvas center to the screen's center pixel boundary. */
  layout(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * this.dpr);
    const h = Math.round(window.innerHeight * this.dpr);
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    this.el.style.width = `${SIZE / this.dpr}px`;
    this.el.style.height = `${SIZE / this.dpr}px`;
    this.el.style.left = `${(cx - SIZE / 2) / this.dpr}px`;
    this.el.style.top = `${(cy - SIZE / 2) / this.dpr}px`;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, SIZE, SIZE);
  }

  /**
   * @param basePx   the weapon's resting error (first-shot spread) in pixels
   * @param firingPx extra error built up by firing, in pixels
   * @param movementPx movement error in pixels
   */
  draw(p: CrosshairProfile, basePx: number, firingPx: number, movementPx: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const color = profileColor(p);
    const c = SIZE / 2;
    const fade = p.fadeWithFiringError ? 1 - Math.min(0.85, firingPx / 45) : 1;
    const ot = p.outlines ? Math.max(0, Math.round(p.outlineThickness)) : 0;

    const rect = (x: number, y: number, w: number, h: number, alpha: number) => {
      if (w <= 0 || h <= 0 || alpha <= 0) return;
      if (ot > 0) {
        ctx.fillStyle = `rgba(0,0,0,${p.outlineOpacity * alpha})`;
        ctx.fillRect(x - ot, y - ot, w + ot * 2, ot);
        ctx.fillRect(x - ot, y + h, w + ot * 2, ot);
        ctx.fillRect(x - ot, y, ot, h);
        ctx.fillRect(x + w, y, ot, h);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    };

    const lines = (l: LineSettings) => {
      if (!l.show || l.length <= 0 || l.thickness <= 0) return;
      const t = Math.round(l.thickness);
      const len = Math.round(l.length);
      const vlen = Math.round(l.separateVertical ? l.verticalLength : l.length);
      // Lines with firing error rest at the weapon's base error unless "override offset" is on.
      const firing = firingPx + (p.overrideFiringOffset ? 0 : basePx);
      const grow = (l.firingError ? firing * l.firingMult : 0) + (l.movementError ? movementPx * l.movementMult : 0);
      const o = Math.round(l.offset + grow);
      const a = l.opacity * (l.firingError || l.movementError ? fade : 1);
      const half = Math.floor(t / 2);
      rect(c + o, c - half, len, t, a); // right
      rect(c - o - len, c - half, len, t, a); // left
      rect(c - half, c - o - vlen, t, vlen, a); // top
      rect(c - half, c + o, t, vlen, a); // bottom
    };

    lines(p.outer);
    lines(p.inner);
    if (p.centerDot) {
      const z = Math.max(1, Math.round(p.dotThickness));
      const half = Math.floor(z / 2);
      rect(c - half, c - half, z, z, p.dotOpacity);
    }
  }

  drawSniper(s: SniperSettings): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!s.centerDot) return;
    const c = SIZE / 2;
    const z = Math.max(1, Math.round(s.dotSize * 2));
    ctx.globalAlpha = s.dotOpacity;
    ctx.fillStyle = profileColor(s);
    ctx.fillRect(c - Math.floor(z / 2), c - Math.floor(z / 2), z, z);
    ctx.globalAlpha = 1;
  }
}
