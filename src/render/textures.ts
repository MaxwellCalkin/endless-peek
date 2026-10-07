import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Theme } from './themes';

/** Procedural canvas textures, so the project ships no image assets. */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Per-pixel brightness noise. */
function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, rng: Rng): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Soft blotches drawn with wrap-around so the texture tiles seamlessly. */
function blotches(ctx: CanvasRenderingContext2D, size: number, color: string, count: number, alpha: number, rng: Rng): void {
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const rad = rng.range(size * 0.05, size * 0.22);
    const a = alpha * rng.range(0.4, 1);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const gx = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gx.addColorStop(0, `rgba(${r},${g},${b},${a})`);
        gx.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gx;
        ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
}

function finish(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function wallTexture(theme: Theme, seed: number): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = theme.wall;
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, theme.wallNoise, 26, 0.22, rng);
  blotches(ctx, size, '#ffffff', 10, 0.08, rng);
  // Faint panel seams every half texture (1.25 m).
  ctx.fillStyle = shade(theme.wallNoise, 0.85);
  ctx.globalAlpha = 0.35;
  for (const x of [0, size / 2]) ctx.fillRect(x, 0, 2, size);
  ctx.globalAlpha = 1;
  grain(ctx, size, 10, rng);
  return finish(c, true);
}

export function floorTexture(theme: Theme, seed: number): THREE.CanvasTexture {
  const size = 512;
  const tiles = 4;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  const t = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = shade(theme.floor, rng.range(0.95, 1.05));
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  blotches(ctx, size, theme.floorLine, 18, 0.18, rng);
  ctx.fillStyle = theme.floorLine;
  for (let i = 0; i <= tiles; i++) {
    ctx.fillRect(i * t - 2, 0, 4, size);
    ctx.fillRect(0, i * t - 2, size, 4);
  }
  grain(ctx, size, 12, rng);
  return finish(c, true);
}

export function crateTexture(base: string, edge: string, seed: number, ribbed: boolean): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (ribbed) {
    for (let y = 24; y < size - 24; y += 20) {
      ctx.fillStyle = shade(base, 0.82);
      ctx.fillRect(18, y, size - 36, 6);
      ctx.fillStyle = shade(base, 1.12);
      ctx.fillRect(18, y + 6, size - 36, 2);
    }
  } else {
    ctx.strokeStyle = shade(base, 0.78);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(22, 22);
    ctx.lineTo(size - 22, size - 22);
    ctx.stroke();
    for (const y of [size / 3, (2 * size) / 3]) {
      ctx.fillStyle = shade(base, 0.85);
      ctx.fillRect(18, y - 2, size - 36, 4);
    }
  }
  ctx.strokeStyle = edge;
  ctx.lineWidth = 20;
  ctx.strokeRect(10, 10, size - 20, size - 20);
  ctx.strokeStyle = shade(edge, 0.7);
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, size - 40, size - 40);
  ctx.fillStyle = shade(edge, 0.6);
  for (const [x, y] of [
    [10, 10],
    [size - 10, 10],
    [10, size - 10],
    [size - 10, size - 10],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, size, 14, rng);
  return finish(c, false);
}

export function metalTexture(theme: Theme, seed: number, slats: boolean): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = theme.metal;
  ctx.fillRect(0, 0, size, size);
  if (slats) {
    for (let y = 0; y < size; y += 32) {
      ctx.fillStyle = shade(theme.metal, 0.7);
      ctx.fillRect(0, y, size, 3);
      ctx.fillStyle = shade(theme.metal, 1.18);
      ctx.fillRect(0, y + 3, size, 2);
    }
  } else {
    for (let y = 0; y < size; y += 2) {
      ctx.fillStyle = shade(theme.metal, rng.range(0.94, 1.06));
      ctx.fillRect(0, y, size, 1);
    }
  }
  grain(ctx, size, 8, rng);
  return finish(c, true);
}

export function plainTexture(color: string, noise: string, seed: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, noise, 12, 0.18, rng);
  grain(ctx, size, 10, rng);
  return finish(c, true);
}

export function skyTexture(top: string, horizon: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.5, horizon);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
