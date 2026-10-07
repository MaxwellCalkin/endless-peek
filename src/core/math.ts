export const DEG = Math.PI / 180;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Unit view vector for yaw/pitch using the shared convention (yaw 0 = -Z, pitch up positive). */
export function viewDir(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Angle in radians between two direction vectors. */
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la === 0 || lb === 0) return 0;
  return Math.acos(clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1));
}

/**
 * Rotate `dir` by a random offset inside a cone of half-angle `spreadRad`.
 * `uniform` spreads evenly over the cone's area; otherwise samples cluster toward the center,
 * matching VALORANT's center-biased standing error.
 */
export function applySpread(
  dir: { x: number; y: number; z: number },
  spreadRad: number,
  uniform: boolean,
  rand: () => number,
): { x: number; y: number; z: number } {
  if (spreadRad <= 0) return { ...dir };
  const u = rand();
  const r = spreadRad * (uniform ? Math.sqrt(u) : u);
  const phi = rand() * Math.PI * 2;
  // Build an orthonormal basis around dir.
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = dir.y * up.z - dir.z * up.y;
  let ry = dir.z * up.x - dir.x * up.z;
  let rz = dir.x * up.y - dir.y * up.x;
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * dir.z - rz * dir.y;
  const uy = rz * dir.x - rx * dir.z;
  const uz = rx * dir.y - ry * dir.x;
  const t = Math.tan(r);
  const ox = Math.cos(phi) * t;
  const oy = Math.sin(phi) * t;
  const x = dir.x + rx * ox + ux * oy;
  const y = dir.y + ry * ox + uy * oy;
  const z = dir.z + rz * ox + uz * oy;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}
