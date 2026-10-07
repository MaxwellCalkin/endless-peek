/**
 * Procedural first-person animation timelines for knives (and a simple gun inspect).
 * Pure functions of time so they can be unit tested and stepped frame by frame.
 *
 * A pose drives a "wrist" pivot behind the fist:
 *   - `present` blends the hand from its rest orientation to the inspect orientation
 *     (blade upright, flat side facing you),
 *   - `pos` / `rot` are extra offsets in view space (rot: pitch up, yaw left, roll CCW),
 *   - `twist` rolls the knife about its own long axis,
 *   - `tossPos` / `tossRot` move the knife relative to the fist (aerials, twirls),
 *   - `flip` opens (1) or closes (0) the balisong.
 */

export type KnifeAnimKind = 'draw' | 'inspect' | 'swing' | 'heavy' | 'fidget';

export type Vec3T = [number, number, number];

export interface KnifePose {
  /** 0 = closed, 1 = open (balisong only). */
  flip: number;
  present: number;
  twist: number;
  pos: Vec3T;
  rot: Vec3T;
  tossPos: Vec3T;
  tossRot: Vec3T;
  /** Draw a glowing swing trail this frame. */
  trail: boolean;
}

export const KNIFE_ANIM_LENGTH: Record<KnifeAnimKind, number> = {
  draw: 0.75,
  inspect: 3.6,
  swing: 0.42,
  heavy: 0.9,
  fidget: 1.1,
};

export const GUN_INSPECT_LENGTH = 2.4;

const PI = Math.PI;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Normalized progress of `u` through [a, b]. */
function seg(u: number, a: number, b: number): number {
  return clamp01((u - a) / (b - a));
}

function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function easeOut(x: number): number {
  const t = 1 - clamp01(x);
  return 1 - t * t * t;
}

