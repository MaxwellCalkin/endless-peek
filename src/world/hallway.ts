import { Rng } from '../core/rng';
import { HITBOXES } from '../config/agent';
import { type Box, boxesOverlap, makeRay, rayBox } from '../physics/aabb';
import type { Solid, SurfaceKind } from '../physics/world';
import {
  type Frame,
  type Heading,
  type LocalBox,
  type MaterialSlot,
  type SegmentKind,
  type SegmentPlan,
  type SpotTag,
  type Stance,
  type Turn,
  WALL_T,
  toWorld,
  turnHeading,
  yawFromDirection,
} from './layout';
import { BUILDERS, buildSpawn } from './segments';

export interface WorldBox extends Box {
  mat: MaterialSlot;
}

export interface WorldSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  stance: Stance;
  tag: SpotTag;
}

export interface Segment {
  index: number;
  kind: SegmentKind;
  frame: Frame;
  plan: SegmentPlan;
  theme: number;
  boxes: WorldBox[];
  solids: Solid[];
  /** Floor rectangles in world space (y ignored). */
  footprint: Box[];
  /** Every valid hiding spot. */
  spots: WorldSpot[];
  /** The spots that actually got a bot. */
  bots: WorldSpot[];
  exitFrame: Frame;
  exitWidth: number;
  /** Box that closes this segment's entry once the segment behind it is unloaded. */
  seal: WorldBox | null;
  sealed: boolean;
}

export interface Density {
  min: number;
  max: number;
  /** Chance a segment has no bots at all, so you can't autopilot "there's always one". */
  emptyChance: number;
}

export const DEFAULT_DENSITY: Density = { min: 1, max: 3, emptyChance: 0.12 };

/** Bot hull used to validate spots; slightly larger than the real hitboxes. */
export const SPOT_RADIUS = 0.38;
const SPOT_HEIGHT: Record<Stance, number> = { stand: 1.85, crouch: 1.3 };

const AHEAD = 2;
const BEHIND = 1;
const THEMES = 5;
const SEGMENTS_PER_THEME = 4;

const SURFACE: Record<MaterialSlot, SurfaceKind> = {
  wall: 'wall',
  accent: 'wall',
  floor: 'floor',
  platform: 'wall',
  crate: 'crate',
  crateAlt: 'crate',
  metal: 'metal',
  seal: 'seal',
};

export function boxToWorld(f: Frame, lb: LocalBox): WorldBox {
  const a = toWorld(f, lb.u0, lb.v0);
  const c = toWorld(f, lb.u1, lb.v1);
  return {
    minX: Math.min(a.x, c.x),
    maxX: Math.max(a.x, c.x),
    minY: lb.y0,
    maxY: lb.y1,
    minZ: Math.min(a.z, c.z),
    maxZ: Math.max(a.z, c.z),
    mat: lb.mat,
  };
}

function rectOverlap2D(a: Box, b: Box, eps: number): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps;
}

export function spotIsValid(spot: { x: number; y: number; z: number; stance: Stance }, solids: readonly Box[]): boolean {
  const hull: Box = {
    minX: spot.x - SPOT_RADIUS,
    maxX: spot.x + SPOT_RADIUS,
    minY: spot.y + 0.02,
    maxY: spot.y + SPOT_HEIGHT[spot.stance],
    minZ: spot.z - SPOT_RADIUS,
    maxZ: spot.z + SPOT_RADIUS,
  };
  let supported = false;
  for (const s of solids) {
    if (boxesOverlap(s, hull, 0.005)) return false;
    if (Math.abs(s.maxY - spot.y) < 0.02 && spot.x >= s.minX && spot.x <= s.maxX && spot.z >= s.minZ && spot.z <= s.maxZ) {
      supported = true;
    }
  }
  return supported;
}

/** A bot must be able to see down the angle it holds (at least `minOpen` meters of open air). */
export function heldAngleClear(spot: WorldSpot, solids: readonly Box[], minOpen = 1.5): boolean {
  const eyeY = spot.y + HITBOXES[spot.stance].head.y;
  const ray = makeRay(spot.x, eyeY, spot.z, -Math.sin(spot.yaw), 0, -Math.cos(spot.yaw));
  return !solids.some((b) => rayBox(ray, b, minOpen) < minOpen);
}

