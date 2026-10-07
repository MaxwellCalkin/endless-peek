import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/config/agent';
import { airStep, groundStep, type Vec2, wishDirection } from '../src/player/movement';

const TICK = 1 / 128;

function timeUntil(vel: Vec2, wish: Vec2 | null, max: number, done: (v: Vec2) => boolean): number {
  let t = 0;
  while (!done(vel) && t < 3) {
    groundStep(vel, wish, max, TICK, MOVEMENT);
    t += TICK;
  }
  return t;
}

describe('movement (UE CharacterMovement model)', () => {
  it('counter-strafing from full rifle speed matches Riot timings', () => {
    const left = { x: -1, z: 0 };
    const toDeadzone = timeUntil({ x: 5.4, z: 0 }, left, 5.4, (v) => v.x <= 0.25 * 5.4);
    const toStop = timeUntil({ x: 5.4, z: 0 }, left, 5.4, (v) => v.x <= 0);
    expect(toDeadzone).toBeGreaterThan(0.09);
    expect(toDeadzone).toBeLessThan(0.12);
    expect(toStop).toBeGreaterThan(0.14);
    expect(toStop).toBeLessThan(0.18);
  });

  it('releasing the keys stops about as fast', () => {
    const toStop = timeUntil({ x: 5.4, z: 0 }, null, 5.4, (v) => v.x === 0);
    expect(toStop).toBeGreaterThan(0.14);
    expect(toStop).toBeLessThan(0.19);
  });

  it('accelerates to full speed in about a quarter second and never exceeds it', () => {
    const v = { x: 0, z: 0 };
    const fwd = { x: 0, z: -1 };
    const t = timeUntil(v, fwd, 5.4, (vel) => Math.hypot(vel.x, vel.z) >= 5.4 - 1e-6);
    expect(t).toBeGreaterThan(0.2);
    expect(t).toBeLessThan(0.3);
    for (let i = 0; i < 200; i++) groundStep(v, fwd, 5.4, TICK, MOVEMENT);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(5.4, 6);
  });

  it('brakes down to a lower cap (e.g. starting to walk) without stopping dead', () => {
    const v = { x: 5.4, z: 0 };
    const t = timeUntil(v, { x: 1, z: 0 }, 3.0, (vel) => vel.x <= 3.0 + 1e-6);
    expect(t).toBeLessThan(0.15);
    expect(v.x).toBeGreaterThan(2.5);
  });

  it('is frame-rate independent enough (60 vs 240 Hz)', () => {
    const run = (hz: number) => {
      const v = { x: 5.4, z: 0 };
      for (let i = 0; i < hz * 0.08; i++) groundStep(v, null, 5.4, 1 / hz, MOVEMENT);
      return v.x;
    };
    expect(Math.abs(run(60) - run(240))).toBeLessThan(0.15);
  });

  it('keeps momentum in the air with little control', () => {
    const v = { x: 5.4, z: 0 };
    // Half a second of holding the opposite key barely slows you down.
    for (let i = 0; i < 64; i++) airStep(v, { x: -1, z: 0 }, 5.4, TICK, MOVEMENT);
    expect(v.x).toBeGreaterThan(4.0);
  });

  it('builds a world-space wish direction from WASD and yaw', () => {
    const fwd = wishDirection(1, 0, 0)!;
    expect(fwd.x).toBeCloseTo(0);
    expect(fwd.z).toBeCloseTo(-1);
    const right = wishDirection(0, 1, 0)!;
    expect(right.x).toBeCloseTo(1);
    const diag = wishDirection(1, 1, 0)!;
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1);
    expect(wishDirection(0, 0, 1)).toBeNull();
  });
});
