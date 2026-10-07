import type { SpotTag } from '../world/layout';

/** One finished encounter with a bot, for the end-of-run breakdown. */
export interface Encounter {
  tag: SpotTag;
  /** Seconds from the bot first being on your screen to its death (null if it never died). */
  ttk: number | null;
  /** Degrees between your crosshair and its head when it first appeared. */
  placement: number | null;
  /** Did you see it before it saw you? */
  sawFirst: boolean | null;
  headshot: boolean;
  distance: number;
}

export interface DeathRecap {
  tag: SpotTag;
  /** Seconds the bot needed to react to you. */
  reaction: number;
  /** Seconds between the bot seeing you and you dying. */
  exposed: number;
  /** Did you have it on screen before it saw you? */
  youSawFirst: boolean;
  /** How far your crosshair was from its head when it appeared (null if you never saw it). */
  placement: number | null;
  distance: number;
  region: 'head' | 'body' | 'leg';
}

export class RunStats {
  startedAt = 0;
  endedAt: number | null = null;
  kills = 0;
  headshotKills = 0;
  shots = 0;
  hits = 0;
  headHits = 0;
  bodyHits = 0;
  legHits = 0;
  damageDealt = 0;
  damageTaken = 0;
  deaths = 0;
  rooms = 0;
  encounters: Encounter[] = [];
  death: DeathRecap | null = null;

  reset(now: number): void {
    Object.assign(this, new RunStats());
    this.startedAt = now;
  }

  get accuracy(): number {
    return this.shots ? this.hits / this.shots : 0;
  }

  get headshotRate(): number {
    return this.hits ? this.headHits / this.hits : 0;
  }

  duration(now: number): number {
    return (this.endedAt ?? now) - this.startedAt;
  }

  private killed(): Encounter[] {
    return this.encounters.filter((e) => e.ttk !== null);
  }

  get medianTtk(): number | null {
    return median(this.killed().map((e) => e.ttk!));
  }

  get medianPlacement(): number | null {
    return median(this.encounters.filter((e) => e.placement !== null).map((e) => e.placement!));
  }

  get sawFirstRate(): number | null {
    const known = this.encounters.filter((e) => e.sawFirst !== null);
    return known.length ? known.filter((e) => e.sawFirst).length / known.length : null;
  }

  /** Weakest angle type by median time-to-kill (needs a few samples). */
  weakestAngle(): { tag: SpotTag; ttk: number } | null {
    const by = new Map<SpotTag, number[]>();
    for (const e of this.killed()) {
      const list = by.get(e.tag) ?? [];
      list.push(e.ttk!);
      by.set(e.tag, list);
    }
    let worst: { tag: SpotTag; ttk: number } | null = null;
    for (const [tag, list] of by) {
      if (list.length < 2) continue;
      const m = median(list)!;
      if (!worst || m > worst.ttk) worst = { tag, ttk: m };
    }
    return worst;
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** How a death recap names the angle: "killed from ___". */
export const TAG_PHRASES: Record<SpotTag, string> = {
  alcove: 'an alcove',
  'corner-close': 'a close corner by the door',
  'corner-far': 'a far corner',
  crate: 'behind cover',
  'crate-edge': 'the edge of cover',
  pillar: 'behind a pillar',
  high: 'high ground',
  long: 'a long angle',
  tight: 'a tight corner',
  deep: 'a deep corner',
  exit: 'beside the far doorway',
};

export const TAG_LABELS: Record<SpotTag, string> = {
  alcove: 'Alcove',
  'corner-close': 'Close corner',
  'corner-far': 'Far corner',
  crate: 'Behind cover',
  'crate-edge': 'Off cover edge',
  pillar: 'Pillar',
  high: 'High ground',
  long: 'Long angle',
  tight: 'Tight corner',
  deep: 'Deep corner',
  exit: 'Doorway',
};
