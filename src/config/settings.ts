import type { Difficulty } from '../bots/bot';
import type { ArmorKind } from './agent';
import type { WeaponId } from './weapons';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'fire'
  | 'alt'
  | 'reload'
  | 'primary'
  | 'secondary'
  | 'melee'
  | 'restart'
  | 'stats';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  walk: 'Walk',
  crouch: 'Crouch',
  jump: 'Jump',
  fire: 'Fire',
  alt: 'Alt fire / ADS',
  reload: 'Reload',
  primary: 'Primary weapon',
  secondary: 'Secondary weapon',
  melee: 'Knife',
  restart: 'Restart run',
  stats: 'Show stats',
};

/** VALORANT default binds. Values are KeyboardEvent.code, or Mouse0..Mouse4 / WheelUp / WheelDown. */
export const DEFAULT_BINDS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  walk: 'ShiftLeft',
  crouch: 'ControlLeft',
  jump: 'Space',
  fire: 'Mouse0',
  alt: 'Mouse2',
  reload: 'KeyR',
  primary: 'Digit1',
  secondary: 'Digit2',
  melee: 'Digit3',
  restart: 'KeyP',
  stats: 'Tab',
};

export type Density = 'low' | 'normal' | 'high';

export interface Settings {
  sensitivity: number;
  scopedMultiplier: number;
  invertY: boolean;
  rawInput: boolean;
  dpi: number;
  adsHold: boolean;
  scopeHold: boolean;
  walkToggle: boolean;
  crouchToggle: boolean;
  binds: Record<Action, string>;
  crosshairCode: string;
  mode: 'survival' | 'practice';
  primary: WeaponId;
  secondary: WeaponId;
  difficulty: Difficulty;
  botsShoot: boolean;
  botArmor: ArmorKind;
  playerArmor: ArmorKind;
  density: Density;
  healBetweenRooms: boolean;
  showHitboxes: boolean;
  showStatsPanel: boolean;
  aspectMode: 'letterbox' | 'stretch';
  renderScale: number;
  antialias: boolean;
  shadows: boolean;
  showFps: boolean;
  enemyHighlight: 'red' | 'yellow' | 'purple';
  fullscreenOnPlay: boolean;
  volume: number;
  seed: string;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.4,
  scopedMultiplier: 1,
  invertY: false,
  rawInput: true,
  dpi: 800,
  adsHold: true,
  scopeHold: false,
  walkToggle: false,
  crouchToggle: false,
  binds: { ...DEFAULT_BINDS },
  crosshairCode: '0',
  mode: 'survival',
  primary: 'vandal',
  secondary: 'classic',
  difficulty: 'hard',
  botsShoot: true,
  botArmor: 'heavy',
  playerArmor: 'heavy',
  density: 'normal',
  healBetweenRooms: true,
  showHitboxes: false,
  showStatsPanel: true,
  aspectMode: 'letterbox',
  renderScale: 1,
  antialias: true,
  shadows: true,
  showFps: true,
  enemyHighlight: 'red',
  fullscreenOnPlay: true,
  volume: 0.6,
  seed: '',
};

export const ENEMY_HIGHLIGHT: Record<Settings['enemyHighlight'], string> = {
  red: '#ff3c3c',
  yellow: '#f5ea3a',
  purple: '#c25bff',
};

const KEY = 'endless-peek.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULT_SETTINGS), ...parsed, binds: { ...DEFAULT_BINDS, ...(parsed.binds ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); settings then last for the session only.
  }
}

const BEST_KEY = 'endless-peek.best.v1';

export interface BestRun {
  rooms: number;
  kills: number;
  difficulty: Difficulty;
  date: string;
}

export function loadBest(): Partial<Record<Difficulty, BestRun>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveBest(best: Partial<Record<Difficulty, BestRun>>): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // ignore
  }
}

export function bindLabel(code: string): string {
  if (code.startsWith('Mouse')) return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? code;
  if (code === 'WheelUp') return 'Wheel Up';
  if (code === 'WheelDown') return 'Wheel Down';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', 'L ').replace('Right', 'R ').replace('Control', 'Ctrl').trim();
}
