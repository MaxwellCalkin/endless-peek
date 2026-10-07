/**
 * Shared types and coordinate helpers for the endless hallway.
 *
 * Every segment is authored in its own local frame:
 *   u = lateral meters (positive = right when walking forward)
 *   v = forward meters from the segment's entry plane (v = 0)
 *   y = height above the hallway floor
 * A Frame places that local space in the world. Headings are axis aligned, so local boxes
 * stay axis aligned in world space.
 */

export type Heading = 0 | 1 | 2 | 3; // 0 = north (-Z), 1 = east (+X), 2 = south (+Z), 3 = west (-X)
export type Turn = -1 | 0 | 1; // -1 = left, 0 = straight, 1 = right

export interface Frame {
  x: number;
  z: number;
  heading: Heading;
}

const FORWARD: readonly { x: number; z: number }[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

export function forwardOf(h: Heading): { x: number; z: number } {
  return FORWARD[h];
}

export function rightOf(h: Heading): { x: number; z: number } {
  return FORWARD[((h + 1) % 4) as Heading];
}

export function turnHeading(h: Heading, turn: Turn): Heading {
  return (((h + turn) % 4) + 4) % 4 as Heading;
}

export function toWorld(f: Frame, u: number, v: number): { x: number; z: number } {
  const fw = FORWARD[f.heading];
  const r = FORWARD[(f.heading + 1) % 4];
  return { x: f.x + r.x * u + fw.x * v, z: f.z + r.z * u + fw.z * v };
}

/** Inverse of toWorld. */
export function toLocal(f: Frame, x: number, z: number): { u: number; v: number } {
  const fw = FORWARD[f.heading];
  const r = FORWARD[(f.heading + 1) % 4];
  const dx = x - f.x;
  const dz = z - f.z;
  return { u: dx * r.x + dz * r.z, v: dx * fw.x + dz * fw.z };
}

/**
 * Yaw convention used everywhere (matches three.js Object3D.rotation.y):
 * forward = (-sin(yaw), 0, -cos(yaw)); yaw 0 looks north (-Z), positive yaw turns left.
 */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function headingYaw(h: Heading): number {
  const f = FORWARD[h];
  return yawFromDirection(f.x, f.z);
}

export type MaterialSlot = 'wall' | 'accent' | 'floor' | 'crate' | 'crateAlt' | 'metal' | 'platform' | 'seal';

export interface LocalBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  y0: number;
  y1: number;
  mat: MaterialSlot;
}

export type Stance = 'stand' | 'crouch';

/** Where a bot can hide. `look` is the point the bot holds its crosshair toward. */
export interface LocalSpot {
  u: number;
  v: number;
  y: number;
  lookU: number;
  lookV: number;
  stance: Stance;
  /** Angle family, used for weighting and post-death feedback. */
  tag: SpotTag;
}

export type SpotTag = 'alcove' | 'corner-close' | 'corner-far' | 'crate' | 'crate-edge' | 'pillar' | 'high' | 'long' | 'tight' | 'deep' | 'exit';

export interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export type SegmentKind = 'spawn' | 'corridor' | 'room' | 'zigzag' | 'pillars';

export interface ExitPort {
  /** Center of the exit opening in local space (on the joint plane). */
  u: number;
  v: number;
  turn: Turn;
  width: number;
}

export interface SegmentPlan {
  kind: SegmentKind;
  wallHeight: number;
  entryWidth: number;
  boxes: LocalBox[];
  spots: LocalSpot[];
  /** Floor rectangles; together they cover every box. Used for overlap and containment tests. */
  footprint: Rect[];
  exit: ExitPort;
  /** Spawn point for the player (only on the spawn segment). */
  spawn?: { u: number; v: number };
}

export const WALL_T = 0.5;
export const FLOOR_T = 0.5;
