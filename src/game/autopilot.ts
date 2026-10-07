import type { Bot } from '../bots/bot';
import type { Action } from '../config/settings';
import { DEG, angleDelta, clamp } from '../core/math';
import { Rng } from '../core/rng';

/**
 * A scripted player for demos and recordings (debug builds only, `?debug`). It walks the
 * hallway's walking line, shift-walking through openings and pre-aiming the common angles it
 * can't see yet. When a bot shows it does what a decent player would: react, counter-strafe to
 * a stop (so the first bullet is accurate), flick to the head and tap.
 */

interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface PilotHost {
  readonly time: number;
  eye(): V3;
  view(): { yaw: number; pitch: number };
  setView(yaw: number, pitch: number): void;
  speed(): number;
  velocity(): { x: number; z: number };
  bots(): readonly Bot[];
  currentSegment(): number;
  clear(a: V3, b: V3): boolean;
  /** Active walking line, oldest segment first. */
  waypoints(): { seg: number; i: number; x: number; z: number }[];
  /** Common angles: head height at every hiding spot nearby, occupied or not (map knowledge). */
  angles(): { key: string; x: number; y: number; z: number }[];
  key(code: string, down: boolean): void;
  readonly binds: Record<Action, string>;
  weapon(): { melee: boolean; ready: boolean; deadzone: number };
}

export interface PilotOptions {
  /** Seconds between a bot appearing and the flick starting. */
  reaction: number;
  /** Exponential aim approach rate (1/s). */
  flickRate: number;
  /** Fire once the crosshair is this close to the head (degrees; looser up close). */
  tolerance: number;
  /** Seconds between taps. */
  tapInterval: number;
  /** Walk (silent) everywhere instead of only through openings. */
  walk: boolean;
  /** Never stop for fights and react slowly: for showing what a bad peek costs. */
  careless: boolean;
  /** Seed for the pilot's own randomness, so a recording can be replayed exactly. */
  seed: number;
}

export const DEFAULT_PILOT: PilotOptions = {
  reaction: 0.19,
  flickRate: 16,
  tolerance: 0.45,
  tapInterval: 0.24,
  walk: false,
  careless: false,
  seed: 7,
};

/** Pure-pursuit look-ahead along the walking line (m). */
const LOOK_AHEAD = 1.7;
/** Half the horizontal FOV, less a margin: the pilot only reacts to what is on screen. */
const SIGHT = 48 * DEG;

export class Autopilot {
  private target: Bot | null = null;
  private reactAt = 0;
  private nextShot = 0;
  private wp: { seg: number; i: number } = { seg: -1, i: 0 };
  private held = new Set<string>();
  private pulse: string[] = [];
  private stuckFor = 0;
  private strafe: { side: number; until: number } | null = null;
  /** Angles already checked (seen on screen, or left behind). */
  private cleared = new Set<string>();
  private aimJitter = { yaw: 0, pitch: 0 };
  private swings = 0;
  private rng: Rng;

  constructor(
    private host: PilotHost,
    public options: PilotOptions = DEFAULT_PILOT,
  ) {
    this.rng = new Rng(options.seed);
  }

  private hold(code: string, down: boolean): void {
    if (down === this.held.has(code)) return;
    this.host.key(code, down);
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  /** Press for exactly one tick. */
  private tap(code: string): void {
    this.host.key(code, true);
    this.pulse.push(code);
  }

  /** Introspection for debugging recordings. */
  debugState(): { wp: { seg: number; i: number }; target: number | null } {
    return { wp: { ...this.wp }, target: this.target?.id ?? null };
  }

  release(): void {
    for (const c of [...this.held]) this.hold(c, false);
    for (const c of this.pulse) this.host.key(c, false);
    this.pulse = [];
  }

  private visible(bot: Bot, eye: V3): boolean {
    const head = bot.headCenter();
    const body = bot.boxCenter('body');
    return this.host.clear(eye, head) || this.host.clear(eye, body);
  }

  private pickTarget(eye: V3): Bot | null {
    const cur = this.host.currentSegment();
    const { yaw } = this.host.view();
    let best: Bot | null = null;
    let bestScore = Infinity;
    for (const bot of this.host.bots()) {
      if (!bot.alive || bot.segment > cur + 1 || bot.segment < cur - 1) continue;
      const head = bot.headCenter();
      const off = Math.abs(angleDelta(yaw, Math.atan2(-(head.x - eye.x), -(head.z - eye.z))));
      // Off-screen bots only count once they shoot: you hear it and see the damage indicator.
      const heard = this.host.time - bot.firedAt < 1.5;
      if (off > SIGHT && bot !== this.target && !heard) continue;
      if (!this.visible(bot, eye)) continue;
      const score = off + Math.hypot(head.x - eye.x, head.z - eye.z) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = bot;
      }
    }
    return best;
  }

