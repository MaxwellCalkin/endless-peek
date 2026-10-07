import type { Rng } from '../core/rng';
import { makeRay, rayBox } from '../physics/aabb';
import {
  FLOOR_T,
  WALL_T as T,
  type LocalBox,
  type LocalSpot,
  type MaterialSlot,
  type Rect,
  type SegmentKind,
  type SegmentPlan,
  type SpotTag,
  type Stance,
  type Turn,
} from './layout';

/**
 * Segment builders. Each returns a plan in local (u, v) space.
 *
 * Joint rules that keep neighbouring segments seamless (no overlapping or z-fighting faces):
 * - A segment owns everything on its side of its entry plane (v >= 0) and exit plane.
 * - It starts with an entry wall at v in [0, T] that leaves an opening of exactly `entryWidth`
 *   centered on u = 0 (no wall pieces when its own width equals the opening).
 * - A forward exit sits at the far plane; a side exit is a gap in a side wall whose joint plane
 *   is the outer face of that wall. Walls on both sides of every opening are at least T long so
 *   the next segment's jambs are always backed by solid wall.
 */

export interface BuildContext {
  rng: Rng;
  entryWidth: number;
  turn: Turn;
  /** 0..1, shrinks optional sizes on retries so a segment fits between its neighbours. */
  squeeze: number;
}

/** Meters of open space along a horizontal ray from (u, eyeY, v), up to `max`. */
export function openDistance(boxes: readonly LocalBox[], u: number, eyeY: number, v: number, du: number, dv: number, max: number): number {
  const len = Math.hypot(du, dv) || 1;
  const ray = makeRay(u, eyeY, v, du / len, 0, dv / len);
  let best = max;
  for (const b of boxes) {
    const t = rayBox(ray, { minX: b.u0, maxX: b.u1, minY: b.y0, maxY: b.y1, minZ: b.v0, maxZ: b.v1 }, best);
    if (t < best) best = t;
  }
  return best;
}

class PlanBuilder {
  boxes: LocalBox[] = [];
  spots: LocalSpot[] = [];
  footprint: Rect[] = [];

  constructor(readonly height: number) {}

  solid(u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, mat: MaterialSlot): void {
    const b: LocalBox = {
      u0: Math.min(u0, u1),
      u1: Math.max(u0, u1),
      v0: Math.min(v0, v1),
      v1: Math.max(v0, v1),
      y0: Math.min(y0, y1),
      y1: Math.max(y0, y1),
      mat,
    };
    if (b.u1 - b.u0 > 1e-3 && b.v1 - b.v0 > 1e-3 && b.y1 - b.y0 > 1e-3) this.boxes.push(b);
  }

  wall(u0: number, u1: number, v0: number, v1: number, mat: MaterialSlot = 'wall'): void {
    this.solid(u0, u1, v0, v1, 0, this.height, mat);
  }

  floor(u0: number, u1: number, v0: number, v1: number): void {
    this.solid(u0, u1, v0, v1, -FLOOR_T, 0, 'floor');
    this.footprint.push({ u0: Math.min(u0, u1), u1: Math.max(u0, u1), v0: Math.min(v0, v1), v1: Math.max(v0, v1) });
  }

  spot(u: number, v: number, lookU: number, lookV: number, tag: SpotTag, stance: Stance = 'stand', y = 0): void {
    this.spots.push({ u, v, y, lookU, lookV, stance, tag });
  }

  /** Entry wall at v in [0, T] with a centered opening. Pieces stop at the side walls' inner faces. */
  entryWall(hw: number, opening: number): void {
    const half = opening / 2;
    if (hw - half > 1e-3) {
      this.wall(-hw, -half, 0, T);
      this.wall(half, hw, 0, T);
    }
  }

