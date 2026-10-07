import type { WeaponDef } from '../config/weapons';

/**
 * Synthesized sound effects (Web Audio, no samples). Bot gunfire and footsteps are positional
 * (HRTF) so you can hear where a shot came from.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  private lastKillAt = 0;
  private killStreak = 0;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Listener pose: position and forward vector (yaw/pitch already applied). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private out(pos?: { x: number; y: number; z: number }): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, rate = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private tone(dest: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  gunshot(def: WeaponDef, pos?: { x: number; y: number; z: number }, volume = 1): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    const v = volume * (pos ? 1.4 : 1);
    const c = def.category;
    if (c === 'melee') {
      this.noiseBurst(dest, t, 0.12, 'bandpass', 2400, 0.8, 0.25 * v, 0.6);
      return;
    }
    if (def.silenced) {
      this.noiseBurst(dest, t, 0.07, 'lowpass', 1400, 0.7, 0.55 * v);
      this.noiseBurst(dest, t, 0.03, 'bandpass', 3800, 1.5, 0.25 * v);
      this.tone(dest, t, 0.07, 'sine', 160, 60, 0.35 * v);
      return;
    }
    const heavy = c === 'sniper' || def.id === 'sheriff' || def.id === 'outlaw';
    const small = c === 'sidearm' || c === 'smg';
    this.noiseBurst(dest, t, small ? 0.06 : 0.09, 'highpass', 2600, 0.7, 0.45 * v);
    this.noiseBurst(dest, t, heavy ? 0.45 : small ? 0.14 : 0.22, 'bandpass', heavy ? 700 : 1100, 0.9, (heavy ? 0.9 : 0.7) * v);
    this.tone(dest, t, heavy ? 0.3 : 0.14, 'sine', heavy ? 120 : 150, 45, (heavy ? 0.9 : 0.6) * v);
    if (heavy) this.noiseBurst(dest, t + 0.03, 0.6, 'lowpass', 500, 0.5, 0.25 * v);
  }

  /** The bright "tink" of a headshot. */
  headshot(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 0.22, 'sine', 2350, 2250, 0.32);
    this.tone(dest, t, 0.16, 'sine', 3520, 3400, 0.16);
    this.tone(dest, t, 0.09, 'triangle', 5100, 4800, 0.07);
    this.noiseBurst(dest, t, 0.02, 'highpass', 6000, 0.7, 0.2);
  }

  bodyHit(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.06, 'lowpass', 600, 0.8, 0.35);
    this.tone(dest, t, 0.07, 'sine', 210, 120, 0.3);
  }

  kill(headshot: boolean): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.killStreak = t - this.lastKillAt < 3 ? Math.min(5, this.killStreak + 1) : 1;
    this.lastKillAt = t;
    const base = 520 * Math.pow(1.12, this.killStreak - 1);
    this.tone(dest, t + 0.02, 0.18, 'triangle', base, base * 1.01, 0.22);
    this.tone(dest, t + 0.09, 0.26, 'triangle', base * 1.5, base * 1.51, 0.2);
    if (headshot) this.tone(dest, t + 0.09, 0.3, 'sine', base * 3, base * 3.02, 0.08);
  }

  footstep(pos?: { x: number; y: number; z: number }, volume = 1): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.05, 'lowpass', 900 + Math.random() * 400, 0.9, 0.28 * volume, 0.8 + Math.random() * 0.3);
    this.tone(dest, t, 0.04, 'sine', 95, 60, 0.12 * volume);
  }

  land(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.09, 'lowpass', 700, 0.8, 0.4);
    this.tone(dest, t, 0.08, 'sine', 80, 50, 0.3);
  }

  reload(duration: number): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t + duration * 0.2, 0.04, 'bandpass', 1800, 2, 0.25);
    this.noiseBurst(dest, t + duration * 0.62, 0.05, 'bandpass', 1300, 2, 0.3);
    this.noiseBurst(dest, t + duration * 0.85, 0.035, 'bandpass', 2600, 2, 0.25);
  }

  equip(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    this.noiseBurst(dest, this.ctx.currentTime, 0.05, 'bandpass', 2000, 2, 0.2);
  }

  dryFire(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    this.noiseBurst(dest, this.ctx.currentTime, 0.02, 'bandpass', 3000, 3, 0.2);
  }

  hurt(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 0.16, 'sine', 120, 60, 0.45);
    this.noiseBurst(dest, t, 0.08, 'lowpass', 500, 0.8, 0.3);
  }

  /** Bullet passing close by: a short whip. */
  whiz(pos: { x: number; y: number; z: number }): void {
    const dest = this.out(pos);
    if (!dest || !this.ctx) return;
    this.noiseBurst(dest, this.ctx.currentTime, 0.08, 'bandpass', 3200, 1.2, 0.18);
  }

  /** Balisong latch/handle click: a bright metallic tick with a short ring. */
  balisongClick(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.018, 'bandpass', 4200 + Math.random() * 900, 4, 0.32);
    this.tone(dest, t, 0.05, 'triangle', 3100 + Math.random() * 300, 2900, 0.06);
  }

  /** Knife slash: a filtered whoosh that sweeps up, plus a faint shimmer for glowing blades. */
  swing(heavy: boolean, glowing: boolean): void {
    const ctx = this.ctx;
    const dest = this.out();
    if (!dest || !ctx || !this.noise) return;
    const t = ctx.currentTime;
    const dur = heavy ? 0.26 : 0.18;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(heavy ? 1800 : 2600, t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.5 : 0.38, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    if (glowing) {
      this.tone(dest, t + 0.02, dur, 'sine', 880, 1320, 0.035);
      this.tone(dest, t + 0.02, dur, 'sine', 1320, 1980, 0.02);
    }
  }

  ui(): void {
    const dest = this.out();
    if (!dest || !this.ctx) return;
    this.tone(dest, this.ctx.currentTime, 0.05, 'sine', 900, 1100, 0.08);
  }
}
