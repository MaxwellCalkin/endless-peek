import { type Box, type Ray, boxesOverlap, rayBox, rayBoxHit, unionBox } from './aabb';

/** What a surface is made of. Drives impact effects and sounds. */
export type SurfaceKind = 'wall' | 'floor' | 'crate' | 'metal' | 'seal';

export interface Solid extends Box {
  kind: SurfaceKind;
}

export interface WorldHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  solid: Solid;
}

interface Group {
  bounds: Box;
  solids: Solid[];
}

const SKIN = 1e-5;

/**
 * Static level collision. Solids are grouped per hallway segment so whole segments can be
 * streamed in and out, and so queries can reject a segment with one bounds test.
 */
export class CollisionWorld {
  private groups = new Map<number, Group>();

  addGroup(id: number, solids: Solid[]): void {
    this.groups.set(id, { solids: [...solids], bounds: unionBox(solids) });
  }

  addSolid(groupId: number, solid: Solid): void {
    const g = this.groups.get(groupId);
    if (!g) {
      this.addGroup(groupId, [solid]);
      return;
    }
    g.solids.push(solid);
    g.bounds = unionBox([g.bounds, solid]);
  }

  removeGroup(id: number): void {
    this.groups.delete(id);
  }

  clear(): void {
    this.groups.clear();
  }

  get solidCount(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.solids.length;
    return n;
  }

  /** Nearest hit with surface normal, or null. */
  raycast(r: Ray, tMax: number): WorldHit | null {
    let best: WorldHit | null = null;
    let bestT = tMax;
    for (const g of this.groups.values()) {
      if (rayBox(r, g.bounds, bestT) === Infinity) continue;
      for (const s of g.solids) {
        const h = rayBoxHit(r, s, bestT);
        if (h && h.t < bestT) {
          bestT = h.t;
          best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, solid: s };
        }
      }
    }
    return best;
  }

  /** Distance to the nearest solid along the ray, or Infinity. */
  raycastT(r: Ray, tMax: number): number {
    let best = tMax;
    let hit = false;
    for (const g of this.groups.values()) {
      if (rayBox(r, g.bounds, best) === Infinity) continue;
      for (const s of g.solids) {
        const t = rayBox(r, s, best);
        if (t < best) {
          best = t;
          hit = true;
        }
      }
    }
    return hit ? best : Infinity;
  }

  /** True when any solid blocks the straight segment between the two points. */
  segmentBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const r: Ray = {
      ox: ax,
      oy: ay,
      oz: az,
      dx: dx / len,
      dy: dy / len,
      dz: dz / len,
      ix: dx !== 0 ? len / dx : 1e30,
      iy: dy !== 0 ? len / dy : 1e30,
      iz: dz !== 0 ? len / dz : 1e30,
    };
    for (const g of this.groups.values()) {
      if (rayBox(r, g.bounds, len) === Infinity) continue;
      for (const s of g.solids) {
        if (rayBox(r, s, len) < len) return true;
      }
    }
    return false;
  }

  overlapsAny(b: Box): boolean {
    for (const g of this.groups.values()) {
      if (!boxesOverlap(g.bounds, b)) continue;
      for (const s of g.solids) if (boxesOverlap(s, b, SKIN)) return true;
    }
    return false;
  }

  private collect(b: Box, out: Solid[]): void {
    out.length = 0;
    for (const g of this.groups.values()) {
      if (!boxesOverlap(g.bounds, b, -0.01)) continue;
      for (const s of g.solids) if (boxesOverlap(s, b, -0.01)) out.push(s);
    }
  }

  private scratch: Solid[] = [];

  /**
   * Move an upright box (feet at pos.y, square footprint of half-width `hw`, height `h`)
   * by (dx, dy, dz), resolving axis by axis against static solids. Mutates `pos`.
   */
  moveBox(
    pos: { x: number; y: number; z: number },
    hw: number,
    h: number,
    dx: number,
    dy: number,
    dz: number,
  ): { hitX: boolean; hitY: boolean; hitZ: boolean } {
    const sweep: Box = {
      minX: pos.x - hw + Math.min(0, dx),
      maxX: pos.x + hw + Math.max(0, dx),
      minY: pos.y + Math.min(0, dy),
      maxY: pos.y + h + Math.max(0, dy),
      minZ: pos.z - hw + Math.min(0, dz),
      maxZ: pos.z + hw + Math.max(0, dz),
    };
    const cand = this.scratch;
    this.collect(sweep, cand);

    const p: Box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    const sync = () => {
      p.minX = pos.x - hw;
      p.maxX = pos.x + hw;
      p.minY = pos.y;
      p.maxY = pos.y + h;
      p.minZ = pos.z - hw;
      p.maxZ = pos.z + hw;
    };

    sync();
    let my = dy;
    for (const s of cand) {
      if (p.minX < s.maxX - SKIN && p.maxX > s.minX + SKIN && p.minZ < s.maxZ - SKIN && p.maxZ > s.minZ + SKIN) {
        if (my > 0 && p.maxY <= s.minY + SKIN) my = Math.min(my, s.minY - p.maxY);
        else if (my < 0 && p.minY >= s.maxY - SKIN) my = Math.max(my, s.maxY - p.minY);
      }
    }
    pos.y += my;
    sync();

    let mx = dx;
    for (const s of cand) {
      if (p.minY < s.maxY - SKIN && p.maxY > s.minY + SKIN && p.minZ < s.maxZ - SKIN && p.maxZ > s.minZ + SKIN) {
        if (mx > 0 && p.maxX <= s.minX + SKIN) mx = Math.min(mx, s.minX - p.maxX);
        else if (mx < 0 && p.minX >= s.maxX - SKIN) mx = Math.max(mx, s.maxX - p.minX);
      }
    }
    pos.x += mx;
    sync();

    let mz = dz;
    for (const s of cand) {
      if (p.minY < s.maxY - SKIN && p.maxY > s.minY + SKIN && p.minX < s.maxX - SKIN && p.maxX > s.minX + SKIN) {
        if (mz > 0 && p.maxZ <= s.minZ + SKIN) mz = Math.min(mz, s.minZ - p.maxZ);
        else if (mz < 0 && p.minZ >= s.maxZ - SKIN) mz = Math.max(mz, s.maxZ - p.minZ);
      }
    }
    pos.z += mz;

    return {
      hitX: Math.abs(mx - dx) > 1e-9,
      hitY: Math.abs(my - dy) > 1e-9,
      hitZ: Math.abs(mz - dz) > 1e-9,
    };
  }
}
