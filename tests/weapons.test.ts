import { describe, expect, it } from 'vitest';
import { WEAPONS, damageAt, shotsToKill } from '../src/config/weapons';
import { Gun, type GunInput, type MoveSample } from '../src/weapons/gun';

const still: MoveSample = { speed: 0, airborne: false, crouched: false, sinceLanding: Infinity, walkSpeed: 2.97, crouchSpeed: 2.0 };
const idle: GunInput = { fireHeld: false, firePressed: false, altHeld: false, altPressed: false, reloadPressed: false };
const hold: GunInput = { ...idle, fireHeld: true };

function ready(id: keyof typeof WEAPONS, opts = { adsHold: true, scopeHold: false }) {
  const g = new Gun(WEAPONS[id], { ...opts, random: () => 0.3 });
  g.update(5, 0, idle, still); // finish equipping
  return g;
}

/** Hold the trigger for `seconds` at a fixed tick and count shots. */
function spray(g: Gun, seconds: number, start = 10, hz = 240, m = still) {
  const shots: { t: number; spread: number }[] = [];
  const dt = 1 / hz;
  for (let i = 0; i <= Math.round(seconds * hz); i++) {
    const t = start + i * dt;
    for (const s of g.update(dt, t, { ...hold, firePressed: i === 0 }, m)) shots.push({ t, spread: s.spread });
  }
  return shots;
}

describe('damage tables', () => {
  it('matches the classic kill thresholds against 150 total health', () => {
    expect(shotsToKill(WEAPONS.vandal, 40, 'head', 150)).toBe(1);
    expect(shotsToKill(WEAPONS.vandal, 40, 'body', 150)).toBe(4);
    expect(shotsToKill(WEAPONS.phantom, 10, 'head', 150)).toBe(1);
    // Phantom falls off past 20 m and no longer one-taps heavy shields.
    expect(shotsToKill(WEAPONS.phantom, 25, 'head', 150)).toBe(2);
    expect(shotsToKill(WEAPONS.sheriff, 10, 'head', 150)).toBe(1);
    expect(shotsToKill(WEAPONS.guardian, 45, 'head', 150)).toBe(1);
    expect(shotsToKill(WEAPONS.operator, 45, 'body', 150)).toBe(1);
    expect(shotsToKill(WEAPONS.ghost, 10, 'head', 150)).toBe(2);
  });

  it('rounds fractional damage down like the game', () => {
    expect(damageAt(WEAPONS.sheriff, 10, 'head')).toBe(159);
    expect(damageAt(WEAPONS.ghost, 40, 'head')).toBe(87);
    expect(damageAt(WEAPONS.classic, 5, 'leg')).toBe(22);
  });
});

describe('gun cadence and ammo', () => {
  it('fires the Vandal at 9.75 rounds per second', () => {
    const shots = spray(ready('vandal'), 2.0);
    // 2 s of fire at 9.75 rps starting at t=0 -> floor(2 * 9.75) + 1 shots.
    expect(shots.length).toBe(20);
    const span = shots[shots.length - 1].t - shots[0].t;
    expect(span / (shots.length - 1)).toBeCloseTo(1 / 9.75, 2);
  });

  it('auto-reloads an empty magazine and refills from reserve', () => {
    const g = ready('vandal');
    const shots = spray(g, 3.0);
    expect(shots.length).toBe(25);
    expect(g.state).toBe('reloading');
    for (let t = 0; t < 2.6; t += 0.01) g.update(0.01, 20 + t, idle, still);
    expect(g.state).toBe('ready');
    expect(g.ammo).toBe(25);
    expect(g.reserve).toBe(25);
  });

  it('semi-autos fire once per click', () => {
    const g = ready('sheriff');
    expect(spray(g, 1.0).length).toBe(1);
  });

  it('zoomed Bulldog fires a 3-round burst per click', () => {
    const g = ready('bulldog');
    const zoomHold = { ...idle, altHeld: true, altPressed: true };
    g.update(0.2, 1, zoomHold, still);
    expect(g.zoomed).toBe(true);
    const shots: number[] = [];
    for (let i = 0; i < 120; i++) {
      const out = g.update(1 / 240, 2 + i / 240, { ...zoomHold, altPressed: false, fireHeld: true, firePressed: i === 0 }, still);
      shots.push(...out.map(() => i));
    }
    expect(shots.length).toBe(3);
  });

  it('Operator toggle-cycles 2.5x, 5x, then unscoped', () => {
    const g = ready('operator');
    const press = { ...idle, altPressed: true, altHeld: true };
    g.update(0.01, 1, press, still);
    expect(g.zoom).toBe(2.5);
    g.update(0.01, 1.1, press, still);
    expect(g.zoom).toBe(5);
    g.update(0.01, 1.2, press, still);
    expect(g.zoom).toBe(1);
  });
});

