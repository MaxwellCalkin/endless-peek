import { type ArmorKind, HITBOXES, type Vitals, applyHit, makeVitals } from '../config/agent';
import type { HitRegion } from '../config/weapons';
import { angleDelta, clamp } from '../core/math';
import { type Ray, rayYawBox } from '../physics/aabb';
import type { SpotTag, Stance } from '../world/layout';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BotState = 'holding' | 'reacting' | 'engaging' | 'searching' | 'dead';

/** How a bot plays. All times in seconds, angles in degrees. */
export interface BotProfile {
  label: string;
  /** Mean and standard deviation of the first-sight reaction time. */
  reaction: [mean: number, sd: number];
  /** Reaction multiplier when the bot already knows you're there (heard you, or you re-peek). */
  alertReactionMult: number;
  /** Standard deviation of first-shot aim error. */
  aimError: number;
  /** Extra aim error per m/s of your sideways speed. */
  movingPenalty: number;
  /** Extra error per bullet into a burst. */
  sprayPenalty: number;
  headChance: number;
  burst: [min: number, max: number];
  burstPause: [min: number, max: number];
  /** Horizontal field of view while holding an angle. */
  fov: number;
  /** Seconds the bot keeps its crosshair where it last saw you. */
  memory: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'pro' | 'radiant';

export const DIFFICULTIES: Record<Difficulty, BotProfile> = {
  easy: {
    label: 'Easy',
    reaction: [0.52, 0.08],
    alertReactionMult: 0.75,
    aimError: 1.5,
    movingPenalty: 0.35,
    sprayPenalty: 0.45,
    headChance: 0.2,
    burst: [1, 3],
    burstPause: [0.45, 0.8],
    fov: 100,
    memory: 2.0,
  },
  normal: {
    label: 'Normal',
    reaction: [0.38, 0.06],
    alertReactionMult: 0.7,
    aimError: 0.95,
    movingPenalty: 0.28,
    sprayPenalty: 0.35,
    headChance: 0.35,
    burst: [1, 3],
    burstPause: [0.3, 0.6],
    fov: 110,
    memory: 2.5,
  },
  hard: {
    label: 'Hard',
    reaction: [0.29, 0.045],
    alertReactionMult: 0.65,
    aimError: 0.6,
    movingPenalty: 0.22,
    sprayPenalty: 0.28,
    headChance: 0.5,
    burst: [1, 3],
    burstPause: [0.25, 0.45],
    fov: 115,
    memory: 3.0,
  },
  pro: {
    label: 'Pro',
    reaction: [0.22, 0.035],
    alertReactionMult: 0.6,
    aimError: 0.4,
    movingPenalty: 0.16,
    sprayPenalty: 0.22,
    headChance: 0.65,
    burst: [1, 2],
    burstPause: [0.2, 0.35],
    fov: 120,
    memory: 3.0,
  },
  radiant: {
    label: 'Radiant',
    reaction: [0.17, 0.025],
    alertReactionMult: 0.55,
    aimError: 0.25,
    movingPenalty: 0.12,
    sprayPenalty: 0.18,
    headChance: 0.8,
    burst: [1, 2],
    burstPause: [0.18, 0.3],
    fov: 125,
    memory: 3.5,
  },
};

export interface BotSenses {
  now: number;
  /** World-space sample points on the player (head first) used for sight checks. */
  playerPoints: Vec3[];
  playerHead: Vec3;
  playerChest: Vec3;
  playerVel: Vec3;
  playerAlive: boolean;
  /** True when nothing solid sits between the two points. */
  clear: (a: Vec3, b: Vec3) => boolean;
  rand: () => number;
  normal: (mean: number, sd: number) => number;
}

export interface BotShot {
  from: Vec3;
  dir: Vec3;
}

let nextId = 1;

export class Bot {
  readonly id = nextId++;
  state: BotState = 'holding';
  readonly vitals: Vitals;
  /** Body facing (yaw). Turns toward the player while engaging. */
  yaw: number;
  readonly holdYaw: number;
  aimPitch = 0;
  diedAt = -Infinity;
  /** Last time the bot took damage. */
  hurtAt = -Infinity;
  lastHitRegion: HitRegion | null = null;

  private reactAt = 0;
  private lastSeen = -Infinity;
  private lastSeenPos: Vec3 | null = null;
  private alertUntil = -Infinity;
  private seenEver = false;
  private nextShot = 0;
  private burstLeft = 0;
  private burstIndex = 0;
  private aimHead = true;
  /** Reaction time actually used for the current engagement (for death recaps). */
  reactionUsed = 0;
  /** When the bot first saw the player in the current engagement. */
  sawPlayerAt = -Infinity;

