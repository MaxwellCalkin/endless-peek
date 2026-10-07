/** Axis-aligned box in world space (meters, Y up). */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    minZ: Math.min(minZ, maxZ),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
    maxZ: Math.max(minZ, maxZ),
  };
}

/** True when the interiors overlap by more than `eps` on every axis (touching faces do not count). */
export function boxesOverlap(a: Box, b: Box, eps = 1e-6): boolean {
  return (
    a.minX < b.maxX - eps &&
    a.maxX > b.minX + eps &&
    a.minY < b.maxY - eps &&
    a.maxY > b.minY + eps &&
    a.minZ < b.maxZ - eps &&
    a.maxZ > b.minZ + eps
  );
}

export function unionBox(boxes: readonly Box[]): Box {
  const out = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const b of boxes) {
    if (b.minX < out.minX) out.minX = b.minX;
    if (b.minY < out.minY) out.minY = b.minY;
    if (b.minZ < out.minZ) out.minZ = b.minZ;
    if (b.maxX > out.maxX) out.maxX = b.maxX;
    if (b.maxY > out.maxY) out.maxY = b.maxY;
    if (b.maxZ > out.maxZ) out.maxZ = b.maxZ;
  }
  return out;
}

export function pointInBox(b: Box, x: number, y: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

/** A ray with its reciprocal direction cached for slab tests. Direction should be normalized. */
export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  ix: number;
  iy: number;
  iz: number;
}

const BIG = 1e30;

export function makeRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray {
  return {
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    ix: dx !== 0 ? 1 / dx : BIG,
    iy: dy !== 0 ? 1 / dy : BIG,
    iz: dz !== 0 ? 1 / dz : BIG,
  };
}

/**
 * Slab test. Returns the entry distance in [0, tMax], or Infinity when the ray misses.
 * A ray that starts inside the box hits at t = 0.
 */
export function rayBox(r: Ray, b: Box, tMax: number): number {
  let t1 = (b.minX - r.ox) * r.ix;
  let t2 = (b.maxX - r.ox) * r.ix;
  let tNear = Math.min(t1, t2);
  let tFar = Math.max(t1, t2);

  t1 = (b.minY - r.oy) * r.iy;
  t2 = (b.maxY - r.oy) * r.iy;
  tNear = Math.max(tNear, Math.min(t1, t2));
  tFar = Math.min(tFar, Math.max(t1, t2));

  t1 = (b.minZ - r.oz) * r.iz;
  t2 = (b.maxZ - r.oz) * r.iz;
  tNear = Math.max(tNear, Math.min(t1, t2));
  tFar = Math.min(tFar, Math.max(t1, t2));

  if (tFar < Math.max(tNear, 0) || tNear > tMax) return Infinity;
  return Math.max(tNear, 0);
}

export interface RayBoxHit {
  t: number;
  /** Surface normal of the face that was hit. */
  nx: number;
  ny: number;
  nz: number;
}

/** Like rayBox but also reports which face was entered (for impact decals). */
export function rayBoxHit(r: Ray, b: Box, tMax: number): RayBoxHit | null {
  const tx1 = (b.minX - r.ox) * r.ix;
  const tx2 = (b.maxX - r.ox) * r.ix;
  const ty1 = (b.minY - r.oy) * r.iy;
  const ty2 = (b.maxY - r.oy) * r.iy;
  const tz1 = (b.minZ - r.oz) * r.iz;
  const tz2 = (b.maxZ - r.oz) * r.iz;

  const nearX = Math.min(tx1, tx2);
  const nearY = Math.min(ty1, ty2);
  const nearZ = Math.min(tz1, tz2);
  const tNear = Math.max(nearX, nearY, nearZ);
  const tFar = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
  if (tFar < Math.max(tNear, 0) || tNear > tMax) return null;

  if (tNear <= 0) return { t: 0, nx: -r.dx, ny: -r.dy, nz: -r.dz };
  if (tNear === nearX) return { t: tNear, nx: r.dx > 0 ? -1 : 1, ny: 0, nz: 0 };
  if (tNear === nearY) return { t: tNear, nx: 0, ny: r.dy > 0 ? -1 : 1, nz: 0 };
  return { t: tNear, nx: 0, ny: 0, nz: r.dz > 0 ? -1 : 1 };
}

/**
 * Ray against a box that is rotated by `yaw` around the vertical axis through (cx, cz).
 * `hx/hy/hz` are half extents in the box's local frame and (cx, cy, cz) its center.
 * Used for bot hitboxes, which turn to face the player.
 */
export function rayYawBox(
  r: Ray,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  yaw: number,
  tMax: number,
): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // World -> local is a rotation by -yaw around Y.
  const px = r.ox - cx;
  const pz = r.oz - cz;
  const lox = c * px - s * pz;
  const loz = s * px + c * pz;
  const ldx = c * r.dx - s * r.dz;
  const ldz = s * r.dx + c * r.dz;
  const local = makeRay(lox, r.oy - cy, loz, ldx, r.dy, ldz);
  return rayBox(local, { minX: -hx, minY: -hy, minZ: -hz, maxX: hx, maxY: hy, maxZ: hz }, tMax);
}
