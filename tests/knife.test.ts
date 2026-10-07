import { describe, expect, it } from 'vitest';
import { balisongPose } from '../src/render/butterflyKnife';
import { KNIFE_ANIM_LENGTH, type KnifeAnimKind, gunInspectPose, GUN_INSPECT_LENGTH, knifePose, restPose } from '../src/render/knifeAnims';

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

describe('balisong flip', () => {
  it('is closed at 0 and open at 1', () => {
    expect(balisongPose(0)).toEqual({ blade: Math.PI, safe: Math.PI });
    const open = balisongPose(1);
    expect(open.blade).toBeCloseTo(0);
    expect(open.safe).toBeCloseTo(0);
  });

  it('locks the blade open halfway while the free handle keeps swinging', () => {
    const mid = balisongPose(0.5);
    expect(mid.blade).toBeCloseTo(0);
    expect(mid.safe).toBeCloseTo(Math.PI);
  });

  it('swings the free handle one full turn without reversing', () => {
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const p = balisongPose(i / 100);
      const handle = p.blade + p.safe; // absolute angle in the held handle's frame
      expect(handle).toBeLessThanOrEqual(prev + 1e-9);
      prev = handle;
    }
    expect(wrap(balisongPose(0).blade + balisongPose(0).safe)).toBeCloseTo(0);
    expect(balisongPose(1).blade + balisongPose(1).safe).toBeCloseTo(0);
    expect(balisongPose(0).blade + balisongPose(0).safe).toBeCloseTo(TAU);
  });
});

describe('knife animation timelines', () => {
  const rest = restPose();
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2));

  for (const kind of Object.keys(KNIFE_ANIM_LENGTH) as KnifeAnimKind[]) {
    it(`${kind} ends exactly on the rest pose`, () => {
      const end = knifePose(kind, KNIFE_ANIM_LENGTH[kind], 0);
      expect(end.flip).toBeCloseTo(1, 2);
      expect(end.present).toBeCloseTo(0, 2);
      close(end.pos, rest.pos);
      close(end.rot, rest.rot);
      close(end.tossPos, rest.tossPos);
      expect(wrap(end.tossRot[0] + 1e-9) % TAU).toBeCloseTo(0, 2);
      expect(end.trail).toBe(false);
    });
  }

  it('draws the knife closed and flips it open', () => {
    expect(knifePose('draw', 0).flip).toBe(0);
    expect(knifePose('draw', 0.4).flip).toBeGreaterThan(0.3);
    expect(knifePose('draw', KNIFE_ANIM_LENGTH.draw).flip).toBe(1);
  });

  it('every swing of the combo leaves a trail mid-slash and nowhere else', () => {
    for (const combo of [0, 1, 2]) {
      expect(knifePose('swing', 0.15, combo).trail).toBe(true);
      expect(knifePose('swing', 0.02, combo).trail).toBe(false);
      expect(knifePose('swing', 0.35, combo).trail).toBe(false);
    }
  });

  it('inspect closes, tosses, twirls and fans the knife', () => {
    expect(knifePose('inspect', 0.85).flip).toBeLessThan(0.1);
    expect(knifePose('inspect', 1.3).tossPos[1]).toBeGreaterThan(0.05);
    expect(Math.abs(knifePose('inspect', 2.2).tossRot[0])).toBeGreaterThan(1);
    expect(knifePose('inspect', 2.9).flip).toBeLessThan(0.5);
    expect(knifePose('inspect', 2).present).toBeCloseTo(1);
  });

  it('gun inspect returns to the hip pose', () => {
    const end = gunInspectPose(GUN_INSPECT_LENGTH);
    close(end.pos, [0, 0, 0]);
    close(end.rot, [0, 0, 0]);
    expect(Math.abs(gunInspectPose(0.8).rot[1])).toBeGreaterThan(0.5);
  });
});