/** Sharp in the middle, like a committed slash. */
function snap(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mix(a: Vec3T, b: Vec3T, t: number): Vec3T {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const ZERO: Vec3T = [0, 0, 0];

export function restPose(): KnifePose {
  return { flip: 1, present: 0, twist: 0, pos: [0, 0, 0], rot: [0, 0, 0], tossPos: [0, 0, 0], tossRot: [0, 0, 0], trail: false };
}

/** Wind-up pose A and follow-through pose B for each hit of the 3-swing combo. */
const SWINGS: { a: { pos: Vec3T; rot: Vec3T }; b: { pos: Vec3T; rot: Vec3T } }[] = [
  // Forehand: right to left.
  { a: { pos: [0.05, 0.03, 0.02], rot: [0.2, -0.55, -0.5] }, b: { pos: [-0.16, -0.04, -0.05], rot: [-0.15, 1.15, -0.2] } },
  // Backhand: left to right.
  { a: { pos: [-0.1, 0.02, 0], rot: [0.15, 0.85, 0.6] }, b: { pos: [0.1, -0.03, -0.04], rot: [-0.1, -0.85, 0.3] } },
  // Downward diagonal.
  { a: { pos: [0.03, 0.08, 0.03], rot: [0.75, -0.2, -0.3] }, b: { pos: [-0.06, -0.09, -0.06], rot: [-0.75, 0.45, -0.1] } },
];

/** Rotation about X by `angle` around a point `cz` along the handle: returns the origin offset. */
function orbitX(angle: number, cz: number): Vec3T {
  return [0, Math.sin(angle) * cz, cz * (1 - Math.cos(angle))];
}

export function knifePose(kind: KnifeAnimKind, u: number, combo = 0): KnifePose {
  const p = restPose();
  switch (kind) {
    case 'draw': {
      const rise = easeOut(seg(u, 0, 0.22));
      p.pos = [0, -0.22 * (1 - rise), 0.05 * (1 - rise)];
      p.rot = [-0.9 * (1 - rise), 0, 0];
      const f = seg(u, 0.12, 0.62);
      p.flip = smooth(f);
      p.twist = Math.sin(PI * f) * 0.7;
      p.rot[0] += Math.sin(PI * f) * 0.15;
      return p;
    }
    case 'inspect': {
      // Present the blade, close it, toss it with a spin (opening mid-air), twirl twice, fan, return.
      p.present = smooth(seg(u, 0, 0.4)) * (1 - smooth(seg(u, 3.15, 3.6)));
      if (u >= 0.4 && u < 0.9) {
        const c = seg(u, 0.4, 0.9);
        p.flip = 1 - smooth(c);
        p.twist = Math.sin(PI * c) * 0.6;
      } else if (u >= 0.9 && u < 1.75) {
        const air = seg(u, 0.9, 1.75);
        p.tossPos = [0, Math.sin(PI * air) * 0.085, -Math.sin(PI * air) * 0.02];
        p.tossRot = [-2 * PI * smooth(air), 0, 0];
        p.flip = smooth(seg(air, 0.3, 0.85));
      } else if (u >= 1.75 && u < 2.6) {
        const spin = 4 * PI * smooth(seg(u, 1.75, 2.6));
        p.tossRot = [spin, 0, 0];
        p.tossPos = orbitX(spin, 0.065);
      } else if (u >= 2.6 && u < 3.2) {
        const fan = seg(u, 2.6, 3.2);
        p.flip = 1 - 0.9 * Math.sin(PI * fan);
        p.twist = Math.sin(2 * PI * fan) * 0.35;
      }
      return p;
    }
    case 'swing': {
      const s = SWINGS[combo % SWINGS.length];
      if (u < 0.08) {
        const w = smooth(seg(u, 0, 0.08));
        p.pos = mix(ZERO, s.a.pos, w);
        p.rot = mix(ZERO, s.a.rot, w);
      } else if (u < 0.22) {
        const t = snap(seg(u, 0.08, 0.22));
        p.pos = mix(s.a.pos, s.b.pos, t);
        p.rot = mix(s.a.rot, s.b.rot, t);
      } else {
        const t = smooth(seg(u, 0.24, 0.42));
        p.pos = mix(s.b.pos, ZERO, t);
        p.rot = mix(s.b.rot, ZERO, t);
      }
      p.trail = u >= 0.07 && u <= 0.26;
      return p;
    }
    case 'heavy': {
      // Pull back, then drive the point straight at the crosshair.
      const back: { pos: Vec3T; rot: Vec3T } = { pos: [0.03, 0.02, 0.07], rot: [0.25, 0.15, -0.2] };
      const thrust: { pos: Vec3T; rot: Vec3T } = { pos: [-0.09, 0.03, -0.2], rot: [-0.62, -0.45, 0.15] };
      if (u < 0.25) {
        const t = smooth(seg(u, 0, 0.25));
        p.pos = mix(ZERO, back.pos, t);
        p.rot = mix(ZERO, back.rot, t);
      } else if (u < 0.55) {
        const t = snap(seg(u, 0.25, 0.36));
        p.pos = mix(back.pos, thrust.pos, t);
        p.rot = mix(back.rot, thrust.rot, t);
      } else {
        const t = smooth(seg(u, 0.55, 0.9));
        p.pos = mix(thrust.pos, ZERO, t);
        p.rot = mix(thrust.rot, ZERO, t);
      }
      p.trail = u >= 0.24 && u <= 0.42;
      return p;
    }
    case 'fidget': {
      const f = seg(u, 0, KNIFE_ANIM_LENGTH.fidget);
      p.flip = 1 - Math.sin(PI * f);
      p.rot = [Math.sin(PI * f) * 0.15, 0, 0];
      p.twist = Math.sin(2 * PI * f) * 0.4;
      return p;
    }
  }
}

/** Generic weapon inspect: show the left side, then the top, then return. Holder offsets. */
export function gunInspectPose(u: number): { pos: Vec3T; rot: Vec3T } {
  const a = smooth(seg(u, 0, 0.45)) * (1 - smooth(seg(u, 1.25, 1.75)));
  const b = smooth(seg(u, 1.25, 1.75)) * (1 - smooth(seg(u, 1.95, GUN_INSPECT_LENGTH)));
  return {
    pos: [-0.07 * a - 0.03 * b, 0.035 * a + 0.02 * b, 0.06 * a + 0.03 * b],
    rot: [0.1 * a + 0.35 * b, 0.85 * a - 0.3 * b, -0.35 * a + 0.35 * b],
  };
}
