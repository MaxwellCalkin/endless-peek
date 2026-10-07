/**
 * Weapon data, patch 13.06 (game build release-13.06, Unreal Engine 5.3).
 *
 * Fire rates, magazines, reloads, equip times, damage tables, run speeds, first-shot and max
 * spread, movement error, crouch multipliers, zoom, burst parameters, recovery times, tap
 * efficiency, protected bullets and yaw switch values come from the game build
 * (valorant-api.com, release-13.06) cross-checked with wiki.playvalorant.com and the patch notes.
 *
 * Riot has never published per-shot recoil in degrees. The `recoil` curves below are
 * approximations shaped to the published structure (deterministic opening, protected bullets,
 * yaw switch chance/time, bullet at which spread peaks) and to community spray descriptions.
 * Recovery times marked `// est.` were never published and are estimates.
 *
 * Units: rounds per second, seconds, meters, m/s, degrees.
 */

export type WeaponId =
  | 'classic'
  | 'shorty'
  | 'frenzy'
  | 'ghost'
  | 'bandit'
  | 'sheriff'
  | 'stinger'
  | 'spectre'
  | 'bucky'
  | 'judge'
  | 'bulldog'
  | 'guardian'
  | 'phantom'
  | 'vandal'
  | 'warden'
  | 'marshal'
  | 'outlaw'
  | 'operator'
  | 'ares'
  | 'odin'
  | 'knife';

export type WeaponCategory = 'sidearm' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy' | 'melee';
export type Penetration = 'low' | 'medium' | 'high';
export type HitRegion = 'head' | 'body' | 'leg';

export interface DamageBand {
  /** Upper bound of this band in meters; the last band extends forever. */
  until: number;
  head: number;
  body: number;
  leg: number;
}

/** Degrees of error added while moving. */
export interface MoveError {
  crouchWalk: number;
  walk: number;
  run: number;
  air: number;
}

export interface Recoil {
  /** Vertical camera kick in degrees after each shot of a spray. The last value repeats. */
  pitch: readonly number[];
  maxPitch: number;
  /** Horizontal kick per shot in degrees once the climb tops out. */
  yaw: number;
  maxYaw: number;
  /** Bullets fired before horizontal recoil is allowed to switch side. */
  protectedBullets: number;
  yawSwitchChance: number;
  /** Seconds a side switch takes to blend over. */
  yawSwitchTime: number;
}

export interface AltFire {
  /** ads/scope: zoom with different spread; burst: zoomed burst fire; shotgun: Classic right click. */
  kind: 'ads' | 'scope' | 'burst' | 'shotgun';
  /** Magnification levels. The Operator cycles 2.5x then 5x. */
  zoom: readonly number[];
  /** Shots per second (bursts per second for burst/shotgun). */
  fireRate: number;
  spread: readonly [first: number, max: number];
  moveMult: number;
  burst?: { count: number; rate: number };
  pellets?: number;
  crouchMult?: number;
  moveError?: MoveError;
  recovery?: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  slot: 'primary' | 'secondary' | 'melee';
  cost: number;
  auto: boolean;
  fireRate: number;
  magazine: number;
  reserve: number;
  /** Seconds. Per-shell reloaders list the full reload. */
  reload: number;
  equip: number;
  penetration: Penetration;
  runSpeed: number;
  damage: readonly DamageBand[];
  pellets: number;
  /** Standing hip-fire [first shot, max] error in degrees. */
  spread: readonly [first: number, max: number];
  crouchMult: number;
  moveError: MoveError;
  /** Seconds after the last shot until spread is back to first-shot accuracy. */
  recovery: number;
  /** Shots of build-up before error reaches max. Higher = more forgiving taps. */
  tapEfficiency: number;
  /** Fraction of run speed below which you get full accuracy. */
  deadzone: number;
  /** Vertical recoil multiplier while moving faster than the deadzone. */
  runningRecoilMult: number;
  silenced: boolean;
  recoil: Recoil;
  alt: AltFire | null;
  /** Odin spins up from `from` to `to` rounds/s over `time` seconds of firing. */
  fireRateRamp?: { from: number; to: number; time: number };
  /** Ares: error shrinks (spread[0] -> spread[1]) as you keep firing. */
  spreadTightens?: boolean;
  /** Outlaw reloads one shell faster than two. */
  partialReload?: number;
}