  // Player-side bookkeeping for stats.
  playerSawAt: number | null = null;
  placementError: number | null = null;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    yaw: number,
    readonly stance: Stance,
    readonly tag: SpotTag,
    readonly segment: number,
    readonly profile: BotProfile,
    readonly fireInterval: number,
    armor: ArmorKind,
  ) {
    this.yaw = yaw;
    this.holdYaw = yaw;
    this.vitals = makeVitals(armor);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get engaged(): boolean {
    return this.state === 'engaging';
  }

  eye(): Vec3 {
    const hb = HITBOXES[this.stance].head;
    return { x: this.x, y: this.y + hb.y, z: this.z };
  }

  /** Head center in world space (accounts for the forward offset of a crouched head). */
  headCenter(): Vec3 {
    return this.boxCenter('head');
  }

  boxCenter(region: 'head' | 'body' | 'legs'): Vec3 {
    const b = HITBOXES[this.stance][region];
    // A local +z offset (backward) rotated by yaw.
    return { x: this.x + Math.sin(this.yaw) * b.z, y: this.y + b.y, z: this.z + Math.cos(this.yaw) * b.z };
  }

  /** Sample points the player can see this bot by (head first). */
  visibilityPoints(): Vec3[] {
    const head = this.headCenter();
    const body = this.boxCenter('body');
    const hb = HITBOXES[this.stance].body;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const legs = this.boxCenter('legs');
    return [
      head,
      body,
      { x: body.x + rx * hb.hx * 0.85, y: body.y + hb.hy * 0.5, z: body.z + rz * hb.hx * 0.85 },
      { x: body.x - rx * hb.hx * 0.85, y: body.y + hb.hy * 0.5, z: body.z - rz * hb.hx * 0.85 },
      legs,
    ];
  }

  /** Nearest hitbox the ray enters, if any. */
  raycast(ray: Ray, tMax: number): { t: number; region: HitRegion } | null {
    if (!this.alive) return null;
    const set = HITBOXES[this.stance];
    let best: { t: number; region: HitRegion } | null = null;
    const regions: [keyof typeof set, HitRegion][] = [
      ['head', 'head'],
      ['body', 'body'],
      ['legs', 'leg'],
    ];
    for (const [key, region] of regions) {
      const b = set[key];
      const c = this.boxCenter(key);
      const t = rayYawBox(ray, c.x, c.y, c.z, b.hx, b.hy, b.hz, this.yaw, best ? best.t : tMax);
      if (t < (best ? best.t : tMax)) best = { t, region };
    }
    return best;
  }

  /** Apply one hit (shields absorb their share). Returns true when it killed the bot. */
  damage(amount: number, region: HitRegion, now: number): boolean {
    if (!this.alive) return false;
    applyHit(this.vitals, amount);
    this.hurtAt = now;
    this.lastHitRegion = region;
    if (this.vitals.health <= 0) {
      this.state = 'dead';
      this.diedAt = now;
      return true;
    }
    // Getting shot gives your position away.
    this.alertUntil = Math.max(this.alertUntil, now + 4);
    return false;
  }

  /** Hearing: footsteps, gunfire. */
  hear(now: number, pos: Vec3, loudness: number): void {
    if (!this.alive) return;
    const d = Math.hypot(pos.x - this.x, pos.y - this.y, pos.z - this.z);
    if (d <= loudness) this.alertUntil = Math.max(this.alertUntil, now + 4);
  }

  get alerted(): boolean {
    return this.lastSeenPos !== null;
  }

  private sees(s: BotSenses): boolean {
    if (!s.playerAlive) return false;
    const eye = this.eye();
    const alert = s.now < this.alertUntil;
    const tracking = this.state === 'engaging' || this.state === 'reacting';
    const halfFov = ((alert || tracking ? 200 : this.profile.fov) * Math.PI) / 360;
    for (const p of s.playerPoints) {
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 70) continue;
      const yawTo = Math.atan2(-dx, -dz);
      if (Math.abs(angleDelta(this.yaw, yawTo)) > halfFov) continue;
      if (s.clear(eye, p)) return true;
    }
    return false;
  }