  /** Side wall on `side` (-1 left, 1 right) covering v in [v0, v1] except the given gaps. */
  sideWall(side: -1 | 1, hw: number, v0: number, v1: number, gaps: [number, number][]): void {
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    let cursor = v0;
    for (const [g0, g1] of sorted) {
      if (g0 > cursor) this.wall(side * hw, side * (hw + T), cursor, g0);
      cursor = Math.max(cursor, g1);
    }
    if (v1 > cursor) this.wall(side * hw, side * (hw + T), cursor, v1);
  }

  /** Far wall at v in [v0, v0 + T] spanning the interior, with an opening of `width` at `uc`. */
  farWallWithOpening(hw: number, v0: number, width: number, uc: number): void {
    this.wall(-hw, uc - width / 2, v0, v0 + T);
    this.wall(uc + width / 2, hw, v0, v0 + T);
  }

  build(kind: SegmentKind, entryWidth: number, exit: SegmentPlan['exit'], path: { u: number; v: number }[]): SegmentPlan {
    return {
      kind,
      wallHeight: this.height,
      entryWidth,
      boxes: this.boxes,
      spots: this.spots,
      footprint: this.footprint,
      exit,
      path,
    };
  }
}

/**
 * Walking line for straight-walled segments: down the middle (clear of wall-side cover),
 * through any `via` points, then out of the exit port.
 */
function walkPath(exit: SegmentPlan['exit'], length: number, via: { u: number; v: number }[] = [], start = 0.6): { u: number; v: number }[] {
  const pts = [{ u: 0, v: start }, ...via];
  if (exit.turn === 0) pts.push({ u: 0, v: Math.max(start, length - 2.6) }, { u: exit.u, v: exit.v - 1 }, { u: exit.u, v: exit.v });
  else pts.push({ u: 0, v: exit.v }, { u: exit.u, v: exit.v });
  return pts;
}

/** Shared exit construction for straight-walled segments (corridor, zigzag, pillar hall). */
function corridorExit(
  b: PlanBuilder,
  rng: Rng,
  hw: number,
  length: number,
  turn: Turn,
  sideGaps: { left: [number, number][]; right: [number, number][] },
  seamlessChance: number,
): SegmentPlan['exit'] {
  if (turn === 0) {
    const seamless = rng.chance(seamlessChance);
    const width = seamless ? 2 * hw : rng.range(2.6, Math.min(4.2, 2 * hw));
    const room = hw - width / 2;
    const uc = room > 1e-3 ? rng.range(-room, room) : 0;
    if (!seamless) b.farWallWithOpening(hw, length - T, width, uc);
    return { u: uc, v: length, turn: 0, width };
  }
  const width = rng.range(2.8, Math.min(4.4, length - 2));
  b.wall(-(hw + T), hw + T, length, length + T);
  (turn > 0 ? sideGaps.right : sideGaps.left).push([length - width, length]);
  return { u: turn * (hw + T), v: length - width / 2, turn, width };
}

function exitEnd(turn: Turn, length: number): number {
  return turn === 0 ? length : length + T;
}

export function buildSpawn(ctx: BuildContext): SegmentPlan {
  const hw = 2.6;
  const length = 11;
  const b = new PlanBuilder(4.6);
  b.wall(-hw, hw, -T, 0); // closed back wall behind the player
  b.floor(-(hw + T), hw + T, -T, length);
  b.sideWall(-1, hw, -T, length, []);
  b.sideWall(1, hw, -T, length, []);
  // A little cover so the first sightline isn't completely open.
  b.solid(-hw, -hw + 0.9, 6, 7.2, 0, 1.0, 'crate');
  const exit = corridorExit(b, ctx.rng, hw, length, 0, { left: [], right: [] }, 0.5);
  const plan = b.build('spawn', 0, exit, walkPath(exit, length, [], 1.2));
  plan.spawn = { u: 0, v: 1.2 };
  return plan;
}

