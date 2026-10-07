/**
 * Ground and air movement modeled on Unreal Engine 4's CharacterMovementComponent, which
 * VALORANT is built on. Constants live in config/agent.ts.
 *
 * Walking with input: velocity is pulled toward the input direction by ground friction, then
 * accelerated and clamped to max speed.
 * Walking without input (or over max speed): friction * brakingFrictionFactor * v plus a
 * constant braking deceleration, never reversing direction, snapping to zero below a threshold.
 * Counter-strafing (input opposite to velocity) works out to the same deceleration curve,
 * which matches Riot's statement that releasing the key stops you about as fast.
 */

export interface MoveParams {
  maxAcceleration: number;
  brakingDeceleration: number;
  groundFriction: number;
  brakingFrictionFactor: number;
  brakeToStop: number;
  airControl: number;
  gravity: number;
  jumpVelocity: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** One ground-movement step. `wish` is a unit direction or null when no keys are held. */
export function groundStep(vel: Vec2, wish: Vec2 | null, maxSpeed: number, dt: number, p: MoveParams): void {
  const speed = Math.hypot(vel.x, vel.z);
  const overMax = speed > maxSpeed * 1.0001;
  if (!wish || overMax) {
    brake(vel, dt, p.groundFriction * p.brakingFrictionFactor, p.brakingDeceleration);
    if (overMax && wish && Math.hypot(vel.x, vel.z) < maxSpeed && vel.x * wish.x + vel.z * wish.z > 0) {
      const s = Math.hypot(vel.x, vel.z) || 1;
      vel.x = (vel.x / s) * maxSpeed;
      vel.z = (vel.z / s) * maxSpeed;
    }
  } else {
    // Friction bends velocity toward the input direction.
    const k = Math.min(dt * p.groundFriction, 1);
    vel.x -= (vel.x - wish.x * speed) * k;
    vel.z -= (vel.z - wish.z * speed) * k;
  }
  if (wish) {
    const limit = Math.max(maxSpeed, overMax ? Math.hypot(vel.x, vel.z) : 0);
    vel.x += wish.x * p.maxAcceleration * dt;
    vel.z += wish.z * p.maxAcceleration * dt;
    clampLength(vel, limit);
  }
}

/** One airborne step: no friction, a little air control. */
export function airStep(vel: Vec2, wish: Vec2 | null, maxSpeed: number, dt: number, p: MoveParams): void {
  if (!wish) return;
  const before = Math.hypot(vel.x, vel.z);
  vel.x += wish.x * p.maxAcceleration * p.airControl * dt;
  vel.z += wish.z * p.maxAcceleration * p.airControl * dt;
  clampLength(vel, Math.max(maxSpeed, before));
}

function brake(vel: Vec2, dt: number, friction: number, decel: number): void {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed === 0) return;
  const ox = vel.x;
  const oz = vel.z;
  const rx = -(ox / speed) * decel;
  const rz = -(oz / speed) * decel;
  // Sub-step like UE4 so results don't depend on frame rate.
  let remaining = dt;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, 1 / 120);
    remaining -= h;
    vel.x += (-friction * vel.x + rx) * h;
    vel.z += (-friction * vel.z + rz) * h;
    if (vel.x * ox + vel.z * oz <= 0) {
      vel.x = 0;
      vel.z = 0;
      return;
    }
  }
  if (Math.hypot(vel.x, vel.z) <= 0.1) {
    vel.x = 0;
    vel.z = 0;
  }
}

function clampLength(v: Vec2, max: number): void {
  const s = Math.hypot(v.x, v.z);
  if (s > max && s > 0) {
    v.x = (v.x / s) * max;
    v.z = (v.z / s) * max;
  }
}

/** World-space unit wish direction from WASD and yaw, or null. */
export function wishDirection(forward: number, right: number, yaw: number): Vec2 | null {
  if (forward === 0 && right === 0) return null;
  // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const x = fx * forward + rx * right;
  const z = fz * forward + rz * right;
  const l = Math.hypot(x, z);
  return { x: x / l, z: z / l };
}
