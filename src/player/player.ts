import { AGENT, type ArmorKind, HITBOXES, MOVEMENT, type Vitals, makeVitals } from '../config/agent';
import { clamp, lerp } from '../core/math';
import type { Box } from '../physics/aabb';
import type { CollisionWorld } from '../physics/world';
import { airStep, groundStep, wishDirection } from './movement';

export interface MoveInput {
  forward: number;
  right: number;
  walk: boolean;
  crouch: boolean;
  jump: boolean;
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  /** A footstep that makes noise (running, not walking or crouching). */
  footstep: boolean;
}

/** The player's body: position, velocity, stance and health. View angles live here too. */
export class Player {
  pos = { x: 0, y: 0, z: 0 };
  prevPos = { x: 0, y: 0, z: 0 };
  vel = { x: 0, y: 0, z: 0 };
  /** Base view angles in radians (recoil is applied on top by the camera). */
  yaw = 0;
  pitch = 0;
  crouch = 0;
  prevCrouch = 0;
  grounded = true;
  sinceLanding = Infinity;
  vitals: Vitals;
  taggedUntil = -Infinity;
  alive = true;
  private stride = 0;
  private airTime = 0;

  constructor(armor: ArmorKind) {
    this.vitals = makeVitals(armor);
  }

  reset(x: number, z: number, yaw: number, armor: ArmorKind): void {
    this.pos = { x, y: 0, z };
    this.prevPos = { ...this.pos };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = yaw;
    this.pitch = 0;
    this.crouch = 0;
    this.prevCrouch = 0;
    this.grounded = true;
    this.sinceLanding = Infinity;
    this.vitals = makeVitals(armor);
    this.taggedUntil = -Infinity;
    this.alive = true;
  }

  get height(): number {
    return lerp(AGENT.standHeight, AGENT.crouchHeight, this.crouch);
  }

  eyeHeight(crouch = this.crouch): number {
    return lerp(AGENT.eyeStand, AGENT.eyeCrouch, crouch);
  }

  get crouched(): boolean {
    return this.crouch > 0.5;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Max ground speed given weapon, zoom, stance, walk and tagging. */
  maxSpeed(runSpeed: number, zoomMult: number, walking: boolean, now: number): number {
    let s = runSpeed * zoomMult;
    if (this.crouched) s *= AGENT.crouchMult;
    else if (walking) s *= AGENT.walkMult;
    if (now < this.taggedUntil) s *= AGENT.tagMult;
    return s;
  }

  step(dt: number, input: MoveInput, maxSpeed: number, world: CollisionWorld, walkSpeed: number): StepEvents {
    const ev: StepEvents = { jumped: false, landed: false, footstep: false };
    this.prevPos = { ...this.pos };
    this.prevCrouch = this.crouch;

    // Crouch blend; standing up needs headroom.
    const target = input.crouch ? 1 : 0;
    if (target < this.crouch) {
      const r = AGENT.radius - 0.01;
      const head: Box = {
        minX: this.pos.x - r,
        maxX: this.pos.x + r,
        minY: this.pos.y + this.height,
        maxY: this.pos.y + AGENT.standHeight,
        minZ: this.pos.z - r,
        maxZ: this.pos.z + r,
      };
      if (head.maxY - head.minY > 1e-3 && world.overlapsAny(head)) {
        // Stay down.
      } else {
        this.crouch = Math.max(0, this.crouch - dt / AGENT.crouchTime);
      }
    } else {
      this.crouch = Math.min(1, this.crouch + dt / AGENT.crouchTime);
    }

    const wish = wishDirection(input.forward, input.right, this.yaw);
    const hv = { x: this.vel.x, z: this.vel.z };
    if (this.grounded) groundStep(hv, wish, maxSpeed, dt, MOVEMENT);
    else airStep(hv, wish, maxSpeed, dt, MOVEMENT);
    this.vel.x = hv.x;
    this.vel.z = hv.z;

    if (input.jump && this.grounded) {
      this.vel.y = MOVEMENT.jumpVelocity;
      this.grounded = false;
      ev.jumped = true;
    }
    if (!this.grounded) this.vel.y -= MOVEMENT.gravity * dt;

    const dy = this.grounded ? -0.05 : this.vel.y * dt;
    const before = this.pos.y;
    const hit = world.moveBox(this.pos, AGENT.radius, this.height, this.vel.x * dt, dy, this.vel.z * dt);
    if (hit.hitX) this.vel.x = 0;
    if (hit.hitZ) this.vel.z = 0;
    if (hit.hitY && dy < 0) {
      if (!this.grounded && this.airTime > 0.12) {
        ev.landed = true;
        this.sinceLanding = 0;
      }
      this.grounded = true;
      this.vel.y = 0;
      this.airTime = 0;
    } else if (hit.hitY && dy > 0) {
      this.vel.y = 0;
    } else if (this.grounded) {
      // Walked off an edge: undo the probe and start falling.
      this.pos.y = before;
      this.grounded = false;
      this.vel.y = 0;
    }
    if (!this.grounded) this.airTime += dt;
    this.sinceLanding += dt;

    // Running makes noise; walking and crouching are silent.
    const speed = this.speed;
    if (this.grounded && speed > walkSpeed * 1.05 && !this.crouched) {
      this.stride += speed * dt;
      if (this.stride >= 2.1) {
        this.stride = 0;
        ev.footstep = true;
      }
    } else if (speed < 0.5) {
      this.stride = 1.2;
    }
    return ev;
  }

  /** Interpolated eye position for rendering between 128 Hz ticks. */
  eyeAt(alpha: number): { x: number; y: number; z: number } {
    const a = clamp(alpha, 0, 1);
    const c = lerp(this.prevCrouch, this.crouch, a);
    return {
      x: lerp(this.prevPos.x, this.pos.x, a),
      y: lerp(this.prevPos.y, this.pos.y, a) + this.eyeHeight(c),
      z: lerp(this.prevPos.z, this.pos.z, a),
    };
  }

  /** Axis-aligned hitboxes (the player never yaws its hitboxes; bots aim at centers). */
  hitboxes(): { region: 'head' | 'body' | 'leg'; box: Box }[] {
    const set = HITBOXES[this.crouched ? 'crouch' : 'stand'];
    const mk = (b: (typeof set)['head']): Box => ({
      minX: this.pos.x - b.hx,
      maxX: this.pos.x + b.hx,
      minY: this.pos.y + b.y - b.hy,
      maxY: this.pos.y + b.y + b.hy,
      minZ: this.pos.z - b.hz,
      maxZ: this.pos.z + b.hz,
    });
    return [
      { region: 'head', box: mk(set.head) },
      { region: 'body', box: mk(set.body) },
      { region: 'leg', box: mk(set.legs) },
    ];
  }

  /** Points bots check line of sight against (head first; shoulders show before eyes). */
  visibilityPoints(): { x: number; y: number; z: number }[] {
    const set = HITBOXES[this.crouched ? 'crouch' : 'stand'];
    const p = this.pos;
    const sx = set.body.hx * 0.9;
    const sy = p.y + set.body.y + set.body.hy * 0.6;
    return [
      { x: p.x, y: p.y + set.head.y, z: p.z },
      { x: p.x, y: p.y + set.body.y, z: p.z },
      { x: p.x + sx, y: sy, z: p.z },
      { x: p.x - sx, y: sy, z: p.z },
      { x: p.x, y: sy, z: p.z + sx },
      { x: p.x, y: sy, z: p.z - sx },
      { x: p.x, y: p.y + set.legs.y, z: p.z },
    ];
  }
}
