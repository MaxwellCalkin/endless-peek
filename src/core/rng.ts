/**
 * Small, fast, seedable PRNG (mulberry32). Everything random in level generation goes
 * through one of these so a seed reproduces the exact same hallway.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number {
    return Math.min(maxInclusive, Math.floor(this.range(min, maxInclusive + 1)));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list');
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += Math.max(0, w);
    if (total <= 0) return items[0][0];
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= Math.max(0, w);
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Normally distributed sample (Box-Muller). */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Derive an independent generator, e.g. one per hallway segment. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