export function buildCorridor(ctx: BuildContext): SegmentPlan {
  const { rng, entryWidth, turn } = ctx;
  const hw = Math.max(entryWidth / 2, rng.range(1.9, 3.1 - ctx.squeeze * 0.8));
  const length = rng.range(14, 24 - ctx.squeeze * 8);
  const b = new PlanBuilder(rng.range(4.2, 5.0));
  b.entryWall(hw, entryWidth);

  const gaps = { left: [] as [number, number][], right: [] as [number, number][] };
  const exit = corridorExit(b, rng, hw, length, turn, gaps, 0.35);
  const end = exitEnd(turn, length);
  b.floor(-(hw + T), hw + T, 0, end);

  // Alcoves: recesses in the side walls, the classic "check it as you pass" angle.
  const alcoves = rng.weighted([
    [0, 1],
    [1, 3],
    [2, 2],
  ] as const);
  for (let i = 0; i < alcoves; i++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = rng.sign();
      const aw = rng.range(2.0, 3.0);
      const ad = rng.range(1.4, 2.4 - ctx.squeeze * 0.6);
      const maxV = (side === turn ? length - exit.width - 1.5 : length - 2) - aw;
      if (maxV < 3) continue;
      const va = rng.range(3, maxV);
      const list = side < 0 ? gaps.left : gaps.right;
      if (list.some(([g0, g1]) => va < g1 + 1.5 && va + aw > g0 - 1.5)) continue;
      list.push([va, va + aw]);
      // Alcove side walls extend from the main wall's outer face to the alcove back wall.
      b.wall(side * (hw + T), side * (hw + ad), va - T, va);
      b.wall(side * (hw + T), side * (hw + ad), va + aw, va + aw + T);
      b.wall(side * (hw + ad), side * (hw + ad + T), va - T, va + aw + T);
      b.floor(side * (hw + T), side * (hw + ad + T), va - T, va + aw + T);
      const deepU = side * (hw + ad - 0.45);
      // Hold across the corridor through the opening; you appear as you pass the alcove.
      b.spot(deepU, va + aw - 0.45, -side * hw, va + aw * 0.4, 'alcove', rng.chance(0.25) ? 'crouch' : 'stand');
      b.spot(deepU, va + 0.45, -side * hw, va + aw * 0.6, 'alcove');
      break;
    }
  }

  // Crates against the walls: head-height or chest-height cover to hold behind.
  const reserved = { left: [] as [number, number][], right: [] as [number, number][] };
  const crates = rng.weighted([
    [0, 2],
    [1, 3],
    [2, 1],
  ] as const);
  for (let i = 0; i < crates; i++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = rng.sign();
      const w = Math.min(rng.range(0.9, 1.3), hw * 2 - 2.4);
      const d = rng.range(0.9, 1.5);
      const h = rng.pick([1.0, 1.0, 1.4, 2.1]);
      if (w < 0.8) break;
      const vc = rng.range(4, length - 4);
      const taken = [...(side < 0 ? gaps.left : gaps.right), ...(side < 0 ? reserved.left : reserved.right)];
      if (taken.some(([g0, g1]) => vc - d / 2 < g1 + 1.0 && vc + d / 2 > g0 - 1.0)) continue;
      (side < 0 ? reserved.left : reserved.right).push([vc - d / 2, vc + d / 2]);
      b.solid(side * (hw - w), side * hw, vc - d / 2, vc + d / 2, 0, h, rng.chance(0.5) ? 'crate' : 'crateAlt');
      const spotV = vc + d / 2 + 0.45;
      if (h < 1.6) b.spot(side * (hw - 0.45), spotV, -side * hw * 0.3, Math.max(0, vc - 6), 'crate');
      else b.spot(side * (hw - 0.45), spotV, -side * hw, spotV - 0.8, 'crate');
      break;
    }
  }

  sideWalls(b, hw, end, turn, length, gaps);
  addFarSpots(b, hw, length, exit);
  return b.build('corridor', entryWidth, exit, walkPath(exit, length));
}

function sideWalls(
  b: PlanBuilder,
  hw: number,
  end: number,
  turn: Turn,
  length: number,
  gaps: { left: [number, number][]; right: [number, number][] },
): void {
  // Side walls end where the far wall begins for side exits (far wall spans the full width).
  const wallEnd = turn === 0 ? end : length;
  b.sideWall(-1, hw, 0, wallEnd, gaps.left);
  b.sideWall(1, hw, 0, wallEnd, gaps.right);
}