/** Knife run speed; every weapon's run speed is this times a class multiplier. */
export const BASE_RUN_SPEED = 6.75;
export const DEFAULT_DEADZONE = 0.275;
export const ADS_MOVE_MULT = 0.76;
/** Horizontal recoil multiplier for rifles while crouched and still. */
export const CROUCH_STILL_YAW_MULT = 0.85;

const RIFLE_MOVE: MoveError = { crouchWalk: 0.8, walk: 3, run: 6, air: 10 };
const SIDEARM_MOVE: MoveError = { crouchWalk: 0.5, walk: 1.1, run: 2.3, air: 7 };
const SHOTGUN_MOVE: MoveError = { crouchWalk: 0.5, walk: 1, run: 2, air: 4 };
const SNIPER_MOVE: MoveError = { crouchWalk: 7.5, walk: 10, run: 15, air: 20 };
const HEAVY_MOVE: MoveError = { crouchWalk: 0.4, walk: 3, run: 6.5, air: 10 };
const SMG_MOVE: MoveError = { crouchWalk: 0.15, walk: 1, run: 2.5, air: 10 };

function recoil(pitch: number[], maxPitch: number, yaw: number, maxYaw: number, extra: Partial<Recoil> = {}): Recoil {
  return { pitch, maxPitch, yaw, maxYaw, protectedBullets: 4, yawSwitchChance: 0.1, yawSwitchTime: 0.6, ...extra };
}