export function realizeSegment(index: number, kind: SegmentKind, frame: Frame, plan: SegmentPlan): Segment {
  const boxes = plan.boxes.map((b) => boxToWorld(frame, b));
  const solids: Solid[] = boxes.map((b) => ({ ...b, kind: SURFACE[b.mat] }));
  const footprint = plan.footprint.map((r) => boxToWorld(frame, { ...r, y0: -1, y1: 1, mat: 'floor' }));
  const spots: WorldSpot[] = [];
  for (const s of plan.spots) {
    const p = toWorld(frame, s.u, s.v);
    const look = toWorld(frame, s.lookU, s.lookV);
    const spot: WorldSpot = {
      x: p.x,
      y: s.y,
      z: p.z,
      yaw: yawFromDirection(look.x - p.x, look.z - p.z),
      stance: s.stance,
      tag: s.tag,
    };
    if (spotIsValid(spot, solids) && heldAngleClear(spot, solids)) spots.push(spot);
  }
  const exitPos = toWorld(frame, plan.exit.u, plan.exit.v);
  const exitFrame: Frame = { x: exitPos.x, z: exitPos.z, heading: turnHeading(frame.heading, plan.exit.turn) };
  const seal =
    plan.entryWidth > 0
      ? boxToWorld(frame, {
          u0: -plan.entryWidth / 2,
          u1: plan.entryWidth / 2,
          v0: -WALL_T,
          v1: 0,
          y0: 0,
          y1: plan.wallHeight,
          mat: 'seal',
        })
      : null;
  return {
    index,
    kind,
    frame,
    plan,
    theme: Math.floor(index / SEGMENTS_PER_THEME) % THEMES,
    boxes,
    solids,
    footprint,
    spots,
    bots: [],
    exitFrame,
    exitWidth: plan.exit.width,
    seal,
    sealed: false,
  };
}

const SPOT_WEIGHT: Record<SpotTag, number> = {
  alcove: 1.2,
  'corner-close': 1.3,
  'corner-far': 0.8,
  crate: 1.1,
  'crate-edge': 1,
  pillar: 1,
  high: 1.4,
  long: 0.5,
  tight: 1.3,
  deep: 1,
  exit: 0.7,
};

export function chooseBots(spots: readonly WorldSpot[], rng: Rng, density: Density): WorldSpot[] {
  if (spots.length === 0 || rng.chance(density.emptyChance)) return [];
  const want = rng.int(density.min, Math.max(density.min, density.max));
  const pool = [...spots];
  const chosen: WorldSpot[] = [];
  while (chosen.length < want && pool.length > 0) {
    const pick = rng.weighted(pool.map((s) => [s, SPOT_WEIGHT[s.tag]] as const));
    pool.splice(pool.indexOf(pick), 1);
    if (chosen.some((c) => Math.hypot(c.x - pick.x, c.z - pick.z) < 2.2)) continue;
    if (pick.tag === 'long' && chosen.some((c) => c.tag === 'long')) continue;
    chosen.push(pick);
  }
  return chosen;
}

export interface AdvanceResult {
  added: Segment[];
  removed: Segment[];
  /** Segments whose entry just got sealed (their seal box must be added to collision/render). */
  sealed: Segment[];
}

/**
 * The endless hallway: a sliding window of segments around the player. Segments ahead are
 * generated on demand; segments far enough behind are unloaded and the path is sealed so you
 * can never walk into the void.
 */
export class Hallway {
  readonly segments: Segment[] = [];
  current = 0;
  private rng: Rng;
  private kinds: SegmentKind[] = [];
  private lateralRun = 0;

  constructor(
    readonly seed: number,
    public density: Density = DEFAULT_DENSITY,
  ) {
    this.rng = new Rng(seed);
  }

  /** Builds the spawn room and the first segments ahead. Returns everything that was created. */
  start(): Segment[] {
    const spawnRng = this.rng.fork();
    const plan = buildSpawn({ rng: spawnRng, entryWidth: 0, turn: 0, squeeze: 0 });
    const spawn = realizeSegment(0, 'spawn', { x: 0, z: 0, heading: 0 }, plan);
    this.segments.push(spawn);
    this.kinds.push('spawn');
    const out = [spawn];
    while (this.segments[this.segments.length - 1].index < AHEAD) out.push(this.generateNext());
    return out;
  }

