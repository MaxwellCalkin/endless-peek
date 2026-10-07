import {
  CROUCH_STILL_YAW_MULT,
  type MoveError,
  type WeaponDef,
} from '../config/weapons';

/** Landing inaccuracy applied to every gun (patch 1.09). */
export const LANDING_ERROR = 7.0;
export const LANDING_DURATION = 0.225;
/** Seconds to blend the camera into or out of ADS / scope. Est. */
export const ZOOM_TIME = 0.14;
const RECOVERY_SLACK = 0.03;

export interface GunInput {
  fireHeld: boolean;
  firePressed: boolean;
  altHeld: boolean;
  altPressed: boolean;
  reloadPressed: boolean;
}

export interface MoveSample {
  /** Horizontal speed in m/s. */
  speed: number;
  airborne: boolean;
  crouched: boolean;
  /** Seconds since the player last landed (Infinity if never). */
  sinceLanding: number;
  /** Walk speed for this weapon, used to shape the error ramp. */
  walkSpeed: number;
  crouchSpeed: number;
}

export interface ShotEvent {
  kind: 'bullet' | 'melee';
  /** Camera recoil (degrees) at the instant the shot left, before its own kick. */
  recoilPitch: number;
  recoilYaw: number;
  pellets: number;
  /** Error cone half-angle in degrees. */
  spread: number;
  /** Moving shots spread uniformly; standing shots are center biased. */
  uniform: boolean;
  zoomed: boolean;
  /** Melee: true for the heavy alt stab. */
  heavy?: boolean;
}

export type GunState = 'equipping' | 'ready' | 'reloading';

export interface GunOptions {
  adsHold: boolean;
  scopeHold: boolean;
  random?: () => number;
}

/** Movement error for a weapon given how fast you're moving. Ramps with actual speed. */
export function movementError(def: WeaponDef, err: MoveError, m: MoveSample, sinceLanding: number): number {
  if (m.airborne) return err.air;
  let e = 0;
  const threshold = def.deadzone * def.runSpeed;
  if (m.speed > threshold) {
    if (m.crouched) {
      e = err.crouchWalk * Math.min(1, (m.speed - threshold) / Math.max(0.01, m.crouchSpeed - threshold));
    } else if (m.speed <= m.walkSpeed) {
      e = err.walk * Math.min(1, (m.speed - threshold) / Math.max(0.01, m.walkSpeed - threshold));
    } else {
      const t = Math.min(1, (m.speed - m.walkSpeed) / Math.max(0.01, def.runSpeed - m.walkSpeed));
      e = err.walk + (err.run - err.walk) * t;
    }
  }
  if (sinceLanding < LANDING_DURATION) e += LANDING_ERROR;
  return e;
}

function ease(s: number): number {
  const x = Math.min(1, Math.max(0, s));
  return x * x * (3 - 2 * x);
}

/**
 * One weapon's runtime state: ammo, cadence, spread heat and camera recoil.
 * Pure logic so it can be unit tested; the game turns ShotEvents into raycasts.
 */
export class Gun {
  ammo: number;
  reserve: number;
  state: GunState = 'equipping';
  stateTimer: number;
  /** Zoom level index: 0 = hip, 1.. = alt zoom levels. */
  zoomLevel = 0;
  /** 0..1 blend of the current zoom transition, used by the camera. */
  zoomBlend = 0;

  /** Accumulated vertical / horizontal camera kick in degrees (positive pitch = up). */
  recoilPitch = 0;
  recoilYaw = 0;

  private heat = 0;
  private heatAtShot = 0;
  private pitchAtShot = 0;
  private yawAtShot = 0;
  private lastShot = -Infinity;
  private nextShot = 0;
  private yawDir: 1 | -1 = 1;
  private yawFrom = 1;
  private yawSwitchStart = -Infinity;
  private burstLeft = 0;
  private burstNext = 0;
  private burstCooldownUntil = 0;
  private firingSince = -Infinity;
  private reloadAmount = 0;
  private rand: () => number;
  /** Shots fired since equip; for stats. */
  shotsFired = 0;

  constructor(
    readonly def: WeaponDef,
    public options: GunOptions,
  ) {
    this.ammo = def.magazine;
    this.reserve = def.reserve;
    this.stateTimer = def.equip;
    this.rand = options.random ?? Math.random;
  }

  get isMelee(): boolean {
    return this.def.category === 'melee';
  }