/** Long-angle spots at the far end of a straight-walled segment. */
function addFarSpots(b: PlanBuilder, hw: number, length: number, exit: SegmentPlan['exit']): void {
  if (exit.turn === 0) {
    if (exit.width < 2 * hw - 1.2) {
      const farV = length - T - 0.45;
      if (exit.u - exit.width / 2 > -hw + 1.0) b.spot(-hw + 0.45, farV, 0, 0, 'long');
      if (exit.u + exit.width / 2 < hw - 1.0) b.spot(hw - 0.45, farV, 0, 0, 'long');
    }
  } else {
    b.spot(-exit.turn * (hw - 0.45), length - 0.45, 0, 0, 'long');
  }
}

interface Obstacle extends Rect {
  /** Height of the top surface. */
  h: number;
}

function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
  return a.u0 < b.u1 + margin && a.u1 > b.u0 - margin && a.v0 < b.v1 + margin && a.v1 > b.v0 - margin;
}

/** True when the polyline passes within `clearance` of the rect. Sampled, which is plenty at 0.1 m. */
function pathHitsRect(path: { u: number; v: number }[], r: Rect, clearance: number): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const c = path[i + 1];
    const len = Math.hypot(c.u - a.u, c.v - a.v);
    const steps = Math.max(1, Math.ceil(len / 0.1));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = a.u + (c.u - a.u) * t;
      const v = a.v + (c.v - a.v) * t;
      if (u > r.u0 - clearance && u < r.u1 + clearance && v > r.v0 - clearance && v < r.v1 + clearance) return true;
    }
  }
  return false;
}

/** Point just behind a rect as seen from (eu, ev), plus the unit direction from the eye to the rect. */
function behind(r: Rect, eu: number, ev: number, gap: number): { u: number; v: number; du: number; dv: number; perpExtent: number } {
  const cu = (r.u0 + r.u1) / 2;
  const cv = (r.v0 + r.v1) / 2;
  let du = cu - eu;
  let dv = cv - ev;
  const len = Math.hypot(du, dv) || 1;
  du /= len;
  dv /= len;
  const hu = (r.u1 - r.u0) / 2;
  const hv = (r.v1 - r.v0) / 2;
  // Distance from the center to the rect boundary along the direction.
  const along = Math.min(Math.abs(du) > 1e-6 ? hu / Math.abs(du) : Infinity, Math.abs(dv) > 1e-6 ? hv / Math.abs(dv) : Infinity);
  const perpExtent = Math.abs(-dv) * hu + Math.abs(du) * hv;
  return { u: cu + du * (along + gap), v: cv + dv * (along + gap), du, dv, perpExtent };
}

