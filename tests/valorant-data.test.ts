import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyHit, makeVitals } from '../src/config/agent';
import { BASE_RUN_SPEED, WEAPONS, type WeaponId, damageAt } from '../src/config/weapons';

interface Fixture {
  weapons: Record<
    string,
    {
      fireRate: number;
      magazineSize: number;
      runSpeedMultiplier: number;
      equipTimeSeconds: number;
      reloadTimeSeconds: number;
      firstBulletAccuracy: number;
      shotgunPelletCount: number;
      fireMode: string | null;
      ads: { zoomMultiplier: number; fireRate: number; runSpeedMultiplier: number; burstCount: number; firstBulletAccuracy: number } | null;
      altShotgun: { shotgunPelletCount: number; burstRate: number } | null;
      damageRanges: [number, number, number, number, number][];
    }
  >;
}

const fixture: Fixture = JSON.parse(readFileSync(new URL('./fixtures/weapons-13.06.json', import.meta.url), 'utf8'));

describe('weapon table matches game build 13.06', () => {
  const ids = Object.keys(fixture.weapons) as WeaponId[];

  it('covers every gun in the game', () => {
    expect(ids.sort()).toEqual((Object.keys(WEAPONS) as WeaponId[]).filter((id) => id !== 'knife').sort());
  });

  for (const id of ids) {
    it(`${id}`, () => {
      const api = fixture.weapons[id];
      const def = WEAPONS[id];
      expect(def.fireRate).toBeCloseTo(api.fireRate, 3);
      expect(def.magazine).toBe(api.magazineSize);
      expect(def.runSpeed).toBeCloseTo(BASE_RUN_SPEED * api.runSpeedMultiplier, 6);
      expect(def.equip).toBeCloseTo(api.equipTimeSeconds, 3);
      // Per-shell reloaders list their full reload.
      expect(def.reload).toBeCloseTo(api.reloadTimeSeconds, 3);
      expect(def.spread[0]).toBeCloseTo(api.firstBulletAccuracy, 3);
      expect(def.pellets).toBe(Math.max(1, api.shotgunPelletCount));
      expect(def.auto).toBe(api.fireMode === null);
      for (const [from, to, head, body, leg] of api.damageRanges) {
        const mid = (from + Math.min(to, 50)) / 2;
        expect(damageAt(def, mid, 'head')).toBe(Math.floor(head));
        expect(damageAt(def, mid, 'body')).toBe(Math.floor(body));
        expect(damageAt(def, mid, 'leg')).toBe(Math.floor(leg));
      }
      if (api.ads) {
        expect(def.alt).not.toBeNull();
        expect(def.alt!.zoom[0]).toBeCloseTo(api.ads.zoomMultiplier, 3);
        expect(def.alt!.moveMult).toBeCloseTo(api.ads.runSpeedMultiplier, 3);
        const effectiveRate = def.alt!.burst ? def.alt!.fireRate * def.alt!.burst.count : def.alt!.fireRate;
        expect(effectiveRate).toBeCloseTo(api.ads.fireRate, 1);
        if (api.ads.firstBulletAccuracy >= 0) expect(def.alt!.spread[0]).toBeCloseTo(api.ads.firstBulletAccuracy, 3);
        if (api.ads.burstCount > 1) expect(def.alt!.burst?.count).toBe(api.ads.burstCount);
      }
      if (api.altShotgun) {
        expect(def.alt?.kind).toBe('shotgun');
        expect(def.alt?.pellets).toBe(api.altShotgun.shotgunPelletCount);
        expect(def.alt?.fireRate).toBeCloseTo(api.altShotgun.burstRate, 3);
      }
    });
  }
});

describe('shields', () => {
  const hitsToKill = (id: WeaponId, distance: number, region: 'head' | 'body' | 'leg') => {
    const v = makeVitals('heavy');
    let n = 0;
    while (v.health > 0 && n < 50) {
      applyHit(v, damageAt(WEAPONS[id], distance, region));
      n++;
    }
    return n;
  };

  it('heavy shields absorb 66% of each hit up to 50 points', () => {
    const v = makeVitals('heavy');
    applyHit(v, 40);
    expect(v.shield).toBeCloseTo(50 - 26.4);
    expect(v.health).toBeCloseTo(100 - 13.6);
  });

  it('reproduces the well-known kill thresholds', () => {
    expect(hitsToKill('vandal', 40, 'head')).toBe(1);
    expect(hitsToKill('vandal', 40, 'body')).toBe(4);
    expect(hitsToKill('phantom', 10, 'head')).toBe(1);
    // Past 20 m a Phantom headshot leaves a heavy-shielded player alive.
    expect(hitsToKill('phantom', 25, 'head')).toBe(2);
    expect(hitsToKill('sheriff', 10, 'head')).toBe(1);
    expect(hitsToKill('sheriff', 10, 'body')).toBe(3);
    expect(hitsToKill('guardian', 45, 'head')).toBe(1);
    expect(hitsToKill('operator', 45, 'body')).toBe(1);
    expect(hitsToKill('ghost', 10, 'head')).toBe(2);
    expect(hitsToKill('marshal', 30, 'head')).toBe(1);
  });
});