  get zoomed(): boolean {
    return this.zoomLevel > 0;
  }

  /** Magnification currently targeted (1 = none). */
  get zoom(): number {
    const alt = this.def.alt;
    if (!alt || this.zoomLevel === 0 || alt.kind === 'shotgun') return 1;
    return alt.zoom[Math.min(this.zoomLevel, alt.zoom.length) - 1];
  }

  get usesScopeOverlay(): boolean {
    return this.def.alt?.kind === 'scope' && this.zoomed;
  }

  get canZoom(): boolean {
    const k = this.def.alt?.kind;
    return k === 'ads' || k === 'scope' || k === 'burst';
  }

  /** Movement speed multiplier from zoom. */
  get moveMult(): number {
    return this.zoomed && this.def.alt ? this.def.alt.moveMult : 1;
  }

  /** Called when the weapon is drawn. */
  equip(fast = false): void {
    this.state = 'equipping';
    this.stateTimer = fast ? this.def.equip * 0.6 : this.def.equip;
    this.zoomLevel = 0;
    this.burstLeft = 0;
  }

  holster(): void {
    this.zoomLevel = 0;
    this.burstLeft = 0;
  }

  refill(): void {
    this.ammo = this.def.magazine;
    this.reserve = this.def.reserve;
  }

  /** Remaining reload/equip progress 0..1 (1 = done), for the HUD. */
  get stateProgress(): number {
    if (this.state === 'ready') return 1;
    const total = this.state === 'equipping' ? this.def.equip : this.reloadDuration();
    return 1 - Math.max(0, this.stateTimer) / Math.max(0.001, total);
  }

  private reloadDuration(): number {
    const missing = this.def.magazine - this.ammo;
    if (this.def.partialReload !== undefined && missing <= 1) return this.def.partialReload;
    return this.def.reload;
  }

  private interval(now: number): number {
    const def = this.def;
    const alt = def.alt;
    if (this.zoomed && alt && (alt.kind === 'ads' || alt.kind === 'scope')) return 1 / alt.fireRate;
    if (def.fireRateRamp && !(this.zoomed && alt)) {
      const r = def.fireRateRamp;
      const t = Math.min(1, Math.max(0, now - this.firingSince) / r.time);
      return 1 / (r.from + (r.to - r.from) * t);
    }
    return 1 / def.fireRate;
  }

  /**
   * Seconds since recovery began. Recovery starts one shot interval (plus a little slack for
   * frame timing) after the last shot, so a held trigger never recovers between bullets.
   */
  private recoveringFor(now: number): number {
    return now - this.lastShot - this.interval(now) - RECOVERY_SLACK;
  }

  /** Heat (shots of build-up) after recovery. */
  currentHeat(now: number): number {
    const since = this.recoveringFor(now);
    if (since <= 0) return this.heat;
    const rec = this.recoveryTime();
    return rec <= 0 ? 0 : this.heatAtShot * Math.max(0, 1 - since / rec);
  }

  private recoveryTime(): number {
    const alt = this.def.alt;
    if (this.zoomed && alt?.recovery !== undefined) return alt.recovery;
    return this.def.recovery;
  }

  private usingAltProfile(): boolean {
    const k = this.def.alt?.kind;
    return this.zoomed && (k === 'ads' || k === 'scope' || k === 'burst');
  }

  /** Error cone (degrees) a shot fired now would have. */
  spreadNow(now: number, m: MoveSample, shotgunAlt = false): number {
    const def = this.def;
    const alt = def.alt;
    const useAlt = shotgunAlt || this.usingAltProfile();
    const [first, max] = useAlt && alt ? alt.spread : def.spread;
    const t = Math.min(1, this.currentHeat(now) / Math.max(1, def.tapEfficiency));
    let e = first + (max - first) * t;
    if (m.crouched && !m.airborne) e *= useAlt && alt?.crouchMult !== undefined ? alt.crouchMult : def.crouchMult;
    const err = useAlt && alt?.moveError ? alt.moveError : def.moveError;
    return e + movementError(def, err, m, m.sinceLanding);
  }