export function buildRoom(ctx: BuildContext): SegmentPlan {
  const { rng, entryWidth, turn } = ctx;
  const hw = Math.max(entryWidth / 2 + 1.5, rng.range(4.5, 7.5 - ctx.squeeze * 2.5));
  const depth = rng.range(9, 15 - ctx.squeeze * 4);
  const b = new PlanBuilder(rng.range(4.8, 6.0));
  const vNear = T;
  const vFar = T + depth;
  b.entryWall(hw, entryWidth);
  b.floor(-(hw + T), hw + T, 0, vFar + T);

  const gaps = { left: [] as [number, number][], right: [] as [number, number][] };
  let exit: SegmentPlan['exit'];
  let exitInner: { u: number; v: number };
  if (turn === 0) {
    const width = rng.range(2.6, 4.0);
    const room = hw - width / 2 - 0.6;
    const uc = rng.range(-room, room);
    b.farWallWithOpening(hw, vFar, width, uc);
    exit = { u: uc, v: vFar + T, turn: 0, width };
    exitInner = { u: uc, v: vFar - 0.8 };
  } else {
    const width = rng.range(2.8, 4.0);
    const minC = vNear + Math.max(depth * 0.45, width / 2 + 0.8);
    const maxC = vFar - width / 2 - 0.4;
    const vc = rng.range(Math.min(minC, maxC), maxC);
    b.wall(-hw, hw, vFar, vFar + T);
    (turn > 0 ? gaps.right : gaps.left).push([vc - width / 2, vc + width / 2]);
    exit = { u: turn * (hw + T), v: vc, turn, width };
    exitInner = { u: turn * (hw - 0.8), v: vc };
  }
  b.sideWall(-1, hw, 0, vFar + T, gaps.left);
  b.sideWall(1, hw, 0, vFar + T, gaps.right);

  const path = [
    { u: 0, v: 0 },
    { u: 0, v: vNear + 1.2 },
    exitInner,
    { u: exit.turn === 0 ? exit.u : exit.turn * hw, v: exit.turn === 0 ? vFar + T : exit.v },
  ];
  const obstacles: Obstacle[] = [];
  const eye = { u: 0, v: -1 };

  // Raised platform ("heaven") on the side away from the exit.
  if (depth >= 10 && hw >= 5 && rng.chance(0.35)) {
    const q: -1 | 1 = exit.turn !== 0 ? (-exit.turn as -1 | 1) : exit.u > 0 ? -1 : 1;
    const pw = rng.range(3.5, Math.min(5, hw - 1));
    const pd = rng.range(2.6, 3.4);
    const ph = rng.range(2.2, 2.8);
    const rect: Rect = { u0: Math.min(q * (hw - pw), q * hw), u1: Math.max(q * (hw - pw), q * hw), v0: vFar - pd, v1: vFar };
    if (!pathHitsRect(path, rect, 0.9)) {
      b.solid(rect.u0, rect.u1, rect.v0, rect.v1, 0, ph, 'platform');
      // Railing along the front edge and the open inner side.
      b.solid(rect.u0, rect.u1, rect.v0, rect.v0 + 0.15, ph, ph + 1.0, 'metal');
      const innerU = q * (hw - pw);
      b.solid(innerU, innerU + q * 0.15, rect.v0 + 0.15, rect.v1, ph, ph + 1.0, 'metal');
      obstacles.push({ ...rect, h: ph });
      b.spot(q * (hw - pw / 2), rect.v0 + 0.75, 0, vNear, 'high', 'stand', ph);
    }
  }

  // Crates and pillars.
  const wanted = rng.int(2, 5);
  let placed = 0;
  for (let attempt = 0; attempt < 40 && placed < wanted; attempt++) {
    const type = rng.weighted([
      ['low', 3],
      ['mid', 2],
      ['tall', 2],
      ['stack', 1],
      ['pillar', hw >= 6 ? 1 : 0],
    ] as const);
    let w: number;
    let d: number;
    let h: number;
    switch (type) {
      case 'low':
        w = rng.pick([1.0, 1.2, 1.6]);
        d = rng.pick([1.0, 1.2]);
        h = 1.0;
        break;
      case 'mid':
        w = 1.2;
        d = 1.2;
        h = 1.4;
        break;
      case 'tall':
        w = rng.range(1.5, 2.2);
        d = rng.range(1.2, 2.0);
        h = rng.range(2.0, 2.6);
        break;
      case 'stack':
        w = 1.3;
        d = 1.3;
        h = 1.3;
        break;
      case 'pillar':
        w = 0.9;
        d = 0.9;
        h = b.height;
        break;
    }
    const againstWall = type !== 'pillar' && rng.chance(0.3);
    let cu: number;
    if (againstWall) cu = rng.sign() * (hw - w / 2);
    else cu = rng.range(-hw + 0.9 + w / 2, hw - 0.9 - w / 2);
    const cv = rng.range(vNear + 2.2 + d / 2, vFar - 0.9 - d / 2);
    const rect: Rect = { u0: cu - w / 2, u1: cu + w / 2, v0: cv - d / 2, v1: cv + d / 2 };
    if (pathHitsRect(path, rect, 0.85)) continue;
    if (obstacles.some((o) => rectsOverlap(o, rect, 1.0))) continue;
    // Keep side-exit gaps clear.
    if (exit.turn !== 0 && Math.abs(cu - exit.turn * hw) < w / 2 + 1.2 && Math.abs(cv - exit.v) < d / 2 + exit.width / 2 + 0.6) continue;

    const mat: MaterialSlot = type === 'pillar' ? 'wall' : rng.chance(0.5) ? 'crate' : 'crateAlt';
    b.solid(rect.u0, rect.u1, rect.v0, rect.v1, 0, h, mat);
    if (type === 'stack') {
      const tw = 1.0;
      const ou = rng.range(-0.1, 0.1);
      const ov = rng.range(-0.1, 0.1);
      b.solid(cu + ou - tw / 2, cu + ou + tw / 2, cv + ov - tw / 2, cv + ov + tw / 2, h, h + 1.0, mat === 'crate' ? 'crateAlt' : 'crate');
    }
    obstacles.push({ ...rect, h: type === 'stack' ? h + 1 : h });
    placed++;

    const bh = behind(rect, eye.u, eye.v, 0.48);
    if (type === 'low' || type === 'mid') {
      b.spot(bh.u, bh.v, 0, vNear, 'crate', type === 'low' && rng.chance(0.3) ? 'crouch' : 'stand');
    } else {
      // Hold sideways toward whichever side of the cover has more room.
      const open = (sd: number) => openDistance(b.boxes, bh.u, 1.62, bh.v, -bh.dv * sd, bh.du * sd, 4);
      const pick = rng.sign();
      const side = open(pick) >= open(-pick) ? pick : -pick;
      b.spot(bh.u, bh.v, bh.u - bh.dv * side * 4, bh.v + bh.du * side * 4, type === 'pillar' ? 'pillar' : 'crate');
      // Partially exposed spot beside the cover: someone holding off the edge.
      const pu = -bh.dv * side;
      const pv = bh.du * side;
      const off = bh.perpExtent + 0.42;
      b.spot(bh.u + pu * off - bh.du * 0.55, bh.v + pv * off - bh.dv * 0.55, 0, vNear, 'crate-edge');
    }
  }

  // Corners next to the entry: the angles you clear first when stepping through a door.
  b.spot(-hw + 0.45, vNear + 0.45, 0, vNear + 0.6, 'corner-close', rng.chance(0.2) ? 'crouch' : 'stand');
  b.spot(hw - 0.45, vNear + 0.45, 0, vNear + 0.6, 'corner-close', rng.chance(0.2) ? 'crouch' : 'stand');
  b.spot(-hw + 0.45, vFar - 0.45, 0, vNear, 'corner-far');
  b.spot(hw - 0.45, vFar - 0.45, 0, vNear, 'corner-far');
  if (exit.turn === 0) {
    const l = exit.u - exit.width / 2 - 0.55;
    const r = exit.u + exit.width / 2 + 0.55;
    if (l > -hw + 0.5) b.spot(l, vFar - 0.45, 0, vNear, 'exit');
    if (r < hw - 0.5) b.spot(r, vFar - 0.45, 0, vNear, 'exit');
  }
  return b.build('room', entryWidth, exit, [{ u: 0, v: 0.6 }, path[1], exitInner, { u: exit.u, v: exit.v }]);
}

