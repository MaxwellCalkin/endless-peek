/**
 * VALORANT crosshair profile codes, e.g. "0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0".
 *
 * Format: semicolon separated tokens. "0" opens the general section, then "P" (primary),
 * "A" (aim down sights) and "S" (sniper scope) switch sections. Everything else is key;value
 * pairs. Only non-default values are written, so "0" alone is the default crosshair. Inner-line
 * keys are prefixed with 0, outer-line keys with 1. Matches the open-source parsers
 * LilyBergonzat/Crosshair and @valapi/crosshair.
 */

export interface LineSettings {
  show: boolean;
  opacity: number;
  length: number;
  verticalLength: number;
  separateVertical: boolean;
  thickness: number;
  offset: number;
  movementError: boolean;
  movementMult: number;
  firingError: boolean;
  firingMult: number;
}

export interface CrosshairProfile {
  /** Preset index 0-7, or 8 for custom. */
  colorIndex: number;
  /** #RRGGBB used when colorIndex is 8. */
  customColor: string;
  outlines: boolean;
  outlineOpacity: number;
  outlineThickness: number;
  centerDot: boolean;
  dotOpacity: number;
  dotThickness: number;
  fadeWithFiringError: boolean;
  /** "m": use your own offset as the resting gap instead of adding the weapon's base error. */
  overrideFiringOffset: boolean;
  inner: LineSettings;
  outer: LineSettings;
}

export interface SniperSettings {
  colorIndex: number;
  customColor: string;
  centerDot: boolean;
  dotSize: number;
  dotOpacity: number;
}

export interface CrosshairConfig {
  primary: CrosshairProfile;
  /** When false the ADS crosshair copies the primary one. */
  separateAds: boolean;
  ads: CrosshairProfile;
  sniper: SniperSettings;
}

export const CROSSHAIR_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Green', hex: '#00ff00' },
  { name: 'Yellow Green', hex: '#7fff00' },
  { name: 'Green Yellow', hex: '#dfff00' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Cyan', hex: '#00ffff' },
  { name: 'Pink', hex: '#ff00ff' },
  { name: 'Red', hex: '#ff0000' },
];

export function defaultInner(): LineSettings {
  return {
    show: true,
    opacity: 0.8,
    length: 6,
    verticalLength: 6,
    separateVertical: false,
    thickness: 2,
    offset: 3,
    movementError: false,
    movementMult: 1,
    firingError: true,
    firingMult: 1,
  };
}

export function defaultOuter(): LineSettings {
  return {
    show: true,
    opacity: 0.35,
    length: 2,
    verticalLength: 2,
    separateVertical: false,
    thickness: 2,
    offset: 10,
    movementError: true,
    movementMult: 1,
    firingError: true,
    firingMult: 1,
  };
}

export function defaultProfile(): CrosshairProfile {
  return {
    colorIndex: 0,
    customColor: '#ffffff',
    outlines: true,
    outlineOpacity: 0.5,
    outlineThickness: 1,
    centerDot: false,
    dotOpacity: 1,
    dotThickness: 2,
    fadeWithFiringError: true,
    overrideFiringOffset: false,
    inner: defaultInner(),
    outer: defaultOuter(),
  };
}

export function defaultSniper(): SniperSettings {
  return { colorIndex: 7, customColor: '#ff0000', centerDot: true, dotSize: 1, dotOpacity: 0.75 };
}

export function defaultCrosshair(): CrosshairConfig {
  return { primary: defaultProfile(), separateAds: false, ads: defaultProfile(), sniper: defaultSniper() };
}

export function profileColor(p: { colorIndex: number; customColor: string }): string {
  if (p.colorIndex >= 0 && p.colorIndex < CROSSHAIR_COLORS.length) return CROSSHAIR_COLORS[p.colorIndex].hex;
  return p.customColor;
}

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : v !== '0');

function parseHex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

function applyLine(line: LineSettings, kv: Map<string, string>, prefix: '0' | '1'): void {
  const g = (k: string) => kv.get(prefix + k);
  line.show = bool(g('b'), line.show);
  line.thickness = num(g('t'), line.thickness);
  line.length = num(g('l'), line.length);
  line.separateVertical = bool(g('g'), line.separateVertical);
  line.verticalLength = num(g('v'), line.separateVertical ? line.verticalLength : line.length);
  line.offset = num(g('o'), line.offset);
  line.opacity = num(g('a'), line.opacity);
  line.movementError = bool(g('m'), line.movementError);
  line.movementMult = num(g('s'), line.movementMult);
  line.firingError = bool(g('f'), line.firingError);
  line.firingMult = num(g('e'), line.firingMult);
}

function applyProfile(p: CrosshairProfile, kv: Map<string, string>): void {
  p.colorIndex = num(kv.get('c'), p.colorIndex);
  p.customColor = parseHex(kv.get('u'), p.customColor);
  // Newer codes flag a custom color with "b;1"; older ones use color index 8.
  if (kv.get('b') === '1') p.colorIndex = 8;
  p.outlines = bool(kv.get('h'), p.outlines);
  p.outlineThickness = num(kv.get('t'), p.outlineThickness);
  p.outlineOpacity = num(kv.get('o'), p.outlineOpacity);
  p.centerDot = bool(kv.get('d'), p.centerDot);
  p.dotThickness = num(kv.get('z'), p.dotThickness);
  p.dotOpacity = num(kv.get('a'), p.dotOpacity);
  p.fadeWithFiringError = bool(kv.get('f'), p.fadeWithFiringError);
  p.overrideFiringOffset = bool(kv.get('m'), p.overrideFiringOffset);
  applyLine(p.inner, kv, '0');
  applyLine(p.outer, kv, '1');
}

