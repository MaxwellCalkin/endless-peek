import type { MoveParams } from '../player/movement';

/**
 * Player / agent constants. Meters, seconds, m/s.
 *
 * VALORANT runs on Unreal Engine's CharacterMovementComponent. MaxAcceleration and braking
 * deceleration below are the engine defaults (2048 cm/s^2). Ground friction was fitted so a
 * full-speed rifle carrier (5.4 m/s) reaches the 25% speed accuracy threshold in 0.104 s and
 * stops in 0.160 s, matching Riot's published counter-strafe measurements.
 *
 * Riot has never published walk/crouch speeds, jump height, gravity or body dimensions. Values
 * marked `est.` are estimates; change them here if you measure better ones in the Range.
 */
export const MOVEMENT: MoveParams = {
  maxAcceleration: 20.48,
  brakingDeceleration: 20.48,
  groundFriction: 2.9,
  brakingFrictionFactor: 2,
  brakeToStop: 0.1,
  airControl: 0.1, // est.
  gravity: 12, // est. (with jumpVelocity gives a ~1.0 m jump apex and ~0.82 s airtime)
  jumpVelocity: 4.9, // est.
};

export const AGENT = {
  /** Half width of the square collision hull (capsule radius). est. */
  radius: 0.36,
  standHeight: 1.85, // est.
  crouchHeight: 1.45, // est.
  /**
   * Camera height. Head centers sit at the same height, so on flat ground a crosshair held at
   * your own eye level is exactly head level, as in VALORANT. est.
   */
  eyeStand: 1.62,
  eyeCrouch: 1.24, // est.
  /** Shift-walk speed as a fraction of the weapon's run speed. est. */
  walkMult: 0.56,
  /** Crouch-walk speed as a fraction of the weapon's run speed. est. */
  crouchMult: 0.4,
  /** Seconds to fully crouch or stand up. est. */
  crouchTime: 0.1,
  maxHealth: 100,
  /** Tagging: getting hit slows you by 72.5% (patch 3.0). Duration is unpublished. est. */
  tagMult: 0.275,
  tagDuration: 0.35,
};

export type ArmorKind = 'none' | 'light' | 'heavy';

/** Light and heavy shields absorb 66% of each hit until 25 / 50 points have been absorbed. */
export const ARMOR: Record<ArmorKind, { capacity: number; absorb: number }> = {
  none: { capacity: 0, absorb: 0 },
  light: { capacity: 25, absorb: 0.66 },
  heavy: { capacity: 50, absorb: 0.66 },
};

export interface Vitals {
  health: number;
  shield: number;
  /** Fraction of each hit the shield absorbs while it has capacity left. */
  absorb: number;
}

export function makeVitals(armor: ArmorKind): Vitals {
  return { health: AGENT.maxHealth, shield: ARMOR[armor].capacity, absorb: ARMOR[armor].absorb };
}

/** Apply one hit. Returns the health actually lost. */
export function applyHit(v: Vitals, damage: number): number {
  const absorbed = Math.min(v.shield, damage * v.absorb);
  v.shield -= absorbed;
  const lost = Math.min(v.health, damage - absorbed);
  v.health -= damage - absorbed;
  if (v.health < 0) v.health = 0;
  return lost;
}

/** Hitbox layout relative to the feet, for an agent facing -Z. Half extents in meters. est. */
export interface HitboxSet {
  head: { y: number; hx: number; hy: number; hz: number; z: number };
  body: { y: number; hx: number; hy: number; hz: number; z: number };
  legs: { y: number; hx: number; hy: number; hz: number; z: number };
}

export const HITBOXES: Record<'stand' | 'crouch', HitboxSet> = {
  stand: {
    head: { y: AGENT.eyeStand, hx: 0.12, hy: 0.135, hz: 0.12, z: 0 },
    body: { y: 1.2, hx: 0.26, hy: 0.28, hz: 0.16, z: 0 },
    legs: { y: 0.46, hx: 0.19, hy: 0.46, hz: 0.13, z: 0 },
  },
  crouch: {
    head: { y: AGENT.eyeCrouch, hx: 0.12, hy: 0.135, hz: 0.12, z: -0.05 },
    body: { y: 0.88, hx: 0.26, hy: 0.21, hz: 0.18, z: 0 },
    legs: { y: 0.335, hx: 0.21, hy: 0.335, hz: 0.24, z: 0.02 },
  },
};