  update(dt: number, s: BotSenses): BotShot[] {
    const shots: BotShot[] = [];
    if (!this.alive) return shots;
    const now = s.now;
    const visible = this.sees(s);

    if (visible) {
      this.lastSeen = now;
      this.lastSeenPos = { ...s.playerHead };
      if (this.state === 'holding' || this.state === 'searching') {
        const remembered = this.state === 'searching' || now < this.alertUntil;
        let reaction = clamp(s.normal(this.profile.reaction[0], this.profile.reaction[1]), this.profile.reaction[0] * 0.6, this.profile.reaction[0] * 2);
        if (remembered) reaction *= this.profile.alertReactionMult;
        // Turning to face someone outside the crosshair costs time (~600 deg/s flick).
        const yawTo = Math.atan2(-(s.playerHead.x - this.x), -(s.playerHead.z - this.z));
        const off = Math.abs(angleDelta(this.yaw, yawTo)) * (180 / Math.PI);
        reaction += Math.max(0, off - 8) / 600;
        this.reactionUsed = reaction;
        this.sawPlayerAt = now;
        this.reactAt = now + reaction;
        this.state = 'reacting';
        this.seenEver = true;
      }
      if (this.state === 'reacting' && now >= this.reactAt) {
        this.state = 'engaging';
        this.burstLeft = this.pickBurst(s);
        this.burstIndex = 0;
        this.nextShot = now;
        this.aimHead = s.rand() < this.profile.headChance;
      }
    } else if (this.state === 'reacting' || this.state === 'engaging') {
      // You got out of sight before (or while) it shot: it keeps the angle pre-aimed.
      this.state = 'searching';
    } else if (this.state === 'searching' && now - this.lastSeen > this.profile.memory) {
      this.state = 'holding';
    }

    // Turn the body: toward the target when engaging, back toward the held angle otherwise.
    let targetYaw = this.holdYaw;
    if ((this.state === 'engaging' || this.state === 'reacting' || this.state === 'searching') && this.lastSeenPos) {
      targetYaw = Math.atan2(-(this.lastSeenPos.x - this.x), -(this.lastSeenPos.z - this.z));
      const dy = this.lastSeenPos.y - this.eye().y;
      this.aimPitch = Math.atan2(dy, Math.hypot(this.lastSeenPos.x - this.x, this.lastSeenPos.z - this.z));
    } else {
      this.aimPitch *= Math.max(0, 1 - dt * 4);
    }
    const turnRate = (this.state === 'holding' ? 3 : 14) * dt;
    this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, turnRate);

    if (this.state === 'engaging' && visible && now >= this.nextShot) {
      shots.push(this.fire(s));
      this.burstIndex++;
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstLeft = this.pickBurst(s);
        this.burstIndex = 0;
        this.aimHead = s.rand() < this.profile.headChance;
        this.nextShot = now + this.fireInterval + this.profile.burstPause[0] + s.rand() * (this.profile.burstPause[1] - this.profile.burstPause[0]);
      } else {
        this.nextShot = now + this.fireInterval;
      }
    }
    return shots;
  }

  private pickBurst(s: BotSenses): number {
    const [lo, hi] = this.profile.burst;
    return lo + Math.floor(s.rand() * (hi - lo + 1));
  }

  private fire(s: BotSenses): BotShot {
    const from = this.eye();
    const target = this.aimHead ? s.playerHead : s.playerChest;
    let dx = target.x - from.x;
    let dy = target.y - from.y;
    let dz = target.z - from.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    dx /= dist;
    dy /= dist;
    dz /= dist;
    // Sideways speed of the target relative to the line of fire makes it harder to hit.
    const vx = s.playerVel.x;
    const vz = s.playerVel.z;
    const along = vx * dx + vz * dz;
    const lateral = Math.hypot(vx - along * dx, vz - along * dz);
    const sigma = this.profile.aimError + this.profile.movingPenalty * lateral + this.profile.sprayPenalty * this.burstIndex;
    const err = (Math.abs(s.normal(0, sigma)) * Math.PI) / 180;
    const phi = s.rand() * Math.PI * 2;
    // Perturb within a cone around the aim direction.
    const upX = 0;
    const upY = 1;
    const upZ = 0;
    let rx = dy * upZ - dz * upY;
    let ry = dz * upX - dx * upZ;
    let rz = dx * upY - dy * upX;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = ry * dz - rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy - ry * dx;
    const t = Math.tan(err);
    const ox = Math.cos(phi) * t;
    const oy = Math.sin(phi) * t;
    const fx = dx + rx * ox + ux * oy;
    const fy = dy + ry * ox + uy * oy;
    const fz = dz + rz * ox + uz * oy;
    const fl = Math.hypot(fx, fy, fz);
    return { from, dir: { x: fx / fl, y: fy / fl, z: fz / fl } };
  }

  /** For the death recap: how long the bot had you before its first shot. */
  get hadSeen(): boolean {
    return this.seenEver;
  }
}