  /** Error split the way the crosshair shows it: resting error, firing build-up, movement. */
  errorBreakdown(now: number, m: MoveSample): { base: number; firing: number; movement: number } {
    const def = this.def;
    const alt = def.alt;
    const useAlt = this.usingAltProfile();
    const [first, max] = useAlt && alt ? alt.spread : def.spread;
    const crouch = m.crouched && !m.airborne ? (useAlt && alt?.crouchMult !== undefined ? alt.crouchMult : def.crouchMult) : 1;
    const t = Math.min(1, this.currentHeat(now) / Math.max(1, def.tapEfficiency));
    const base = first * crouch;
    const firing = (max - first) * t * crouch;
    const err = useAlt && alt?.moveError ? alt.moveError : def.moveError;
    return { base, firing: Math.max(0, firing), movement: movementError(def, err, m, m.sinceLanding) };
  }

  /** Seconds a reload started now would take. */
  get reloadTime(): number {
    return this.reloadDuration();
  }

  /** Is the shooter moving fast enough that shots are spread uniformly and recoil is boosted? */
  private moving(m: MoveSample): boolean {
    return m.airborne || m.speed > this.def.deadzone * this.def.runSpeed;
  }

  /** Recoil the camera should show now (recovering when not firing). */
  private updateRecoil(now: number): void {
    const since = this.recoveringFor(now);
    if (since <= 0) return;
    const rec = Math.max(0.05, this.recoveryTime());
    const k = 1 - ease(since / rec);
    this.recoilPitch = this.pitchAtShot * k;
    this.recoilYaw = this.yawAtShot * k;
  }

  /** Apply the camera kick for a shot fired with `heat` shots of build-up. */
  private kick(now: number, m: MoveSample, heat: number): void {
    const r = this.def.recoil;
    const i = Math.floor(heat + 0.05);
    if (heat < 0.5) {
      // Fresh spray: pick the side the horizontal recoil leans to.
      this.yawDir = this.rand() < 0.5 ? -1 : 1;
      this.yawFrom = this.yawDir;
      this.yawSwitchStart = -Infinity;
    }
    const pitchMult = this.moving(m) ? this.def.runningRecoilMult : 1;
    const pitch = r.pitch[Math.min(i, r.pitch.length - 1)] * pitchMult;
    this.recoilPitch = Math.min(r.maxPitch * pitchMult, this.recoilPitch + pitch);

    if (i >= r.protectedBullets && this.rand() < r.yawSwitchChance) this.switchYaw(now);
    if (Math.abs(this.recoilYaw) >= r.maxYaw && Math.sign(this.recoilYaw) === this.yawDir) this.switchYaw(now);
    const blend = r.yawSwitchTime > 0 ? Math.min(1, (now - this.yawSwitchStart) / r.yawSwitchTime) : 1;
    const dir = this.yawFrom + (this.yawDir - this.yawFrom) * blend;
    // Horizontal drift is small during the climb and grows once it tops out.
    const climbDone = i >= r.pitch.length - 2 || this.recoilPitch >= r.maxPitch * pitchMult - 1e-6;
    const ramp = climbDone ? 1 : Math.min(1, 0.15 + i / Math.max(1, r.pitch.length));
    const crouchMult = m.crouched && m.speed < 0.05 && this.def.category === 'rifle' ? CROUCH_STILL_YAW_MULT : 1;
    this.recoilYaw = Math.max(-r.maxYaw, Math.min(r.maxYaw, this.recoilYaw + r.yaw * ramp * dir * crouchMult));
  }

  private switchYaw(now: number): void {
    this.yawFrom = this.yawDir;
    this.yawDir = this.yawDir === 1 ? -1 : 1;
    this.yawSwitchStart = now;
  }

  private shoot(now: number, m: MoveSample, out: ShotEvent[], shotgunAlt: boolean): void {
    const def = this.def;
    // Heat and camera recoil as they stand right before this shot.
    const heat = this.currentHeat(now);
    this.updateRecoil(now);
    if (now - this.lastShot > this.interval(now) * 1.5) this.firingSince = now;
    const pellets = shotgunAlt ? (def.alt?.pellets ?? 1) : def.pellets;
    out.push({
      kind: 'bullet',
      recoilPitch: this.recoilPitch,
      recoilYaw: this.recoilYaw,
      pellets,
      spread: this.spreadNow(now, m, shotgunAlt),
      uniform: this.moving(m) || pellets > 1,
      zoomed: this.zoomed,
    });
    this.ammo -= 1;
    this.shotsFired++;
    this.kick(now, m, heat);
    this.heat = heat + 1;
    this.heatAtShot = this.heat;
    this.pitchAtShot = this.recoilPitch;
    this.yawAtShot = this.recoilYaw;
    this.lastShot = now;
  }

