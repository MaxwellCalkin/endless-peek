import { describe, expect, it } from 'vitest';
import { HITBOXES } from '../src/config/agent';
import { boxesOverlap, makeRay, rayBox } from '../src/physics/aabb';
import { Hallway, type Segment, spotIsValid } from '../src/world/hallway';
import { type LocalBox, type SegmentPlan, toLocal, toWorld } from '../src/world/layout';

const PLAYER_RADIUS = 0.36;
const CELL = 0.2;

/** Grid flood fill over a plan's floor: can a player-sized hull walk from the entry to the exit? */
function walkable(plan: SegmentPlan): boolean {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const r of plan.footprint) {
    u0 = Math.min(u0, r.u0);
    u1 = Math.max(u1, r.u1);
    v0 = Math.min(v0, r.v0);
    v1 = Math.max(v1, r.v1);
  }
  const nu = Math.ceil((u1 - u0) / CELL);
  const nv = Math.ceil((v1 - v0) / CELL);
  const blockers: LocalBox[] = plan.boxes.filter((b) => b.y0 < 1.5 && b.y1 > 0.05);
  const onFloor = (u: number, v: number) => plan.footprint.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1);
  const free = (u: number, v: number) =>
    onFloor(u, v) &&
    !blockers.some((b) => u + PLAYER_RADIUS > b.u0 && u - PLAYER_RADIUS < b.u1 && v + PLAYER_RADIUS > b.v0 && v - PLAYER_RADIUS < b.v1);
  const cellOf = (u: number, v: number) => [Math.floor((u - u0) / CELL), Math.floor((v - v0) / CELL)] as const;
  const center = (i: number, j: number) => [u0 + (i + 0.5) * CELL, v0 + (j + 0.5) * CELL] as const;

  const start = plan.spawn ?? { u: 0, v: 0.6 };
  const exit = plan.exit;
  // Step back from the joint plane into the segment.
  const goal =
    exit.turn === 0 ? { u: exit.u, v: exit.v - 0.6 } : { u: exit.u - exit.turn * 0.6, v: exit.v };

  const seen = new Uint8Array(nu * nv);
  const [si, sj] = cellOf(start.u, start.v);
  const [gi, gj] = cellOf(goal.u, goal.v);
  const queue: [number, number][] = [[si, sj]];
  seen[si + sj * nu] = 1;
  while (queue.length) {
    const [i, j] = queue.shift()!;
    if (Math.abs(i - gi) <= 1 && Math.abs(j - gj) <= 1) return true;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nu || nj >= nv || seen[ni + nj * nu]) continue;
      const [cu, cv] = center(ni, nj);
      if (!free(cu, cv)) continue;
      seen[ni + nj * nu] = 1;
      queue.push([ni, nj]);
    }
  }
  return false;
}

function walkSegments(seed: number, count: number): Segment[] {
  const h = new Hallway(seed);
  const all = [...h.start()];
  for (let i = 1; all.length < count; i++) {
    const res = h.advanceTo(i);
    all.push(...res.added);
  }
  return all;
}