describe('spread model', () => {
  it('first shot uses first-shot accuracy when still', () => {
    const shots = spray(ready('vandal'), 0.01);
    expect(shots[0].spread).toBeCloseTo(0.25);
  });

  it('error builds to max over the spray and recovers after the recovery time', () => {
    const g = ready('vandal');
    const shots = spray(g, 1.0);
    expect(shots[shots.length - 1].spread).toBeCloseTo(1.0);
    expect(shots[3].spread).toBeGreaterThan(0.25);
    expect(shots[3].spread).toBeLessThan(1.0);
    const later = spray(g, 0.01, 10 + 1.0 + 1 / 9.75 + 0.376);
    expect(later[0].spread).toBeCloseTo(0.25);
  });

  it('moving adds movement error; the deadzone keeps slow movement accurate', () => {
    const g = ready('vandal');
    expect(g.spreadNow(0, { ...still, speed: 5.4 }, false)).toBeCloseTo(0.25 + 6);
    expect(g.spreadNow(0, { ...still, speed: 2.97 }, false)).toBeCloseTo(0.25 + 3);
    expect(g.spreadNow(0, { ...still, speed: 0.275 * 5.4 - 0.01 }, false)).toBeCloseTo(0.25);
    expect(g.spreadNow(0, { ...still, airborne: true }, false)).toBeCloseTo(0.25 + 10);
    expect(g.spreadNow(0, { ...still, sinceLanding: 0.1 }, false)).toBeCloseTo(0.25 + 7);
  });

  it('crouching tightens first-shot spread', () => {
    const g = ready('vandal');
    expect(g.spreadNow(0, { ...still, crouched: true }, false)).toBeCloseTo(0.25 * 0.85);
  });

  it('ADS uses the zoomed spread profile', () => {
    const g = ready('vandal');
    g.update(0.2, 1, { ...idle, altHeld: true, altPressed: true }, still);
    expect(g.spreadNow(2, still, false)).toBeCloseTo(0.1575);
  });

  it('Ares error tightens while firing', () => {
    const shots = spray(ready('ares'), 1.2);
    expect(shots[0].spread).toBeCloseTo(1.0);
    expect(shots[shots.length - 1].spread).toBeCloseTo(0.7);
  });
});

describe('recoil', () => {
  it('first shot has no kick before it, then the camera climbs and recovers', () => {
    const g = ready('vandal');
    expect(g.recoilPitch).toBe(0);
    spray(g, 0.95);
    const peak = g.recoilPitch;
    expect(peak).toBeGreaterThan(4);
    expect(peak).toBeLessThanOrEqual(WEAPONS.vandal.recoil.maxPitch + 1e-9);
    g.update(0.5, 10 + 0.95 + 0.5, idle, still);
    g.update(0.5, 10 + 0.95 + 1.0, idle, still);
    expect(g.recoilPitch).toBeCloseTo(0);
  });

  it('Phantom climbs more gently than the Vandal over the same time', () => {
    const v = ready('vandal');
    const p = ready('phantom');
    spray(v, 0.5);
    spray(p, 0.5);
    expect(p.recoilPitch).toBeLessThan(v.recoilPitch);
  });
});