  tick(dt: number): void {
    for (const c of this.pulse) this.host.key(c, false);
    this.pulse = [];
    const h = this.host;
    const now = h.time;
    const eye = h.eye();
    const weapon = h.weapon();

    const next = this.pickTarget(eye);
    if (next !== this.target) {
      this.target = next;
      if (next) {
        const head = next.headCenter();
        const off = Math.abs(angleDelta(h.view().yaw, Math.atan2(-(head.x - eye.x), -(head.z - eye.z))));
        // Turning to a sound takes longer than reacting to something already on screen.
        const r = this.options.reaction + (off > SIGHT ? 0.12 : 0);
        this.reactAt = now + r * (0.85 + this.rng.next() * 0.3);
        this.aimJitter = { yaw: (this.rng.next() - 0.5) * 0.6 * DEG, pitch: (this.rng.next() - 0.5) * 0.4 * DEG };
      }
    }

    if (this.target) {
      this.fight(this.target, eye, dt, now, weapon);
      return;
    }
    this.walkPath(eye, dt, now);
  }

  private fight(bot: Bot, eye: V3, dt: number, now: number, weapon: ReturnType<PilotHost['weapon']>): void {
    const h = this.host;
    const b = h.binds;
    const aimAt = weapon.melee ? bot.boxCenter('body') : bot.headCenter();
    const dx = aimAt.x - eye.x;
    const dz = aimAt.z - eye.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + this.aimJitter.yaw * clamp(1 - (now - this.reactAt) / 0.25, 0, 1);
    const wantPitch = Math.atan2(aimAt.y - eye.y, dist) + this.aimJitter.pitch * clamp(1 - (now - this.reactAt) / 0.25, 0, 1);

    if (weapon.melee) {
      // Close the distance, then slash (opening with a heavy stab).
      for (const a of ['back', 'left', 'right', 'walk'] as const) this.hold(b[a], false);
      this.hold(b.forward, dist > 1.5);
    } else if (!this.options.careless) {
      // Counter-strafe to a stop so the first bullet lands inside first-shot spread.
      this.counterStrafe();
    }

    if (now < this.reactAt) return;
    const { yaw, pitch } = h.view();
    const k = 1 - Math.exp(-dt * this.options.flickRate);
    const ny = yaw + angleDelta(yaw, wantYaw) * k;
    const np = pitch + (wantPitch - pitch) * k;
    h.setView(ny, np);
    const err = Math.hypot(angleDelta(ny, wantYaw), np - wantPitch) / DEG;
    if (!weapon.ready || now < this.nextShot) return;
    if (weapon.melee) {
      if (dist <= 1.7 && err < 12) {
        this.tap(this.swings++ === 0 ? b.alt : b.fire);
        this.nextShot = now + (this.swings === 1 ? 0.95 : 0.47);
      }
      return;
    }
    // Close up the head is big: settle for being well inside it rather than dead center.
    const tolerance = Math.max(this.options.tolerance, Math.atan2(0.06, dist) / DEG);
    if (err <= tolerance && (this.options.careless || h.speed() <= weapon.deadzone)) {
      this.tap(b.fire);
      this.nextShot = now + this.options.tapInterval * (0.9 + this.rng.next() * 0.25);
    }
  }

  /** Tap the keys opposite to the current velocity until stopped (what players do to shoot). */
  private counterStrafe(): void {
    const h = this.host;
    const b = h.binds;
    const v = h.velocity();
    const { yaw } = h.view();
    const vf = -Math.sin(yaw) * v.x - Math.cos(yaw) * v.z;
    const vr = Math.cos(yaw) * v.x - Math.sin(yaw) * v.z;
    this.hold(b.walk, false);
    this.hold(b.back, vf > 0.6);
    this.hold(b.forward, vf < -0.6);
    this.hold(b.left, vr > 0.6);
    this.hold(b.right, vr < -0.6);
  }