export function buildZigzag(ctx: BuildContext): SegmentPlan {
  const { rng, entryWidth, turn } = ctx;
  const hw = Math.max(entryWidth / 2, rng.range(2.6, 3.4));
  const count = rng.int(2, 3);
  const spacing = rng.range(5.5, 7.5 - ctx.squeeze * 1.5);
  const length = spacing * (count + 1);
  const b = new PlanBuilder(rng.range(4.2, 5.0));
  b.entryWall(hw, entryWidth);
  const gaps = { left: [] as [number, number][], right: [] as [number, number][] };
  const exit = corridorExit(b, rng, hw, length, turn, gaps, 0.5);
  const end = exitEnd(turn, length);
  b.floor(-(hw + T), hw + T, 0, end);

  let side = rng.sign();
  const pt = 0.6;
  const via: { u: number; v: number }[] = [];
  for (let i = 0; i < count; i++) {
    const vc = spacing * (i + 1) + rng.range(-0.6, 0.6);
    const gap = rng.range(1.9, 2.4);
    // Partition from `side` wall leaving an opening of `gap` against the other wall.
    const tipU = side < 0 ? hw - gap : -hw + gap;
    b.solid(side < 0 ? -hw : tipU, side < 0 ? tipU : hw, vc - pt / 2, vc + pt / 2, 0, b.height, 'wall');
    const behindV = vc + pt / 2 + 0.45;
    const openingU = side < 0 ? hw - gap / 2 : -hw + gap / 2;
    via.push({ u: openingU, v: vc - 1.1 }, { u: openingU, v: vc + 1.1 });
    b.spot(tipU + side * 0.45, behindV, openingU, behindV, 'tight');
    b.spot(side * (hw - 0.45), behindV, openingU, behindV - 0.15, 'deep', rng.chance(0.25) ? 'crouch' : 'stand');
    side = -side as -1 | 1;
  }
  sideWalls(b, hw, end, turn, length, gaps);
  addFarSpots(b, hw, length, exit);
  return b.build('zigzag', entryWidth, exit, walkPath(exit, length, via));
}