const one = (head: number, body: number, leg: number): DamageBand[] => [{ until: Infinity, head, body, leg }];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    category: 'sidearm',
    slot: 'secondary',
    cost: 0,
    auto: false,
    fireRate: 6.75,
    magazine: 12,
    reserve: 36,
    reload: 1.75,
    equip: 0.75,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 30, head: 78, body: 26, leg: 22.1 },
      { until: Infinity, head: 66, body: 22, leg: 18.7 },
    ],
    pellets: 1,
    spread: [0.4, 1.8],
    crouchMult: 0.75,
    moveError: SIDEARM_MOVE,
    recovery: 0.3, // est.
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.5, 0.65, 0.75, 0.8], 3.2, 0.25, 1.5),
    alt: {
      kind: 'shotgun',
      zoom: [1],
      fireRate: 2.22,
      spread: [1.9, 5.78],
      moveMult: 1,
      pellets: 3,
      crouchMult: 0.9,
      moveError: { crouchWalk: 0, walk: 0.6, run: 1.5, air: 2.25 },
    },
  },
  shorty: {
    id: 'shorty',
    name: 'Shorty',
    category: 'shotgun',
    slot: 'secondary',
    cost: 300,
    auto: false,
    fireRate: 3.0,
    magazine: 2,
    reserve: 6,
    reload: 1.75,
    equip: 0.75,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: [
      { until: 7, head: 22, body: 11, leg: 9.35 },
      { until: 15, head: 12, body: 6, leg: 5.1 },
      { until: Infinity, head: 6, body: 3, leg: 2.55 },
    ],
    pellets: 15,
    spread: [4.0, 4.0],
    crouchMult: 0.85,
    moveError: SHOTGUN_MOVE,
    recovery: 0.4, // est.
    tapEfficiency: 2,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([2.5], 5, 0.3, 1),
    alt: null,
  },
  frenzy: {
    id: 'frenzy',
    name: 'Frenzy',
    category: 'sidearm',
    slot: 'secondary',
    cost: 450,
    auto: true,
    fireRate: 10,
    magazine: 15,
    reserve: 45,
    reload: 1.5,
    equip: 1.0,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 20, head: 78, body: 26, leg: 22.1 },
      { until: Infinity, head: 63, body: 21, leg: 17.85 },
    ],
    pellets: 1,
    spread: [0.65, 1.7],
    crouchMult: 0.85,
    moveError: { crouchWalk: 0.5, walk: 0.8, run: 2, air: 7 },
    recovery: 0.3, // est.
    tapEfficiency: 5,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1.5,
    silenced: false,
    recoil: recoil([0.35, 0.5, 0.6, 0.5, 0.3, 0.1], 2.4, 0.35, 2.0),
    alt: null,
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    category: 'sidearm',
    slot: 'secondary',
    cost: 500,
    auto: false,
    fireRate: 6.75,
    magazine: 13,
    reserve: 39,
    reload: 1.5,
    equip: 0.75,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 30, head: 105, body: 30, leg: 25.5 },
      { until: Infinity, head: 87.5, body: 25, leg: 21.25 },
    ],
    pellets: 1,
    spread: [0.3, 1.65],
    crouchMult: 0.75,
    moveError: SIDEARM_MOVE,
    recovery: 0.3, // est.
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: true,
    recoil: recoil([0.55, 0.7, 0.8, 0.85], 3.6, 0.25, 1.5),
    alt: null,
  },
  bandit: {
    id: 'bandit',
    name: 'Bandit',
    category: 'sidearm',
    slot: 'secondary',
    cost: 600,
    auto: false,
    fireRate: 5.1,
    magazine: 8,
    reserve: 24,
    reload: 1.5,
    equip: 0.75,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 10, head: 152, body: 39, leg: 33 },
      { until: 30, head: 128, body: 39, leg: 33 },
      { until: Infinity, head: 112, body: 34, leg: 28 },
    ],
    pellets: 1,
    spread: [0.275, 1.97],
    crouchMult: 0.75,
    moveError: { crouchWalk: 0.5, walk: 1.2, run: 2.7, air: 7 },
    recovery: 0.4,
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.8, 0.9, 1.0], 3, 0.25, 1.2),
    alt: null,
  },
  sheriff: {
    id: 'sheriff',
    name: 'Sheriff',
    category: 'sidearm',
    slot: 'secondary',
    cost: 800,
    auto: false,
    fireRate: 4,
    magazine: 6,
    reserve: 24,
    reload: 2.25,
    equip: 1.0,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: [
      { until: 30, head: 159.5, body: 55, leg: 46.75 },
      { until: Infinity, head: 145, body: 50, leg: 42.5 },
    ],
    pellets: 1,
    spread: [0.25, 2.75],
    crouchMult: 0.75,
    moveError: { crouchWalk: 0.5, walk: 1.2, run: 3, air: 7 },
    recovery: 0.5, // est.
    tapEfficiency: 3,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([2.2, 2.4, 2.6], 7, 0.4, 2),
    alt: null,
  },
  stinger: {
    id: 'stinger',
    name: 'Stinger',
    category: 'smg',
    slot: 'primary',
    cost: 1100,
    auto: true,
    fireRate: 16,
    magazine: 20,
    reserve: 60,
    reload: 2.25,
    equip: 0.75,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 15, head: 67.5, body: 27, leg: 22.95 },
      { until: Infinity, head: 57, body: 23, leg: 19 },
    ],
    pellets: 1,
    spread: [0.65, 1.5],
    crouchMult: 0.85,
    moveError: SMG_MOVE,
    recovery: 0.4,
    tapEfficiency: 6,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.1, 0.12, 0.45, 0.6, 0.6, 0.5, 0.35, 0.2], 3.4, 0.3, 2.4),
    alt: {
      kind: 'burst',
      zoom: [1.15],
      fireRate: 2.118,
      spread: [0.35, 2.74],
      moveMult: ADS_MOVE_MULT,
      burst: { count: 4, rate: 18 },
      crouchMult: 0.75,
      recovery: 0.4,
    },
  },
  spectre: {
    id: 'spectre',
    name: 'Spectre',
    category: 'smg',
    slot: 'primary',
    cost: 1600,
    auto: true,
    fireRate: 13.333,
    magazine: 30,
    reserve: 90,
    reload: 2.25,
    equip: 0.75,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.85,
    damage: [
      { until: 15, head: 78, body: 26, leg: 22.1 },
      { until: 30, head: 66, body: 22, leg: 18.7 },
      { until: Infinity, head: 60, body: 20, leg: 17 },
    ],
    pellets: 1,
    spread: [0.4, 1.3],
    crouchMult: 0.85,
    moveError: SMG_MOVE,
    recovery: 0.3, // est.
    tapEfficiency: 3,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1.8,
    silenced: true,
    recoil: recoil([0.18, 0.25, 0.32, 0.38, 0.4, 0.38, 0.32, 0.25, 0.15], 2.8, 0.28, 2.2, {
      protectedBullets: 5,
      yawSwitchTime: 0.28,
    }),
    alt: { kind: 'ads', zoom: [1.15], fireRate: 12, spread: [0.25, 1.25], moveMult: ADS_MOVE_MULT },
  },
  bucky: {
    id: 'bucky',
    name: 'Bucky',
    category: 'shotgun',
    slot: 'primary',
    cost: 850,
    auto: false,
    fireRate: 1.1,
    magazine: 5,
    reserve: 10,
    reload: 2.5,
    equip: 1.0,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.75,
    damage: [
      { until: 8, head: 34, body: 17, leg: 14 },
      { until: 12, head: 26, body: 13, leg: 11.05 },
      { until: Infinity, head: 18, body: 9, leg: 7.65 },
    ],
    pellets: 15,
    spread: [3.0, 3.0],
    crouchMult: 0.85,
    moveError: SHOTGUN_MOVE,
    recovery: 0.5, // est.
    tapEfficiency: 1,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([3.0], 6, 0.3, 1),
    alt: null,
  },
  judge: {
    id: 'judge',
    name: 'Judge',
    category: 'shotgun',
    slot: 'primary',
    cost: 1850,
    auto: true,
    fireRate: 3.5,
    magazine: 5,
    reserve: 15,
    reload: 2.2,
    equip: 1.0,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED * 0.75,
    damage: [
      { until: 10, head: 34, body: 17, leg: 14.45 },
      { until: 15, head: 20, body: 10, leg: 8.5 },
      { until: Infinity, head: 14, body: 7, leg: 5.95 },
    ],
    pellets: 12,
    spread: [2.5, 4.0],
    crouchMult: 0.85,
    moveError: SHOTGUN_MOVE,
    recovery: 0.4, // est.
    tapEfficiency: 3,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([1.4, 1.2, 1.0], 5, 0.5, 2),
    alt: null,
  },
  bulldog: {
    id: 'bulldog',
    name: 'Bulldog',
    category: 'rifle',
    slot: 'primary',
    cost: 2050,
    auto: true,
    fireRate: 10,
    magazine: 24,
    reserve: 72,
    reload: 2.5,
    equip: 1.0,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(115.5, 35, 29.75),
    pellets: 1,
    spread: [0.3, 1.25],
    crouchMult: 0.85,
    moveError: RIFLE_MOVE,
    recovery: 0.35,
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.3, 0.45, 0.6, 0.7, 0.7, 0.6, 0.45, 0.2], 4.2, 0.35, 2.8),
    alt: {
      kind: 'burst',
      zoom: [1.25],
      fireRate: 2.105,
      spread: [0.3, 1.5],
      moveMult: ADS_MOVE_MULT,
      burst: { count: 3, rate: 13.333 },
      crouchMult: 0.75,
      recovery: 0.35,
    },
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    category: 'rifle',
    slot: 'primary',
    cost: 2250,
    auto: false,
    fireRate: 5.25,
    magazine: 12,
    reserve: 36,
    reload: 2.5,
    equip: 1.0,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(195, 65, 48.75),
    pellets: 1,
    spread: [0.1, 1.58],
    crouchMult: 0.85,
    moveError: RIFLE_MOVE,
    recovery: 0.35,
    tapEfficiency: 3,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.9, 1.0, 1.1, 1.1], 4.5, 0.25, 1.5),
    alt: { kind: 'ads', zoom: [1.5], fireRate: 5.25, spread: [0, 1.48], moveMult: ADS_MOVE_MULT },
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    category: 'rifle',
    slot: 'primary',
    cost: 2900,
    auto: true,
    fireRate: 11,
    magazine: 30,
    reserve: 60,
    reload: 2.5,
    equip: 1.0,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: [
      { until: 20, head: 156, body: 39, leg: 33.15 },
      { until: Infinity, head: 140, body: 35, leg: 29.75 },
    ],
    pellets: 1,
    spread: [0.2, 0.9],
    crouchMult: 0.85,
    moveError: RIFLE_MOVE,
    recovery: 0.35,
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1.8,
    silenced: true,
    recoil: recoil([0.28, 0.42, 0.55, 0.65, 0.72, 0.75, 0.72, 0.65, 0.55, 0.42, 0.3, 0.12], 6.0, 0.3, 2.6, {
      protectedBullets: 8,
    }),
    alt: { kind: 'ads', zoom: [1.25], fireRate: 9.9, spread: [0.11, 0.91], moveMult: ADS_MOVE_MULT },
  },
  vandal: {
    id: 'vandal',
    name: 'Vandal',
    category: 'rifle',
    slot: 'primary',
    cost: 2900,
    auto: true,
    fireRate: 9.75,
    magazine: 25,
    reserve: 50,
    reload: 2.5,
    equip: 1.0,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(160, 40, 34),
    pellets: 1,
    spread: [0.25, 1.0],
    crouchMult: 0.85,
    moveError: RIFLE_MOVE,
    recovery: 0.375,
    tapEfficiency: 6,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1.8,
    silenced: false,
    recoil: recoil([0.35, 0.55, 0.75, 0.9, 1.0, 1.0, 0.95, 0.85, 0.65, 0.4, 0.15], 7.2, 0.45, 3.5, {
      protectedBullets: 6,
    }),
    alt: { kind: 'ads', zoom: [1.25], fireRate: 8.775, spread: [0.1575, 1.02], moveMult: ADS_MOVE_MULT },
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    category: 'rifle',
    slot: 'primary',
    cost: 2900,
    auto: true,
    fireRate: 6.5,
    magazine: 18,
    reserve: 36,
    reload: 2.5,
    equip: 1.0,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(200, 50, 42),
    pellets: 1,
    spread: [0.15, 1.0],
    crouchMult: 0.85,
    moveError: RIFLE_MOVE,
    recovery: 0.35, // est.
    tapEfficiency: 4,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.6, 0.85, 1.0, 1.0, 0.85, 0.55, 0.25], 5.5, 0.4, 2.5),
    alt: { kind: 'ads', zoom: [2], fireRate: 6.5, spread: [0.04, 1.02], moveMult: ADS_MOVE_MULT },
  },
  marshal: {
    id: 'marshal',
    name: 'Marshal',
    category: 'sniper',
    slot: 'primary',
    cost: 950,
    auto: false,
    fireRate: 1.5,
    magazine: 5,
    reserve: 15,
    reload: 2.5,
    equip: 1.25,
    penetration: 'medium',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(202, 101, 85.85),
    pellets: 1,
    spread: [1.0, 1.0],
    crouchMult: 0.9,
    moveError: SNIPER_MOVE,
    recovery: 0.6, // est.
    tapEfficiency: 1,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([2.5], 4, 0.2, 0.5),
    alt: { kind: 'scope', zoom: [3.5], fireRate: 1.2, spread: [0, 0], moveMult: 0.9 },
  },
  outlaw: {
    id: 'outlaw',
    name: 'Outlaw',
    category: 'sniper',
    slot: 'primary',
    cost: 2400,
    auto: false,
    fireRate: 2.75,
    magazine: 2,
    reserve: 10,
    reload: 3.8,
    partialReload: 2.3,
    equip: 1.25,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.8,
    damage: one(238, 140, 119),
    pellets: 1,
    spread: [3.5, 3.5],
    crouchMult: 0.9,
    moveError: SNIPER_MOVE,
    recovery: 0.15,
    tapEfficiency: 1,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([4.0], 6, 0.2, 0.5),
    alt: { kind: 'scope', zoom: [3.5], fireRate: 2.75, spread: [0, 2.25], moveMult: 0.8 },
  },
  operator: {
    id: 'operator',
    name: 'Operator',
    category: 'sniper',
    slot: 'primary',
    cost: 4700,
    auto: false,
    fireRate: 0.6,
    magazine: 5,
    reserve: 10,
    reload: 3.7,
    equip: 1.5,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.76,
    damage: one(255, 150, 120),
    pellets: 1,
    spread: [5.0, 5.0],
    crouchMult: 0.9,
    moveError: { crouchWalk: 7.5, walk: 10, run: 15, air: 15 },
    recovery: 1.0, // est.
    tapEfficiency: 1,
    deadzone: 0.15,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([4.0], 6, 0.2, 0.5),
    alt: { kind: 'scope', zoom: [2.5, 5], fireRate: 0.6, spread: [0, 0], moveMult: 0.72 },
  },
  ares: {
    id: 'ares',
    name: 'Ares',
    category: 'heavy',
    slot: 'primary',
    cost: 1600,
    auto: true,
    fireRate: 13,
    magazine: 50,
    reserve: 100,
    reload: 3.25,
    equip: 1.25,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.76,
    damage: [
      { until: 30, head: 75, body: 30, leg: 25.5 },
      { until: Infinity, head: 70, body: 28, leg: 23.8 },
    ],
    pellets: 1,
    spread: [1.0, 0.7],
    spreadTightens: true,
    crouchMult: 0.6,
    moveError: HEAVY_MOVE,
    recovery: 0.4, // est.
    tapEfficiency: 13,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.2, 0.28, 0.32, 0.3, 0.25, 0.18, 0.1], 2.2, 0.25, 2.0),
    alt: { kind: 'ads', zoom: [1.15], fireRate: 13, spread: [0.9, 0.55], moveMult: ADS_MOVE_MULT },
  },
  odin: {
    id: 'odin',
    name: 'Odin',
    category: 'heavy',
    slot: 'primary',
    cost: 3200,
    auto: true,
    fireRate: 12,
    fireRateRamp: { from: 12, to: 15.6, time: 1.0 }, // ramp time unpublished, est.
    magazine: 100,
    reserve: 200,
    reload: 5.0,
    equip: 1.25,
    penetration: 'high',
    runSpeed: BASE_RUN_SPEED * 0.76,
    damage: [
      { until: 30, head: 95, body: 38, leg: 32.3 },
      { until: Infinity, head: 77.5, body: 31, leg: 26.35 },
    ],
    pellets: 1,
    spread: [0.8, 1.3],
    crouchMult: 0.6,
    moveError: HEAVY_MOVE,
    recovery: 0.4, // est.
    tapEfficiency: 6,
    deadzone: DEFAULT_DEADZONE,
    runningRecoilMult: 1,
    silenced: false,
    recoil: recoil([0.22, 0.3, 0.36, 0.36, 0.3, 0.22, 0.14, 0.08], 2.6, 0.18, 1.6, { protectedBullets: 8 }),
    alt: { kind: 'ads', zoom: [1.15], fireRate: 15.6, spread: [0.79, 1.36], moveMult: ADS_MOVE_MULT },
  },
  knife: {
    id: 'knife',
    name: 'Tactical Knife',
    category: 'melee',
    slot: 'melee',
    cost: 0,
    auto: true,
    fireRate: 2.2, // est. swing cadence of the primary combo
    magazine: 0,
    reserve: 0,
    reload: 0,
    equip: 0.6,
    penetration: 'low',
    runSpeed: BASE_RUN_SPEED,
    damage: one(50, 50, 50), // 50 front / 100 back
    pellets: 1,
    spread: [0, 0],
    crouchMult: 1,
    moveError: { crouchWalk: 0, walk: 0, run: 0, air: 0 },
    recovery: 0,
    tapEfficiency: 1,
    deadzone: 1,
    runningRecoilMult: 1,
    silenced: true,
    recoil: recoil([0], 0, 0, 0),
    alt: null,
  },
};

export const PRIMARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === 'primary');
export const SECONDARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === 'secondary');

/** Knife reach in meters (est.). Backstabs double damage. */
export const KNIFE_RANGE = 2.0;

/** Damage for one bullet/pellet. VALORANT rounds fractional damage down (159.5 -> 159). */
export function damageAt(def: WeaponDef, distance: number, region: HitRegion): number {
  const band = def.damage.find((b) => distance <= b.until) ?? def.damage[def.damage.length - 1];
  return Math.floor(band[region]);
}

/** Seconds between shots for the current mode. */
export function fireInterval(def: WeaponDef, zoomed: boolean): number {
  const rate = zoomed && def.alt && (def.alt.kind === 'ads' || def.alt.kind === 'scope') ? def.alt.fireRate : def.fireRate;
  return 1 / rate;
}

/** Shots to kill a target with the given total health (HP + shields) at a distance. */
export function shotsToKill(def: WeaponDef, distance: number, region: HitRegion, totalHealth: number): number {
  const dmg = damageAt(def, distance, region) * def.pellets;
  return dmg > 0 ? Math.ceil(totalHealth / dmg) : Infinity;
}
