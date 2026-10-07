import type { WeaponDef } from '../config/weapons';
import { TAG_LABELS, type RunStats } from '../game/stats';
import type { SpotTag } from '../world/layout';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function fmtMs(s: number | null): string {
  return s === null ? '-' : `${Math.round(s * 1000)} ms`;
}

/** In-game overlay: vitals, ammo, timer, kill feed, damage direction, scope, live stats. */
export class Hud {
  readonly root: HTMLElement;
  private health: HTMLElement;
  private shield: HTMLElement;
  private healthBar: HTMLElement;
  private ammo: HTMLElement;
  private reserve: HTMLElement;
  private weapon: HTMLElement;
  private reloadBar: HTMLElement;
  private timer: HTMLElement;
  private room: HTMLElement;
  private kills: HTMLElement;
  private feed: HTMLElement;
  private damage: HTMLElement;
  private vignette: HTMLElement;
  private scope: HTMLElement;
  private live: HTMLElement;
  private fps: HTMLElement;
  private banner: HTMLElement;
  private toast: HTMLElement;
  private bannerTimer = 0;
  private toastTimer = 0;
  private vignetteLevel = 0;
  private indicators: { el: HTMLElement; life: number; yaw: number }[] = [];
  private feedRows: { el: HTMLElement; age: number }[] = [];
  /** Last values written, so per-frame updates only touch the DOM when something changed. */
  private cache = new Map<string, string>();

