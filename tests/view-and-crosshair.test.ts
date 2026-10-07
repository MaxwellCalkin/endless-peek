import { describe, expect, it } from 'vitest';
import { cmPer360, convertFrom, degreesPerCount, errorToPixels, frameRect, horizontalFov, pixelsPerDegree, verticalFov } from '../src/core/view';
import { defaultCrosshair, parseCrosshairCode, serializeCrosshairCode, profileColor } from '../src/ui/crosshairCode';

describe('camera math', () => {
  it('uses 103 degrees horizontal in a 16:9 frame', () => {
    expect(verticalFov(103)).toBeCloseTo(70.53, 1);
  });

  it('divides the horizontal angle by the zoom', () => {
    expect(horizontalFov(1.25)).toBeCloseTo(82.4, 2);
    expect(verticalFov(horizontalFov(1.25))).toBeCloseTo(52.43, 1);
    expect(horizontalFov(2.5)).toBeCloseTo(41.2, 2);
  });

  it('turns 0.07 degrees per count times sensitivity', () => {
    expect(degreesPerCount(0.4)).toBeCloseTo(0.028, 6);
    // 800 DPI at 0.4 is about 40.8 cm per 360.
    expect(cmPer360(0.4, 800)).toBeCloseTo(40.8, 1);
    expect(degreesPerCount(0.4, 1.25, 1)).toBeCloseTo(0.028 / 1.25, 6);
  });

  it('converts CS2 sensitivity', () => {
    expect(convertFrom('CS2 / CS:GO', 1.0)).toBeCloseTo(0.3143, 3);
  });

  it('maps spread to about 13.33 px per degree at 1080p', () => {
    expect(pixelsPerDegree(1080)).toBeCloseTo(13.33, 1);
    expect(errorToPixels(6, 1080)).toBeCloseTo(80.3, 0);
  });

  it('letterboxes non-16:9 windows', () => {
    expect(frameRect(2560, 1080, 'letterbox')).toEqual({ x: 320, y: 0, w: 1920, h: 1080 });
    expect(frameRect(1440, 1080, 'letterbox')).toEqual({ x: 0, y: 135, w: 1440, h: 810 });
    expect(frameRect(1440, 1080, 'stretch')).toEqual({ x: 0, y: 0, w: 1440, h: 1080 });
  });
});

describe('crosshair codes', () => {
  it('"0" is the default crosshair', () => {
    expect(parseCrosshairCode('0')).toEqual(defaultCrosshair());
    expect(serializeCrosshairCode(defaultCrosshair())).toBe('0;P');
  });

  it('decodes a typical pro-style code', () => {
    const c = parseCrosshairCode('0;P;c;5;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0');
    const p = c.primary;
    expect(profileColor(p)).toBe('#00ffff');
    expect(p.outlines).toBe(false);
    expect(p.fadeWithFiringError).toBe(false);
    expect(p.inner.length).toBe(4);
    expect(p.inner.offset).toBe(2);
    expect(p.inner.opacity).toBe(1);
    expect(p.inner.firingError).toBe(false);
    expect(p.outer.show).toBe(false);
    expect(c.separateAds).toBe(false);
    expect(c.ads).toEqual(p);
  });

  it('reads custom colors, separate ADS and sniper settings', () => {
    const c = parseCrosshairCode('0;p;0;s;1;P;c;8;u;FF8800FF;b;1;d;1;z;3;0b;0;1b;0;A;c;1;S;c;8;b;1;t;00FF00FF;s;0.5;o;1');
    expect(profileColor(c.primary)).toBe('#ff8800');
    expect(c.primary.centerDot).toBe(true);
    expect(c.primary.dotThickness).toBe(3);
    expect(c.separateAds).toBe(true);
    expect(profileColor(c.ads)).toBe('#00ff00');
    expect(profileColor(c.sniper)).toBe('#00ff00');
    expect(c.sniper.dotSize).toBe(0.5);
    expect(c.sniper.dotOpacity).toBe(1);
  });

  it('round-trips through serialize', () => {
    const codes = [
      '0;P;c;5;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0',
      '0;p;0;P;c;8;u;FF8800FF;b;1;d;1;z;3;0b;0;1b;0;A;c;1;S;c;4;s;0.5',
      '0;P;o;1;d;1;z;1;0t;1;0l;3;0o;1;1t;3;1l;1;1o;6;1m;0;m;1',
    ];
    for (const code of codes) {
      const parsed = parseCrosshairCode(code);
      expect(parseCrosshairCode(serializeCrosshairCode(parsed))).toEqual(parsed);
    }
  });

  it('rejects things that are not crosshair codes', () => {
    expect(() => parseCrosshairCode('hello')).toThrow();
    expect(() => parseCrosshairCode('')).toThrow();
  });
});