  private walkPath(eye: V3, dt: number, now: number): void {
    const h = this.host;
    const b = h.binds;
    const list = h.waypoints();
    if (list.length < 2) return;
    // Pure pursuit: find where we are on the walking line (never going back), then steer at a
    // point a little further along it. Chasing waypoints directly makes a body with momentum
    // orbit any point that falls inside its turning circle.
    let k = list.findIndex((p) => p.seg > this.wp.seg || (p.seg === this.wp.seg && p.i >= this.wp.i));
    if (k < 0) k = list.length - 2;
    k = Math.min(k, list.length - 2);
    let best = { d: Infinity, edge: k, x: list[k].x, z: list[k].z };
    for (let j = k; j < Math.min(list.length - 1, k + 4); j++) {
      const a = list[j];
      const c = list[j + 1];
      const ex = c.x - a.x;
      const ez = c.z - a.z;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((eye.x - a.x) * ex + (eye.z - a.z) * ez) / len2)) : 0;
      const qx = a.x + ex * t;
      const qz = a.z + ez * t;
      const d = Math.hypot(eye.x - qx, eye.z - qz);
      if (d <= best.d + 0.05) best = { d, edge: j, x: qx, z: qz };
    }
    this.wp = { seg: list[best.edge].seg, i: list[best.edge].i };
    let left = LOOK_AHEAD;
    let tx = best.x;
    let tz = best.z;
    for (let j = best.edge; j < list.length - 1 && left > 0; j++) {
      const c = list[j + 1];
      const d = Math.hypot(c.x - tx, c.z - tz);
      if (d >= left) {
        tx += ((c.x - tx) / d) * left;
        tz += ((c.z - tz) / d) * left;
        left = 0;
      } else {
        left -= d;
        tx = c.x;
        tz = c.z;
      }
    }

    // Peek wisely: shift-walk (silent) through openings, run the stretches in between.
    const seg = list[best.edge].seg;
    let toExit = Math.hypot(list[best.edge + 1].x - best.x, list[best.edge + 1].z - best.z);
    for (let j = best.edge + 1; j + 1 < list.length && list[j + 1].seg === seg; j++) {
      toExit += Math.hypot(list[j + 1].x - list[j].x, list[j + 1].z - list[j].z);
    }
    let fromEntry = Math.hypot(best.x - list[best.edge].x, best.z - list[best.edge].z);
    for (let j = best.edge; j > 0 && list[j - 1].seg === seg; j--) {
      fromEntry += Math.hypot(list[j].x - list[j - 1].x, list[j].z - list[j - 1].z);
    }
    const nearOpening = !this.options.careless && (toExit < 5 || fromEntry < 3);

    const { yaw, pitch } = h.view();
    const heading = Math.atan2(-(tx - eye.x), -(tz - eye.z));
    let moveYaw = heading;
    // Unstick: sidestep for a moment if something is in the way.
    if (this.strafe && now < this.strafe.until) moveYaw += (this.strafe.side * Math.PI) / 2;
    else this.strafe = null;

    // Crosshair placement: pre-aim the closest angle not cleared yet, else look down the line.
    const angle = this.options.careless ? null : this.pickAngle(eye, heading, yaw);
    let lookYaw = heading;
    let lookPitch = 0;
    if (angle) {
      lookYaw = Math.atan2(-(angle.x - eye.x), -(angle.z - eye.z));
      lookPitch = Math.atan2(angle.y - eye.y, Math.hypot(angle.x - eye.x, angle.z - eye.z));
    }
    const ease = 1 - Math.exp(-dt * 7);
    const maxStep = 320 * DEG * dt;
    const dYaw = clamp(angleDelta(yaw, lookYaw) * ease, -maxStep, maxStep);
    h.setView(yaw + dYaw, pitch + clamp((lookPitch - pitch) * ease, -maxStep, maxStep));

    // Move along the line whatever we're looking at: WASD relative to the view.
    const rel = angleDelta(yaw + dYaw, moveYaw);
    const c = Math.cos(rel);
    const side = Math.sin(rel);
    this.hold(b.forward, c > 0.38);
    this.hold(b.back, c < -0.38);
    this.hold(b.left, side > 0.38);
    this.hold(b.right, side < -0.38);
    this.hold(b.walk, this.options.walk || nearOpening);

    if (this.strafe) return;
    this.stuckFor = h.speed() < 0.4 ? this.stuckFor + dt : 0;
    if (this.stuckFor > 0.5) {
      this.strafe = { side: this.rng.next() < 0.5 ? 1 : -1, until: now + 0.35 };
      this.stuckFor = 0;
    }
  }

  /** The next angle to hold: exposed ones first (visible but off screen), then the closest. */
  private pickAngle(eye: V3, heading: number, viewYaw: number): V3 | null {
    let best: V3 | null = null;
    let bestScore = Infinity;
    for (const a of this.host.angles()) {
      if (this.cleared.has(a.key)) continue;
      const dx = a.x - eye.x;
      const dz = a.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 28) continue;
      const yawTo = Math.atan2(-dx, -dz);
      const off = Math.abs(angleDelta(heading, yawTo));
      if (off > 100 * DEG && d > 2) {
        this.cleared.add(a.key); // Walked past it.
        continue;
      }
      const visible = this.host.clear(eye, a);
      if (visible && Math.abs(angleDelta(viewYaw, yawTo)) < SIGHT * 0.8) {
        this.cleared.add(a.key); // On screen and nobody there.
        continue;
      }
      if (off > 75 * DEG) continue;
      const score = d - (visible ? 12 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }
}