  get spawnPoint(): { x: number; z: number; yaw: number } {
    const s = this.segments.find((seg) => seg.kind === 'spawn');
    if (!s || !s.plan.spawn) return { x: 0, z: 0, yaw: 0 };
    const p = toWorld(s.frame, s.plan.spawn.u, s.plan.spawn.v);
    return { x: p.x, z: p.z, yaw: 0 };
  }

  get(index: number): Segment | undefined {
    return this.segments.find((s) => s.index === index);
  }

  /** Index of the highest segment whose floor contains the point, or -1. */
  locate(x: number, z: number): number {
    let best = -1;
    for (const s of this.segments) {
      if (s.index <= best) continue;
      for (const r of s.footprint) {
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
          best = s.index;
          break;
        }
      }
    }
    return best;
  }

  advanceTo(index: number): AdvanceResult {
    const result: AdvanceResult = { added: [], removed: [], sealed: [] };
    if (index <= this.current) return result;
    this.current = index;
    while (this.segments[this.segments.length - 1].index < index + AHEAD) result.added.push(this.generateNext());
    while (this.segments.length > 0 && this.segments[0].index < index - BEHIND) {
      result.removed.push(this.segments.shift()!);
    }
    const oldest = this.segments[0];
    if (oldest && oldest.seal && !oldest.sealed && result.removed.length > 0) {
      oldest.sealed = true;
      result.sealed.push(oldest);
    }
    return result;
  }

  private chooseTurn(heading: Heading): Turn {
    if (heading === 0) {
      return this.rng.weighted([
        [-1, 1],
        [0, 1.4],
        [1, 1],
      ] as const);
    }
    const back: Turn = heading === 1 ? -1 : 1;
    if (this.lateralRun >= 2) return back;
    return this.rng.weighted([
      [back, 2.2],
      [0, 1],
    ] as const);
  }

  private chooseKind(): Exclude<SegmentKind, 'spawn'> {
    const last = this.kinds[this.kinds.length - 1];
    const prev = this.kinds[this.kinds.length - 2];
    const weights: [Exclude<SegmentKind, 'spawn'>, number][] = [
      ['room', last === 'room' ? 0.15 : 0.36],
      ['corridor', last === 'room' ? 0.45 : 0.26],
      ['zigzag', 0.18],
      ['pillars', last === 'pillars' ? 0.05 : 0.18],
    ];
    const filtered = weights.map(([k, w]) => [k, k === last && k === prev ? 0 : w] as [typeof k, number]);
    return this.rng.weighted(filtered);
  }

  private generateNext(): Segment {
    const prev = this.segments[this.segments.length - 1];
    const index = prev.index + 1;
    const frame = prev.exitFrame;
    const others = this.segments;
    let fallback: Segment | null = null;

    for (let attempt = 0; attempt < 14; attempt++) {
      const squeeze = Math.min(1, attempt / 8);
      const kind = attempt < 10 ? this.chooseKind() : 'corridor';
      let turn = this.chooseTurn(frame.heading);
      if (attempt >= 6 && frame.heading !== 0) turn = frame.heading === 1 ? -1 : 1;
      if (attempt >= 10) turn = frame.heading === 0 ? 0 : turn;
      const segRng = this.rng.fork();
      const plan = BUILDERS[kind]({ rng: segRng, entryWidth: prev.exitWidth, turn, squeeze });
      const seg = realizeSegment(index, kind, frame, plan);
      const clashes = others.some((o) => o.footprint.some((a) => seg.footprint.some((b) => rectOverlap2D(a, b, 0.05))));
      if (!clashes) {
        this.accept(seg, segRng);
        return seg;
      }
      fallback ??= seg;
    }
    // Practically unreachable; the overlap would only be visual and far from the player.
    const seg = fallback!;
    this.accept(seg, this.rng.fork());
    return seg;
  }

  private accept(seg: Segment, rng: Rng): void {
    seg.bots = chooseBots(seg.spots, rng, this.density);
    this.segments.push(seg);
    this.kinds.push(seg.kind);
    this.lateralRun = seg.exitFrame.heading === 0 ? 0 : this.lateralRun + 1;
  }
}