export function buildPillarHall(ctx: BuildContext): SegmentPlan {
  const { rng, entryWidth, turn } = ctx;
  const hw = Math.max(entryWidth / 2 + 1, rng.range(5, 6.5 - ctx.squeeze * 1.5));
  const length = rng.range(20, 28 - ctx.squeeze * 6);
  const b = new PlanBuilder(rng.range(5.5, 6.5));
  b.entryWall(hw, entryWidth);
  const gaps = { left: [] as [number, number][], right: [] as [number, number][] };
  const exit = corridorExit(b, rng, hw, length, turn, gaps, 0.3);
  const end = exitEnd(turn, length);
  b.floor(-(hw + T), hw + T, 0, end);

  const rowU = hw * rng.range(0.4, 0.55);
  const ps = rng.range(0.9, 1.3);
  const step = rng.range(5, 7);
  const stagger = rng.chance(0.5) ? step / 2 : 0;
  for (const s of [-1, 1] as const) {
    for (let v = 4.5 + (s > 0 ? stagger : 0); v < length - 4.5; v += step) {
      const rect: Rect = { u0: s * rowU - ps / 2, u1: s * rowU + ps / 2, v0: v - ps / 2, v1: v + ps / 2 };
      b.solid(rect.u0, rect.u1, rect.v0, rect.v1, 0, b.height, 'accent');
      const bh = behind(rect, 0, -1, 0.48);
      const open = (sd: number) => openDistance(b.boxes, bh.u, 1.62, bh.v, -bh.dv * sd, bh.du * sd, 4);
      const pick = rng.sign();
      const side = open(pick) >= open(-pick) ? pick : -pick;
      b.spot(bh.u, bh.v, bh.u - bh.dv * side * 4, bh.v + bh.du * side * 4, 'pillar', rng.chance(0.2) ? 'crouch' : 'stand');
      const off = bh.perpExtent + 0.42;
      b.spot(bh.u - bh.dv * side * off - bh.du * 0.6, bh.v + bh.du * side * off - bh.dv * 0.6, 0, 0, 'crate-edge');
    }
  }
  sideWalls(b, hw, end, turn, length, gaps);
  addFarSpots(b, hw, length, exit);
  return b.build('pillars', entryWidth, exit, walkPath(exit, length));
}

export const BUILDERS: Record<Exclude<SegmentKind, 'spawn'>, (ctx: BuildContext) => SegmentPlan> = {
  corridor: buildCorridor,
  room: buildRoom,
  zigzag: buildZigzag,
  pillars: buildPillarHall,
};