export class CrosshairCodeError extends Error {}

/** Parse a VALORANT crosshair code. Unknown keys are ignored. Throws on obviously invalid input. */
export function parseCrosshairCode(code: string): CrosshairConfig {
  const tokens = code
    .trim()
    .split(';')
    .map((t) => t.trim());
  if (tokens.length === 0 || tokens[0] === '' || !/^\d+$/.test(tokens[0])) {
    throw new CrosshairCodeError('A crosshair code starts with a version number, like "0;P;..."');
  }
  const sections = new Map<string, Map<string, string>>([
    ['', new Map()],
    ['P', new Map()],
    ['A', new Map()],
    ['S', new Map()],
  ]);
  let current = sections.get('')!;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '') continue;
    if (tok === 'P' || tok === 'A' || tok === 'S') {
      current = sections.get(tok)!;
      continue;
    }
    const value = tokens[i + 1];
    if (value === undefined) break;
    current.set(tok, value);
    i++;
  }
  const cfg = defaultCrosshair();
  applyProfile(cfg.primary, sections.get('P')!);
  // General section: "p" (default 1) means the ADS crosshair copies the primary one.
  cfg.separateAds = sections.get('')!.get('p') === '0';
  cfg.ads = structuredClone(cfg.primary);
  if (cfg.separateAds) {
    cfg.ads = defaultProfile();
    applyProfile(cfg.ads, sections.get('A')!);
  }
  const s = sections.get('S')!;
  const sn = cfg.sniper;
  sn.colorIndex = num(s.get('c'), sn.colorIndex);
  // The sniper section stores its custom color under "t".
  sn.customColor = parseHex(s.get('t'), sn.customColor);
  if (s.get('b') === '1') sn.colorIndex = 8;
  sn.centerDot = bool(s.get('d'), sn.centerDot);
  sn.dotSize = num(s.get('s'), sn.dotSize);
  sn.dotOpacity = num(s.get('o'), sn.dotOpacity);
  return cfg;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function lineDiff(out: string[], line: LineSettings, def: LineSettings, prefix: '0' | '1'): void {
  const push = (k: string, v: string) => out.push(prefix + k, v);
  if (line.show !== def.show) push('b', line.show ? '1' : '0');
  if (line.thickness !== def.thickness) push('t', fmt(line.thickness));
  if (line.length !== def.length) push('l', fmt(line.length));
  if (line.separateVertical !== def.separateVertical) push('g', line.separateVertical ? '1' : '0');
  if (line.separateVertical && line.verticalLength !== line.length) push('v', fmt(line.verticalLength));
  if (line.offset !== def.offset) push('o', fmt(line.offset));
  if (line.opacity !== def.opacity) push('a', fmt(line.opacity));
  if (line.movementError !== def.movementError) push('m', line.movementError ? '1' : '0');
  if (line.movementMult !== def.movementMult) push('s', fmt(line.movementMult));
  if (line.firingError !== def.firingError) push('f', line.firingError ? '1' : '0');
  if (line.firingMult !== def.firingMult) push('e', fmt(line.firingMult));
}

function profileDiff(p: CrosshairProfile): string[] {
  const d = defaultProfile();
  const out: string[] = [];
  if (p.colorIndex === 8) out.push('c', '8', 'u', p.customColor.replace('#', '').toUpperCase() + 'FF', 'b', '1');
  else if (p.colorIndex !== d.colorIndex) out.push('c', String(p.colorIndex));
  if (p.outlines !== d.outlines) out.push('h', p.outlines ? '1' : '0');
  if (p.outlineThickness !== d.outlineThickness) out.push('t', fmt(p.outlineThickness));
  if (p.outlineOpacity !== d.outlineOpacity) out.push('o', fmt(p.outlineOpacity));
  if (p.centerDot !== d.centerDot) out.push('d', p.centerDot ? '1' : '0');
  if (p.dotThickness !== d.dotThickness) out.push('z', fmt(p.dotThickness));
  if (p.dotOpacity !== d.dotOpacity) out.push('a', fmt(p.dotOpacity));
  if (p.fadeWithFiringError !== d.fadeWithFiringError) out.push('f', p.fadeWithFiringError ? '1' : '0');
  if (p.overrideFiringOffset !== d.overrideFiringOffset) out.push('m', p.overrideFiringOffset ? '1' : '0');
  lineDiff(out, p.inner, d.inner, '0');
  lineDiff(out, p.outer, d.outer, '1');
  return out;
}

export function serializeCrosshairCode(cfg: CrosshairConfig): string {
  const out: string[] = ['0'];
  if (cfg.separateAds) out.push('p', '0');
  out.push('P', ...profileDiff(cfg.primary));
  if (cfg.separateAds) out.push('A', ...profileDiff(cfg.ads));
  const sd = defaultSniper();
  const sn = cfg.sniper;
  const s: string[] = [];
  if (sn.colorIndex === 8) s.push('c', '8', 'b', '1', 't', sn.customColor.replace('#', '').toUpperCase() + 'FF');
  else if (sn.colorIndex !== sd.colorIndex) s.push('c', String(sn.colorIndex));
  if (sn.centerDot !== sd.centerDot) s.push('d', sn.centerDot ? '1' : '0');
  if (sn.dotSize !== sd.dotSize) s.push('s', fmt(sn.dotSize));
  if (sn.dotOpacity !== sd.dotOpacity) s.push('o', fmt(sn.dotOpacity));
  if (s.length) out.push('S', ...s);
  return out.join(';');
}