describe('endless hallway', () => {
  it('is deterministic for a seed', () => {
    const a = walkSegments(1234, 30).map((s) => [s.kind, s.boxes.length, s.bots.length, s.exitFrame.x.toFixed(3), s.exitFrame.z.toFixed(3)]);
    const b = walkSegments(1234, 30).map((s) => [s.kind, s.boxes.length, s.bots.length, s.exitFrame.x.toFixed(3), s.exitFrame.z.toFixed(3)]);
    expect(a).toEqual(b);
  });

  it('never heads back south', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const s of walkSegments(seed, 60)) expect(s.exitFrame.heading).not.toBe(2);
    }
  });

  it('chains segments exactly at their ports', () => {
    const segs = walkSegments(77, 40);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].frame).toEqual(segs[i - 1].exitFrame);
      expect(segs[i].plan.entryWidth).toBeCloseTo(segs[i - 1].exitWidth);
    }
  });

  it('every segment can be walked from entry to exit', () => {
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      for (const s of walkSegments(seed, 50)) {
        expect(walkable(s.plan), `seed ${seed} segment ${s.index} (${s.kind})`).toBe(true);
      }
    }
  });

  it('places bots only on valid, supported spots inside their segment', () => {
    for (const seed of [5, 6, 7, 8]) {
      for (const s of walkSegments(seed, 50)) {
        for (const bot of s.bots) {
          expect(spotIsValid(bot, s.solids)).toBe(true);
          const local = toLocal(s.frame, bot.x, bot.z);
          const inside = s.plan.footprint.some((r) => local.u > r.u0 && local.u < r.u1 && local.v > r.v0 && local.v < r.v1);
          expect(inside).toBe(true);
        }
      }
    }
  });

  it('every hiding spot holds an angle into open space, not into a wall', () => {
    for (const seed of [12, 13, 14, 15, 16]) {
      for (const s of walkSegments(seed, 50)) {
        for (const spot of s.spots) {
          const eyeY = spot.y + HITBOXES[spot.stance].head.y;
          const ray = makeRay(spot.x, eyeY, spot.z, -Math.sin(spot.yaw), 0, -Math.cos(spot.yaw));
          const blocked = s.solids.some((b) => rayBox(ray, b, 1.5) < 1.5);
          expect(blocked, `seed ${seed} segment ${s.index} (${s.kind}) spot ${spot.tag}`).toBe(false);
        }
      }
    }
  });

  it('walk paths run from the entry to the exit port without clipping cover', () => {
    const r = 0.34;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      for (const s of walkSegments(seed, 40)) {
        const { path, boxes, exit } = s.plan;
        const last = path[path.length - 1];
        expect(last.u).toBeCloseTo(exit.u);
        expect(last.v).toBeCloseTo(exit.v);
        const blockers = boxes.filter((b) => b.y0 < 1.5 && b.y1 > 0.05);
        for (let i = 0; i + 1 < path.length; i++) {
          const a = path[i];
          const b = path[i + 1];
          const steps = Math.max(1, Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) / 0.1));
          for (let k = 0; k <= steps; k++) {
            const u = a.u + ((b.u - a.u) * k) / steps;
            const v = a.v + ((b.v - a.v) * k) / steps;
            const hit = blockers.find((x) => u + r > x.u0 && u - r < x.u1 && v + r > x.v0 && v - r < x.v1);
            expect(hit, `seed ${seed} segment ${s.index} (${s.kind}) at ${u.toFixed(2)},${v.toFixed(2)}`).toBeUndefined();
          }
        }
      }
    }
  });

  it('gives most segments at least one hiding spot and spreads bots apart', () => {
    const segs = walkSegments(99, 80).filter((s) => s.kind !== 'spawn');
    const withSpots = segs.filter((s) => s.spots.length > 0).length;
    expect(withSpots / segs.length).toBeGreaterThan(0.9);
    for (const s of segs) {
      for (let i = 0; i < s.bots.length; i++) {
        for (let j = i + 1; j < s.bots.length; j++) {
          expect(Math.hypot(s.bots[i].x - s.bots[j].x, s.bots[i].z - s.bots[j].z)).toBeGreaterThanOrEqual(2.2);
        }
      }
    }
  });

  it('keeps active segments from overlapping each other', () => {
    for (const seed of [101, 202, 303]) {
      const h = new Hallway(seed);
      h.start();
      for (let i = 1; i < 60; i++) {
        h.advanceTo(i);
        const segs = h.segments;
        for (let a = 0; a < segs.length; a++) {
          for (let b = a + 1; b < segs.length; b++) {
            for (const ra of segs[a].footprint) {
              for (const rb of segs[b].footprint) {
                const overlap =
                  ra.minX < rb.maxX - 0.05 && ra.maxX > rb.minX + 0.05 && ra.minZ < rb.maxZ - 0.05 && ra.maxZ > rb.minZ + 0.05;
                expect(overlap, `seed ${seed} segments ${segs[a].index}/${segs[b].index}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('solid boxes within a segment never overlap (no z-fighting)', () => {
    for (const s of walkSegments(4242, 60)) {
      for (let i = 0; i < s.boxes.length; i++) {
        for (let j = i + 1; j < s.boxes.length; j++) {
          expect(boxesOverlap(s.boxes[i], s.boxes[j], 1e-4), `segment ${s.index} (${s.kind}) boxes ${i}/${j}`).toBe(false);
        }
      }
    }
  });

  it('streams a sliding window and seals the path behind', () => {
    const h = new Hallway(9);
    h.start();
    const res = h.advanceTo(3);
    expect(res.removed.map((s) => s.index)).toEqual([0, 1]);
    expect(res.sealed.map((s) => s.index)).toEqual([2]);
    expect(h.segments[0].index).toBe(2);
    expect(h.segments[h.segments.length - 1].index).toBe(5);
    const seal = h.segments[0].seal!;
    // The seal fills the entry opening, just behind the entry plane.
    const mid = toWorld(h.segments[0].frame, 0, -0.25);
    expect(mid.x).toBeGreaterThanOrEqual(seal.minX - 1e-9);
    expect(mid.x).toBeLessThanOrEqual(seal.maxX + 1e-9);
    expect(mid.z).toBeGreaterThanOrEqual(seal.minZ - 1e-9);
    expect(mid.z).toBeLessThanOrEqual(seal.maxZ + 1e-9);
  });

  it('locates the player in the right segment', () => {
    const h = new Hallway(3);
    h.start();
    const sp = h.spawnPoint;
    expect(h.locate(sp.x, sp.z)).toBe(0);
    const s2 = h.get(2)!;
    const p = toWorld(s2.frame, 0, 1.5);
    expect(h.locate(p.x, p.z)).toBe(2);
  });
});
