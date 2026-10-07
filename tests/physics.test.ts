import { describe, expect, it } from 'vitest';
import { box, makeRay, rayBox, rayBoxHit, rayYawBox } from '../src/physics/aabb';
import { CollisionWorld, type Solid } from '../src/physics/world';

const solid = (b: ReturnType<typeof box>): Solid => ({ ...b, kind: 'wall' });

describe('ray vs box', () => {
  const b = box(-1, -1, -1, 1, 1, 1);

  it('hits a box in front of the ray at the near face', () => {
    const r = makeRay(0, 0, 5, 0, 0, -1);
    expect(rayBox(r, b, 100)).toBeCloseTo(4);
    const hit = rayBoxHit(r, b, 100)!;
    expect(hit.t).toBeCloseTo(4);
    expect(hit.nz).toBe(1);
  });

  it('misses boxes behind the ray or beyond tMax', () => {
    expect(rayBox(makeRay(0, 0, 5, 0, 0, 1), b, 100)).toBe(Infinity);
    expect(rayBox(makeRay(0, 0, 5, 0, 0, -1), b, 3)).toBe(Infinity);
  });

  it('handles axis-parallel rays that graze outside the slab', () => {
    expect(rayBox(makeRay(0, 1.5, 5, 0, 0, -1), b, 100)).toBe(Infinity);
    expect(rayBox(makeRay(0, 0.99, 5, 0, 0, -1), b, 100)).toBeCloseTo(4);
  });

  it('reports t = 0 when starting inside', () => {
    expect(rayBox(makeRay(0, 0, 0, 1, 0, 0), b, 100)).toBe(0);
  });

  it('rotated boxes respect yaw', () => {
    // A thin wide box (2 m along local X, 0.2 m deep). Rotated 90 degrees it becomes wide along Z.
    const r = makeRay(0.8, 0, 5, 0, 0, -1);
    expect(rayYawBox(r, 0, 0, 0, 1, 1, 0.1, 0, 100)).toBeCloseTo(4.9);
    expect(rayYawBox(r, 0, 0, 0, 1, 1, 0.1, Math.PI / 2, 100)).toBe(Infinity);
    const side = makeRay(5, 0, 0.8, -1, 0, 0);
    expect(rayYawBox(side, 0, 0, 0, 1, 1, 0.1, Math.PI / 2, 100)).toBeCloseTo(4.9);
  });
});

describe('collision world', () => {
  it('stops a moving box flush against a wall and slides along it', () => {
    const w = new CollisionWorld();
    w.addGroup(1, [solid(box(-10, -1, -10, 10, 0, 10)), solid(box(1, 0, -10, 2, 3, 10))]);
    const pos = { x: 0, y: 0, z: 0 };
    const hit = w.moveBox(pos, 0.3, 1.8, 2, 0, -1);
    expect(hit.hitX).toBe(true);
    expect(pos.x).toBeCloseTo(0.7);
    expect(pos.z).toBeCloseTo(-1);
  });

  it('lands on the floor', () => {
    const w = new CollisionWorld();
    w.addGroup(1, [solid(box(-10, -1, -10, 10, 0, 10))]);
    const pos = { x: 0, y: 0.5, z: 0 };
    const hit = w.moveBox(pos, 0.3, 1.8, 0, -2, 0);
    expect(hit.hitY).toBe(true);
    expect(pos.y).toBeCloseTo(0);
  });

  it('segmentBlocked sees walls between two points but not past the endpoint', () => {
    const w = new CollisionWorld();
    w.addGroup(1, [solid(box(-1, 0, -1, 1, 3, 1))]);
    expect(w.segmentBlocked(-5, 1, 0, 5, 1, 0)).toBe(true);
    expect(w.segmentBlocked(-5, 1, 0, -2, 1, 0)).toBe(false);
    expect(w.segmentBlocked(-5, 4, 0, 5, 4, 0)).toBe(false);
  });

  it('nearest raycast hit wins across groups', () => {
    const w = new CollisionWorld();
    w.addGroup(1, [solid(box(-1, 0, -11, 1, 3, -10))]);
    w.addGroup(2, [solid(box(-1, 0, -6, 1, 3, -5))]);
    const hit = w.raycast(makeRay(0, 1, 0, 0, 0, -1), 100)!;
    expect(hit.t).toBeCloseTo(5);
    w.removeGroup(2);
    expect(w.raycast(makeRay(0, 1, 0, 0, 0, -1), 100)!.t).toBeCloseTo(10);
  });
});