  private startReload(): void {
    if (this.isMelee || this.ammo >= this.def.magazine || this.reserve <= 0) return;
    this.state = 'reloading';
    this.stateTimer = this.reloadDuration();
    this.reloadAmount = Math.min(this.def.magazine - this.ammo, this.reserve);
    this.zoomLevel = 0;
    this.burstLeft = 0;
  }

  /** Advance the gun. Returns the shots fired during this step. */
  update(dt: number, now: number, input: GunInput, m: MoveSample): ShotEvent[] {
    const out: ShotEvent[] = [];
    const def = this.def;

    if (this.state === 'equipping') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'ready';
        this.nextShot = Math.max(this.nextShot, now);
      }
    } else if (this.state === 'reloading') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.ammo += this.reloadAmount;
        this.reserve -= this.reloadAmount;
        this.state = 'ready';
      }
    }

    this.updateRecoil(now);
    this.updateZoomInput(input);
    const target = this.zoomed ? 1 : 0;
    const step = dt / ZOOM_TIME;
    this.zoomBlend = target > this.zoomBlend ? Math.min(target, this.zoomBlend + step) : Math.max(target, this.zoomBlend - step);

    if (this.state !== 'ready') return out;

    if (this.isMelee) {
      if ((input.fireHeld || input.altPressed) && now >= this.nextShot) {
        const heavy = input.altPressed && !input.fireHeld;
        out.push({ kind: 'melee', recoilPitch: 0, recoilYaw: 0, pellets: 1, spread: 0, uniform: false, zoomed: false, heavy });
        this.nextShot = now + (heavy ? 1.0 : 1 / def.fireRate);
        this.shotsFired++;
      }
      return out;
    }

    if (input.reloadPressed) {
      this.startReload();
      if (this.state !== 'ready') return out;
    }

    // Classic right click: a 3-pellet blast.
    if (def.alt?.kind === 'shotgun' && input.altPressed && now >= this.nextShot && this.ammo > 0) {
      this.shoot(now, m, out, true);
      this.nextShot = now + 1 / def.alt.fireRate;
      if (this.ammo <= 0) this.startReload();
      return out;
    }

    // Zoomed burst fire (Bulldog, Stinger).
    const burst = def.alt?.kind === 'burst' && this.zoomed ? def.alt.burst : undefined;
    if (burst) {
      if (this.burstLeft === 0 && input.firePressed && now >= this.burstCooldownUntil && this.ammo > 0) {
        this.burstLeft = burst.count;
        this.burstNext = now;
        this.burstCooldownUntil = now + 1 / def.alt!.fireRate;
      }
      while (this.burstLeft > 0 && now >= this.burstNext && this.ammo > 0) {
        this.shoot(now, m, out, false);
        this.burstLeft--;
        this.burstNext += 1 / burst.rate;
      }
      if (this.ammo <= 0) {
        this.burstLeft = 0;
        this.startReload();
      }
      return out;
    }

    const wants = def.auto ? input.fireHeld : input.firePressed;
    if (wants && this.ammo > 0) {
      let guard = 0;
      while (now >= this.nextShot && this.ammo > 0 && guard++ < 3) {
        const interval = this.interval(now);
        const base = now - this.nextShot < interval ? this.nextShot : now;
        this.shoot(now, m, out, false);
        this.nextShot = base + interval;
        if (!def.auto) break;
      }
    }
    if (this.ammo <= 0 && this.state === 'ready') this.startReload();
    return out;
  }

  private updateZoomInput(input: GunInput): void {
    // No zooming while drawing, reloading, or on guns without a zoom.
    if (this.state !== 'ready' || !this.canZoom) {
      this.zoomLevel = 0;
      return;
    }
    const alt = this.def.alt!;
    const hold = alt.kind === 'scope' ? this.options.scopeHold : this.options.adsHold;
    if (hold) {
      // Hold mode only reaches the first zoom level; the Operator's 5x needs toggle mode.
      this.zoomLevel = input.altHeld ? Math.max(1, this.zoomLevel) : 0;
    } else if (input.altPressed) {
      this.zoomLevel = this.zoomLevel >= alt.zoom.length ? 0 : this.zoomLevel + 1;
    }
  }
}