  private changed(key: string, value: string): boolean {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value);
    return true;
  }

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'hud-vignette', this.root);
    this.scope = el('div', 'hud-scope', this.root);
    el('div', 'hud-scope-ring', this.scope);
    el('div', 'hud-scope-h', this.scope);
    el('div', 'hud-scope-v', this.scope);
    this.damage = el('div', 'hud-damage', this.root);

    const top = el('div', 'hud-top', this.root);
    this.kills = el('div', 'hud-top-kills', top, '0');
    const mid = el('div', 'hud-top-mid', top);
    this.timer = el('div', 'hud-timer', mid, '0:00');
    this.room = el('div', 'hud-room', mid, 'ROOM 0');
    el('div', 'hud-top-label', top, 'KILLS');

    this.feed = el('div', 'hud-feed', this.root);
    this.live = el('div', 'hud-live', this.root);
    this.fps = el('div', 'hud-fps', this.root);

    const vit = el('div', 'hud-vitals', this.root);
    const sh = el('div', 'hud-shield', vit);
    el('span', 'hud-shield-icon', sh);
    this.shield = el('span', 'hud-shield-num', sh, '50');
    const hp = el('div', 'hud-health', vit);
    this.health = el('span', 'hud-health-num', hp, '100');
    const bar = el('div', 'hud-health-bar', hp);
    this.healthBar = el('div', 'hud-health-fill', bar);

    const am = el('div', 'hud-ammo', this.root);
    const row = el('div', 'hud-ammo-row', am);
    this.ammo = el('span', 'hud-ammo-num', row, '25');
    this.reserve = el('span', 'hud-ammo-reserve', row, '50');
    this.weapon = el('div', 'hud-weapon', am, 'VANDAL');
    const rb = el('div', 'hud-reload', am);
    this.reloadBar = el('div', 'hud-reload-fill', rb);

    this.banner = el('div', 'hud-banner', this.root);
    this.toast = el('div', 'hud-toast', this.root);
  }

  show(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  setVitals(health: number, shield: number): void {
    // VALORANT shows whole numbers; never show 0 while alive.
    const h = health > 0 ? Math.max(1, Math.floor(health)) : 0;
    if (!this.changed('vitals', `${h}|${Math.ceil(shield)}|${health.toFixed(1)}`)) return;
    this.health.textContent = String(h);
    this.shield.textContent = String(Math.ceil(shield));
    this.shield.parentElement!.classList.toggle('empty', shield <= 0.01);
    this.healthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
    this.health.parentElement!.classList.toggle('low', health < 40);
  }

  setAmmo(def: WeaponDef, ammo: number, reserve: number, reloadProgress: number | null, name = def.name): void {
    if (!this.changed('ammo', `${name}|${ammo}|${reserve}|${reloadProgress === null ? '' : reloadProgress.toFixed(2)}`)) return;
    const melee = def.category === 'melee';
    this.ammo.textContent = melee ? '' : String(ammo);
    this.reserve.textContent = melee ? '' : String(reserve);
    this.weapon.textContent = name.toUpperCase();
    this.ammo.classList.toggle('low', !melee && ammo <= Math.ceil(def.magazine * 0.2));
    const rb = this.reloadBar.parentElement!;
    rb.style.visibility = reloadProgress === null ? 'hidden' : 'visible';
    if (reloadProgress !== null) this.reloadBar.style.width = `${Math.round(reloadProgress * 100)}%`;
  }

  setTop(seconds: number, room: number, kills: number): void {
    if (!this.changed('top', `${fmtTime(seconds)}|${room}|${kills}`)) return;
    this.timer.textContent = fmtTime(seconds);
    this.room.textContent = `ROOM ${room}`;
    this.kills.textContent = String(kills);
  }

  setFps(fps: number | null): void {
    if (!this.changed('fps', fps === null ? 'off' : String(Math.round(fps)))) return;
    this.fps.style.display = fps === null ? 'none' : '';
    if (fps !== null) this.fps.textContent = `${Math.round(fps)} FPS`;
  }

  setLive(stats: RunStats | null, last: { ttk: number | null; placement: number | null; tag: SpotTag | null }): void {
    if (!stats) {
      if (this.changed('live', 'hidden')) this.live.style.display = 'none';
      return;
    }
    this.live.style.display = '';
    const pl = last.placement === null ? '-' : `${last.placement.toFixed(1)}°`;
    const mp = stats.medianPlacement;
    const html =
      `<div><b>Last kill</b> ${fmtMs(last.ttk)}${last.tag ? ` <i>${TAG_LABELS[last.tag]}</i>` : ''}</div>` +
      `<div><b>Crosshair off head</b> ${pl}</div>` +
      `<div><b>Median TTK</b> ${fmtMs(stats.medianTtk)}</div>` +
      `<div><b>Median placement</b> ${mp === null ? '-' : `${mp.toFixed(1)}°`}</div>` +
      `<div><b>HS%</b> ${Math.round(stats.headshotRate * 100)}% · <b>Acc</b> ${Math.round(stats.accuracy * 100)}%</div>`;
    if (this.changed('live', html)) this.live.innerHTML = html;
  }

  killFeed(weapon: string, headshot: boolean, label: string): void {
    const row = el('div', 'hud-feed-row', undefined);
    row.innerHTML = `<span class="you">YOU</span><span class="gun">${weapon.toUpperCase()}</span>${headshot ? '<span class="hs" title="Headshot"></span>' : ''}<span class="bot">${label}</span>`;
    this.feed.prepend(row);
    this.feedRows.unshift({ el: row, age: 0 });
    while (this.feedRows.length > 5) this.feedRows.pop()!.el.remove();
  }

  /** Damage arrow pointing toward the shooter. `relYaw` is radians relative to view (0 = ahead). */
  hitFrom(relYaw: number): void {
    const d = el('div', 'hud-indicator', this.damage);
    this.indicators.push({ el: d, life: 1.4, yaw: relYaw });
    this.vignetteLevel = Math.min(1, this.vignetteLevel + 0.55);
  }

  flashKillBanner(text: string, headshot: boolean): void {
    this.banner.textContent = text;
    this.banner.classList.toggle('hs', headshot);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = 1.1;
  }

  showToast(text: string, seconds = 2.5): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  setScope(on: boolean): void {
    this.scope.style.display = on ? 'block' : 'none';
  }

  update(dt: number): void {
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.4);
    this.vignette.style.opacity = String(this.vignetteLevel);
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      const ind = this.indicators[i];
      ind.life -= dt;
      ind.el.style.opacity = String(Math.min(1, ind.life));
      ind.el.style.transform = `translate(-50%, -50%) rotate(${-ind.yaw}rad) translateY(-120px)`;
      if (ind.life <= 0) {
        ind.el.remove();
        this.indicators.splice(i, 1);
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    // Kill feed rows fade after 4.5 s and go at 5.2 s (game time, so pausing holds them).
    for (let i = this.feedRows.length - 1; i >= 0; i--) {
      const row = this.feedRows[i];
      row.age += dt;
      if (row.age >= 4.5) row.el.classList.add('fade');
      if (row.age >= 5.2) {
        row.el.remove();
        this.feedRows.splice(i, 1);
      }
    }
  }

  /** Keep damage indicators pointing at the shooter as you turn (turning left by d moves them right by d). */
  rotateIndicators(deltaYaw: number): void {
    for (const ind of this.indicators) ind.yaw -= deltaYaw;
  }

  clear(): void {
    this.cache.clear();
    this.feed.innerHTML = '';
    this.feedRows = [];
    for (const i of this.indicators) i.el.remove();
    this.indicators = [];
    this.vignetteLevel = 0;
    this.banner.classList.remove('show');
  }
}
