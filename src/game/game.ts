import * as THREE from 'three';
import { Sfx } from '../audio/sfx';
import { Bot, type BotSenses, type BotShot, DIFFICULTIES } from '../bots/bot';
import { AGENT, HITBOXES, applyHit, makeVitals } from '../config/agent';
import {
  type BestRun,
  ENEMY_HIGHLIGHT,
  KNIFE_GLOWS,
  KNIFE_NAMES,
  type Settings,
  loadBest,
  saveBest,
  saveSettings,
} from '../config/settings';
import { KNIFE_RANGE, WEAPONS, type WeaponDef, damageAt, fireInterval } from '../config/weapons';
import { Input } from '../core/input';
import { DEG, angleBetween, angleDelta, applySpread, clamp, viewDir } from '../core/math';
import { Rng, randomSeed } from '../core/rng';
import { ASPECT, degreesPerCount, errorToPixels, frameRect, horizontalFov, verticalFov } from '../core/view';
import { makeRay, rayBox } from '../physics/aabb';
import { CollisionWorld, type Solid } from '../physics/world';
import { Player } from '../player/player';
import { botGeometry, hitboxHelper, makeBodyMaterial, makeOutlineMaterial } from '../render/botModel';
import { Effects } from '../render/effects';
import { LevelMaterials, buildBoxMesh, buildSegmentMesh, disposeGroup } from '../render/levelMesh';
import { THEMES } from '../render/themes';
import { skyTexture } from '../render/textures';
import { Viewmodel } from '../render/viewmodel';
import { CrosshairView } from '../ui/crosshair';
import { type CrosshairConfig, parseCrosshairCode } from '../ui/crosshairCode';
import { Hud } from '../ui/hud';
import { Menus } from '../ui/menus';
import { type Density, Hallway, type Segment } from '../world/hallway';
import { Gun, type MoveSample, type ShotEvent } from '../weapons/gun';
import { Autopilot, DEFAULT_PILOT, type PilotHost, type PilotOptions } from './autopilot';
import { RunStats, TAG_PHRASES } from './stats';

/** VALORANT servers and clients simulate at 128 Hz. */
const TICK = 1 / 128;
/** Seconds after spawning before bots start looking, so a run never opens with a spawn kill. */
const SPAWN_GRACE = 1.5;
/** Practice mode: seconds after a death before bots may hit you again (no instant re-kills). */
const PRACTICE_RESPAWN_GRACE = 1;
const BOT_WEAPON = WEAPONS.vandal;
const DENSITY: Record<Settings['density'], Density> = {
  low: { min: 0, max: 1, emptyChance: 0.25 },
  normal: { min: 1, max: 3, emptyChance: 0.1 },
  high: { min: 2, max: 4, emptyChance: 0 },
};

type Slot = 'primary' | 'secondary' | 'melee';
type State = 'menu' | 'playing' | 'paused' | 'results';

interface BotView {
  bot: Bot;
  root: THREE.Group;
  body: THREE.Mesh;
  outline: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  hitboxes: THREE.Group | null;
}

export interface GameOptions {
  debug: boolean;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(verticalFov(103), ASPECT, 0.03, 400);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private viewmodel: Viewmodel;
  private materials = new LevelMaterials();
  private effects = new Effects();
  private world = new CollisionWorld();
  /** Level plus living bots: what the player's body collides with. */
  private bodyWorld = new CollisionWorld();
  private hallway: Hallway | null = null;
  private segMeshes = new Map<number, THREE.Object3D[]>();
  private bots: Bot[] = [];
  private views = new Map<number, BotView>();
  private player = new Player('heavy');
  private guns: Record<Slot, Gun>;
  private slot: Slot = 'primary';
  private input: Input;
  private sfx = new Sfx();
  private hud: Hud;
  private menus: Menus;
  private crosshair: CrosshairView;
  private crosshairCfg: CrosshairConfig;
  private stats = new RunStats();
  private state: State = 'menu';
  private time = 0;
  private acc = 0;
  private lastFrame = performance.now();
  private rng = new Rng(randomSeed());
  private walkOn = false;
  private crouchOn = false;
  private lastKill: { ttk: number | null; placement: number | null; tag: Bot['tag'] | null } = { ttk: null, placement: null, tag: null };
  private fps = 0;
  private outlineMat: THREE.ShaderMaterial;
  private frame = { x: 0, y: 0, w: 1, h: 1 };
  private lookDX = 0;
  private lookDY = 0;
  private runSettings: Settings;
  private sky: THREE.Texture | null = null;
  private skyTheme = -1;
  /** Debug/test hook: when set, the real-time loop renders but doesn't advance the simulation. */
  private frozen = false;
  /** Practice mode: bot shots are held back until this time after a death. */
  private safeUntil = -Infinity;
  /** Debug-only scripted player (demo recordings). */
  private pilot: Autopilot | null = null;

  constructor(
    container: HTMLElement,
    private settings: Settings,
    private options: GameOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.antialias, stencil: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.viewmodel = new Viewmodel(this.renderer);
    this.viewmodel.setKnife(settings.knifeSkin, KNIFE_GLOWS[settings.knifeGlow]);
    this.viewmodel.onFlipClick = () => this.sfx.balisongClick();

    this.hemi = new THREE.HemisphereLight('#cfe0f5', '#7d7368', 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.effects.group);
    this.scene.fog = new THREE.Fog('#cfe3f5', 60, 160);

    this.outlineMat = makeOutlineMaterial(ENEMY_HIGHLIGHT[settings.enemyHighlight], 1.6);
    this.runSettings = structuredClone(settings);
    this.crosshairCfg = this.parseCrosshair();
    this.guns = this.makeGuns();

    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(container);
    this.crosshair = new CrosshairView(container);
    this.menus = new Menus(
      container,
      settings,
      {
        onPlay: () => void this.play(),
        onResume: () => void this.resume(),
        onRestart: () => void this.restart(),
        onQuit: () => this.quit(),
        onSettings: (s, keys) => this.applySettings(s, keys),
      },
      () => loadBest(),
    );

    this.input.onUnlock = () => {
      if (this.state === 'playing' && !this.options.debug) this.pause();
    };
    this.input.onKey = (code) => this.onKey(code);
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'paused') void this.resume();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    this.hud.show(false);
    this.crosshair.el.style.display = 'none';
    this.resize();
    this.menus.showMain();
    // Render a backdrop hallway behind the main menu.
    this.newRun();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  // ---------------------------------------------------------------- lifecycle

  private makeGuns(): Record<Slot, Gun> {
    const opts = { adsHold: this.settings.adsHold, scopeHold: this.settings.scopeHold, random: () => this.rng.next() };
    return {
      primary: new Gun(WEAPONS[this.runSettings.primary], opts),
      secondary: new Gun(WEAPONS[this.runSettings.secondary], opts),
      melee: new Gun(WEAPONS.knife, opts),
    };
  }

  private parseCrosshair(): CrosshairConfig {
    try {
      return parseCrosshairCode(this.settings.crosshairCode);
    } catch {
      return parseCrosshairCode('0');
    }
  }

  private seed(): number {
    const s = this.runSettings.seed.trim();
    if (!s) return randomSeed();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /** Throw away the current hallway and build a fresh one at spawn. */
  private newRun(): void {
    this.runSettings = structuredClone(this.settings);
    for (const meshes of this.segMeshes.values()) for (const m of meshes) this.removeMesh(m);
    this.segMeshes.clear();
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
    this.bots = [];
    this.world.clear();
    this.bodyWorld.clear();
    this.effects.clearDecals();
    this.hud.clear();

    this.time = 0;
    this.safeUntil = -Infinity;
    this.acc = 0;
    this.stats.reset(0);
    this.lastKill = { ttk: null, placement: null, tag: null };
    const seed = this.seed();
    this.hallway = new Hallway(seed, DENSITY[this.runSettings.density]);
    // Bots, spread and recoil draw from their own stream, so a seed replays the whole run.
    this.rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    for (const seg of this.hallway.start()) this.addSegment(seg);
    const sp = this.hallway.spawnPoint;
    this.player.reset(sp.x, sp.z, sp.yaw, this.runSettings.playerArmor);
    this.guns = this.makeGuns();
    this.slot = 'primary';
    this.guns.primary.equip();
    this.viewmodel.setWeapon(this.guns.primary.def);
    this.viewmodel.onEquip();
    this.walkOn = false;
    this.crouchOn = false;
  }

  private async play(): Promise<void> {
    this.sfx.unlock();
    this.sfx.setVolume(this.settings.volume);
    this.newRun();
    await this.lockAndGo();
  }

  private async restart(): Promise<void> {
    this.sfx.unlock();
    this.newRun();
    await this.lockAndGo();
  }

  private async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.lockAndGo();
  }

  private async lockAndGo(): Promise<void> {
    if (!this.options.debug) {
      // Ask for the mouse first: entering fullscreen can use up the click's user activation.
      const locking = this.input.lock(this.settings.rawInput);
      const fullscreen = this.enterFullscreen();
      const raw = await locking;
      await fullscreen;
      this.menus.rawActive = raw;
      if (!this.input.locked) {
        // Browsers refuse a re-lock right after Esc; stay paused and let the next click retry.
        this.state = 'paused';
        this.menus.showPause();
        return;
      }
    }
    this.state = 'playing';
    this.menus.hide();
    this.hud.show(true);
    this.crosshair.el.style.display = '';
    this.lastFrame = performance.now();
    this.input.clearPresses();
    this.input.consumeMouse();
  }

  private async enterFullscreen(): Promise<void> {
    if (!this.settings.fullscreenOnPlay || document.fullscreenElement || this.options.debug) return;
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      const kb = (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard;
      await kb?.lock?.();
    } catch {
      // Fullscreen is optional.
    }
  }

  private pause(): void {
    this.state = 'paused';
    this.input.unlock();
    this.menus.showPause();
    this.crosshair.el.style.display = 'none';
  }

  private quit(): void {
    this.state = 'menu';
    this.input.unlock();
    this.hud.show(false);
    this.crosshair.el.style.display = 'none';
    if (document.fullscreenElement) void document.exitFullscreen();
    this.newRun();
    this.menus.showMain();
  }

  private endRun(): void {
    this.state = 'results';
    this.stats.endedAt = this.time;
    this.input.unlock();
    this.hud.show(false);
    this.crosshair.el.style.display = 'none';
    const survival = this.runSettings.mode === 'survival';
    const best = loadBest();
    const prev = best[this.runSettings.difficulty];
    let newBest = false;
    if (survival && (!prev || this.stats.rooms > prev.rooms || (this.stats.rooms === prev.rooms && this.stats.kills > prev.kills))) {
      const run: BestRun = { rooms: this.stats.rooms, kills: this.stats.kills, difficulty: this.runSettings.difficulty, date: new Date().toISOString() };
      best[this.runSettings.difficulty] = run;
      saveBest(best);
      newBest = Boolean(prev) || this.stats.rooms > 0;
    }
    this.menus.showResults(this.stats, this.time, best[this.runSettings.difficulty], newBest, survival);
  }

  private onKey(code: string): void {
    const b = this.settings.binds;
    if (code === 'Escape' && this.state === 'playing') {
      this.pause();
      return;
    }
    if (this.state === 'results' && (code === b.restart || code === 'Space')) {
      void this.restart();
      return;
    }
    if (this.state === 'playing' && code === b.restart) {
      this.newRun();
      void this.lockAndGo();
    }
  }

  private applySettings(s: Settings, keys: (keyof Settings)[]): void {
    saveSettings(s);
    for (const k of keys) {
      switch (k) {
        case 'crosshairCode':
          this.crosshairCfg = this.parseCrosshair();
          break;
        case 'volume':
          this.sfx.setVolume(s.volume);
          break;
        case 'shadows':
          this.renderer.shadowMap.enabled = s.shadows;
          this.scene.traverse((o) => {
            if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) o.material.needsUpdate = true;
          });
          break;
        case 'renderScale':
        case 'aspectMode':
          this.resize();
          break;
        case 'antialias':
          // The WebGL context can't change AA after creation.
          location.reload();
          break;
        case 'knifeSkin':
        case 'knifeGlow':
          this.viewmodel.setKnife(s.knifeSkin, KNIFE_GLOWS[s.knifeGlow]);
          break;
        case 'enemyHighlight':
          this.outlineMat.uniforms.uColor.value.set(ENEMY_HIGHLIGHT[s.enemyHighlight]);
          break;
        case 'showHitboxes':
          for (const v of this.views.values()) this.syncHitboxes(v);
          break;
        case 'adsHold':
        case 'scopeHold':
          for (const g of Object.values(this.guns)) g.options = { ...g.options, adsHold: s.adsHold, scopeHold: s.scopeHold };
          break;
        default:
          break;
      }
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio((window.devicePixelRatio || 1) * this.settings.renderScale);
    this.renderer.setSize(w, h);
    this.frame = frameRect(w, h, this.settings.aspectMode);
    const f = this.frame;
    this.hud.root.style.left = `${f.x}px`;
    this.hud.root.style.top = `${f.y}px`;
    this.hud.root.style.width = `${f.w}px`;
    this.hud.root.style.height = `${f.h}px`;
    this.viewmodel.setAspect(ASPECT);
    this.crosshair.layout();
    this.outlineMat.uniforms.uResolution.value.set(f.w * (window.devicePixelRatio || 1), f.h * (window.devicePixelRatio || 1));
  }

  // ---------------------------------------------------------------- world streaming

  private addSegment(seg: Segment): void {
    const mesh = buildSegmentMesh(seg, this.materials);
    this.scene.add(mesh);
    this.segMeshes.set(seg.index, [mesh]);
    this.world.addGroup(seg.index, seg.solids);
    this.bodyWorld.addGroup(seg.index, seg.solids);
    const profile = DIFFICULTIES[this.runSettings.difficulty];
    for (const spot of seg.bots) {
      const bot = new Bot(spot.x, spot.y, spot.z, spot.yaw, spot.stance, spot.tag, seg.index, profile, fireInterval(BOT_WEAPON, false), this.runSettings.botArmor);
      this.bots.push(bot);
      this.addBotView(bot);
    }
    this.rebuildBotColliders();
  }

  private removeSegment(seg: Segment): void {
    for (const m of this.segMeshes.get(seg.index) ?? []) this.removeMesh(m);
    this.segMeshes.delete(seg.index);
    this.world.removeGroup(seg.index);
    this.bodyWorld.removeGroup(seg.index);
    for (const bot of this.bots.filter((b) => b.segment === seg.index)) this.removeBotView(bot);
    this.bots = this.bots.filter((b) => b.segment !== seg.index);
    this.rebuildBotColliders();
  }

  private sealSegment(seg: Segment): void {
    if (!seg.seal) return;
    const solid: Solid = { ...seg.seal, kind: 'seal' };
    this.world.addSolid(seg.index, solid);
    this.bodyWorld.addSolid(seg.index, solid);
    const mesh = buildBoxMesh(seg.seal, seg.theme, this.materials);
    this.scene.add(mesh);
    this.segMeshes.get(seg.index)?.push(mesh);
  }

  private removeMesh(m: THREE.Object3D): void {
    this.scene.remove(m);
    disposeGroup(m);
  }

  private rebuildBotColliders(): void {
    const solids: Solid[] = [];
    for (const b of this.bots) {
      if (!b.alive) continue;
      const r = 0.3;
      const hgt = b.stance === 'crouch' ? 1.4 : 1.8;
      solids.push({ minX: b.x - r, maxX: b.x + r, minY: b.y, maxY: b.y + hgt, minZ: b.z - r, maxZ: b.z + r, kind: 'wall' });
    }
    this.bodyWorld.removeGroup(-1);
    if (solids.length) this.bodyWorld.addGroup(-1, solids);
  }

  private addBotView(bot: Bot): void {
    const material = makeBodyMaterial();
    const geo = botGeometry(bot.stance);
    const body = new THREE.Mesh(geo, material);
    body.castShadow = true;
    const outline = new THREE.Mesh(geo, this.outlineMat);
    outline.renderOrder = 2;
    const root = new THREE.Group();
    root.add(body, outline);
    root.position.set(bot.x, bot.y, bot.z);
    root.rotation.y = bot.yaw;
    this.scene.add(root);
    const v: BotView = { bot, root, body, outline, material, hitboxes: null };
    this.syncHitboxes(v);
    this.views.set(bot.id, v);
  }

  private syncHitboxes(v: BotView): void {
    if (this.settings.showHitboxes && !v.hitboxes && v.bot.alive) {
      v.hitboxes = hitboxHelper(v.bot.stance);
      v.root.add(v.hitboxes);
    } else if ((!this.settings.showHitboxes || !v.bot.alive) && v.hitboxes) {
      v.root.remove(v.hitboxes);
      v.hitboxes = null;
    }
  }

  private removeBotView(bot: Bot): void {
    const v = this.views.get(bot.id);
    if (!v) return;
    this.scene.remove(v.root);
    v.material.dispose();
    this.views.delete(bot.id);
  }

  // ---------------------------------------------------------------- main loop

  private loop(): void {
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    // Frozen (debug/recording): frames are driven manually through debugApi().frame().
    if (this.frozen) return;
    if (dt > 0) this.fps = this.fps ? this.fps * 0.92 + (1 / dt) * 0.08 : 1 / dt;

    if (this.state === 'playing') {
      this.look();
      this.acc += dt;
      let ticks = 0;
      while (this.acc >= TICK && ticks < 16) {
        this.tick(TICK);
        this.acc -= TICK;
        ticks++;
        if (this.state !== 'playing') break;
      }
      if (ticks >= 16) this.acc = 0;
    } else if (this.state === 'menu') {
      // Slow idle pan behind the menu.
      this.player.yaw += dt * 0.08;
      this.acc = 0;
    }
    this.render(dt);
  }

  /** Mouse look: applied every frame, not every tick, for the lowest latency. */
  private look(): void {
    const { dx, dy } = this.input.consumeMouse();
    const gun = this.gun;
    const zoomed = gun.zoomed && gun.zoomBlend > 0.5;
    const d = degreesPerCount(this.settings.sensitivity, zoomed ? gun.zoom : 1, this.settings.scopedMultiplier) * DEG;
    const yawDelta = -dx * d;
    this.player.yaw += yawDelta;
    this.player.pitch = clamp(this.player.pitch - dy * d * (this.settings.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
    this.hud.rotateIndicators(yawDelta);
    this.lookDX = (dx * d) / DEG;
    this.lookDY = (dy * d) / DEG;
  }

  /** Display name, with the chosen knife skin for the melee slot. */
  private weaponName(def: WeaponDef): string {
    return def.category === 'melee' ? KNIFE_NAMES[this.settings.knifeSkin] : def.name;
  }

  private get gun(): Gun {
    return this.guns[this.slot];
  }

  private switchTo(slot: Slot): void {
    if (slot === this.slot) return;
    this.gun.holster();
    this.slot = slot;
    this.gun.equip();
    this.viewmodel.setWeapon(this.gun.def);
    this.viewmodel.onEquip();
    this.sfx.equip();
  }

  private moveSample(): MoveSample {
    const def = this.gun.def;
    return {
      speed: this.player.speed,
      airborne: !this.player.grounded,
      crouched: this.player.crouched,
      sinceLanding: this.player.sinceLanding,
      walkSpeed: def.runSpeed * AGENT.walkMult,
      crouchSpeed: def.runSpeed * AGENT.crouchMult,
    };
  }

  private tick(dt: number): void {
    this.time += dt;
    this.pilot?.tick(dt);
    const b = this.settings.binds;
    const inp = this.input;
    const p = this.player;

    if (inp.press(b, 'primary')) this.switchTo('primary');
    if (inp.press(b, 'secondary')) this.switchTo('secondary');
    if (inp.press(b, 'melee')) this.switchTo('melee');
    if (inp.press(b, 'inspect') && this.gun.state === 'ready') this.viewmodel.inspect();

    if (this.settings.walkToggle && inp.press(b, 'walk')) this.walkOn = !this.walkOn;
    if (this.settings.crouchToggle && inp.press(b, 'crouch')) this.crouchOn = !this.crouchOn;
    const walk = this.settings.walkToggle ? this.walkOn : inp.held(b, 'walk');
    const crouch = this.settings.crouchToggle ? this.crouchOn : inp.held(b, 'crouch');

    const gun = this.gun;
    const run = gun.def.runSpeed;
    const maxSpeed = p.maxSpeed(run, gun.moveMult, walk, this.time);
    const ev = p.step(
      dt,
      {
        forward: (inp.held(b, 'forward') ? 1 : 0) - (inp.held(b, 'back') ? 1 : 0),
        right: (inp.held(b, 'right') ? 1 : 0) - (inp.held(b, 'left') ? 1 : 0),
        walk,
        crouch,
        jump: inp.press(b, 'jump'),
      },
      maxSpeed,
      this.bodyWorld,
      run * AGENT.walkMult,
    );
    const feet = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    if (ev.footstep) {
      this.sfx.footstep(undefined, 0.6);
      this.noise(feet, 26);
    }
    if (ev.landed) {
      this.sfx.land();
      this.noise(feet, 20);
    }
    if (p.pos.y < -30) this.endRun();

    const wasReloading = gun.state === 'reloading';
    const firePressed = inp.press(b, 'fire');
    if (firePressed && gun.ammo === 0 && gun.reserve === 0 && !gun.isMelee) this.sfx.dryFire();
    const shots = gun.update(dt, this.time, { fireHeld: inp.held(b, 'fire'), firePressed, altHeld: inp.held(b, 'alt'), altPressed: inp.press(b, 'alt'), reloadPressed: inp.press(b, 'reload') }, this.moveSample());
    if (!wasReloading && gun.state === 'reloading') this.sfx.reload(gun.reloadTime);
    for (const shot of shots) this.playerShot(shot, gun.def);

    // Holstered guns keep reloading in VALORANT only if active; nothing to do for them.
    this.updateBots(dt);
    this.trackSightings();

    const idx = this.hallway!.locate(p.pos.x, p.pos.z);
    if (idx > this.hallway!.current) this.advance(idx);
    // Keep the edge-triggered keys we don't use from piling up.
    inp.consumePress('WheelUp');
    inp.consumePress('WheelDown');
  }

  private advance(idx: number): void {
    const res = this.hallway!.advanceTo(idx);
    for (const seg of res.removed) this.removeSegment(seg);
    for (const seg of res.added) this.addSegment(seg);
    for (const seg of res.sealed) this.sealSegment(seg);
    this.stats.rooms = idx;
    if (this.runSettings.healBetweenRooms && this.player.alive) {
      this.player.vitals = makeVitals(this.runSettings.playerArmor);
      for (const g of Object.values(this.guns)) g.reserve = g.def.reserve;
    }
  }

  // ---------------------------------------------------------------- combat

  private eye(): { x: number; y: number; z: number } {
    const p = this.player;
    return { x: p.pos.x, y: p.pos.y + p.eyeHeight(), z: p.pos.z };
  }

  private noise(pos: { x: number; y: number; z: number }, radius: number): void {
    for (const bot of this.bots) bot.hear(this.time, pos, radius);
  }

  private playerShot(shot: ShotEvent, def: WeaponDef): void {
    const eye = this.eye();
    const p = this.player;
    const viewYaw = p.yaw - shot.recoilYaw * DEG;
    const viewPitch = p.pitch + shot.recoilPitch * DEG;
    const base = viewDir(viewYaw, viewPitch);

    if (shot.kind === 'melee') {
      this.viewmodel.onSwing(shot.heavy ?? false);
      this.sfx.swing(shot.heavy ?? false, this.settings.knifeSkin === 'butterfly');
      this.meleeHit(eye, base, shot.heavy ?? false);
      return;
    }

    this.viewmodel.onShot(def.silenced);
    this.sfx.gunshot(def);
    this.noise(eye, def.silenced ? 18 : 55);
    const muzzle = new THREE.Vector3(eye.x, eye.y, eye.z)
      .addScaledVector(new THREE.Vector3(base.x, base.y, base.z), 0.6)
      .add(new THREE.Vector3(Math.cos(viewYaw), 0, -Math.sin(viewYaw)).multiplyScalar(0.12))
      .add(new THREE.Vector3(0, -0.1, 0));

    for (let i = 0; i < shot.pellets; i++) {
      const dir = applySpread(base, shot.spread * DEG, shot.uniform, () => this.rng.next());
      const ray = makeRay(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
      const wall = this.world.raycast(ray, 300);
      const maxT = wall ? wall.t : 300;
      let hitBot: Bot | null = null;
      let hit: { t: number; region: 'head' | 'body' | 'leg' } | null = null;
      for (const bot of this.bots) {
        const h = bot.raycast(ray, hit ? hit.t : maxT);
        if (h) {
          hit = h;
          hitBot = bot;
        }
      }
      this.stats.shots++;
      const t = hit ? hit.t : maxT;
      const end = new THREE.Vector3(eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t);
      if (hit && hitBot) {
        this.hitBot(hitBot, damageAt(def, hit.t, hit.region), hit.region, end, def);
      } else if (wall) {
        const color = wall.solid.kind === 'crate' ? '#c9a46a' : wall.solid.kind === 'metal' || wall.solid.kind === 'seal' ? '#ffd27a' : '#d8d2c4';
        this.effects.impact(end, new THREE.Vector3(wall.nx, wall.ny, wall.nz), color);
        if (wall.solid.kind === 'metal' || wall.solid.kind === 'seal') this.effects.sparks(end, '#ffcf70', 4, 3);
      }
      // Bullets cracking past a bot give you away even if they miss.
      for (const bot of this.bots) {
        if (!bot.alive || bot === hitBot) continue;
        const hx = bot.x - eye.x;
        const hy = bot.y + 1.2 - eye.y;
        const hz = bot.z - eye.z;
        const along = hx * dir.x + hy * dir.y + hz * dir.z;
        if (along <= 0 || along > t) continue;
        const dist = Math.hypot(hx - dir.x * along, hy - dir.y * along, hz - dir.z * along);
        if (dist < 2.5) bot.hear(this.time, { x: bot.x, y: bot.y, z: bot.z }, 1);
      }
      if (!def.silenced) this.effects.tracer(muzzle, end, '#ffe2a8', 0.008, 0.05);
    }
  }

  private meleeHit(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, heavy: boolean): void {
    const ray = makeRay(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
    const wallT = this.world.raycastT(ray, KNIFE_RANGE);
    let best: { bot: Bot; t: number; region: 'head' | 'body' | 'leg' } | null = null;
    for (const bot of this.bots) {
      const h = bot.raycast(ray, Math.min(wallT, best ? best.t : KNIFE_RANGE));
      if (h) best = { bot, t: h.t, region: h.region };
    }
    if (!best) return;
    // Backstab: you're behind the bot (it faces away from you).
    const fx = -Math.sin(best.bot.yaw);
    const fz = -Math.cos(best.bot.yaw);
    const behind = fx * dir.x + fz * dir.z > 0.5;
    const dmg = (heavy ? 75 : 50) * (behind ? 2 : 1);
    const point = new THREE.Vector3(eye.x + dir.x * best.t, eye.y + dir.y * best.t, eye.z + dir.z * best.t);
    this.hitBot(best.bot, dmg, best.region, point, WEAPONS.knife);
  }

  private hitBot(bot: Bot, dmg: number, region: 'head' | 'body' | 'leg', point: THREE.Vector3, def: WeaponDef): void {
    const killed = bot.damage(dmg, region, this.time);
    this.stats.hits++;
    if (region === 'head') this.stats.headHits++;
    else if (region === 'body') this.stats.bodyHits++;
    else this.stats.legHits++;
    this.stats.damageDealt += dmg;
    if (region === 'head') {
      this.sfx.headshot();
      this.effects.sparks(point, '#ffffff', 7, 2.6);
    } else {
      this.sfx.bodyHit();
      this.effects.sparks(point, '#ff8a8a', 5, 2);
    }
    const v = this.views.get(bot.id);
    if (v?.material.userData.shader) v.material.userData.shader.uniforms.uFlash.value = 0.6;
    if (killed) this.onKill(bot, region === 'head', def, point);
  }

  private onKill(bot: Bot, headshot: boolean, def: WeaponDef, point: THREE.Vector3): void {
    this.stats.kills++;
    if (headshot) this.stats.headshotKills++;
    const ttk = bot.playerSawAt !== null ? this.time - bot.playerSawAt : null;
    const sawFirst = bot.playerSawAt !== null ? bot.sawPlayerAt === -Infinity || bot.playerSawAt <= bot.sawPlayerAt : null;
    const eye = this.eye();
    this.stats.encounters.push({
      tag: bot.tag,
      ttk,
      placement: bot.placementError,
      sawFirst,
      headshot,
      distance: Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z),
    });
    this.lastKill = { ttk, placement: bot.placementError, tag: bot.tag };
    this.hud.killFeed(this.weaponName(def), headshot, 'BOT');
    this.hud.flashKillBanner(headshot ? 'HEADSHOT' : 'ELIMINATED', headshot);
    this.sfx.kill(headshot);
    const v = this.views.get(bot.id);
    if (v) {
      v.root.remove(v.outline);
      this.syncHitboxes(v);
    }
    this.rebuildBotColliders();
  }

  private updateBots(dt: number): void {
    const p = this.player;
    const head = HITBOXES[p.crouched ? 'crouch' : 'stand'];
    const senses: BotSenses = {
      now: this.time,
      playerPoints: p.visibilityPoints(),
      playerHead: { x: p.pos.x, y: p.pos.y + head.head.y, z: p.pos.z },
      playerChest: { x: p.pos.x, y: p.pos.y + head.body.y + 0.1, z: p.pos.z },
      playerVel: p.vel,
      playerAlive: p.alive,
      clear: (a, c) => !this.world.segmentBlocked(a.x, a.y, a.z, c.x, c.y, c.z),
      rand: () => this.rng.next(),
      normal: (m, sd) => this.rng.normal(m, sd),
    };
    if (this.time < SPAWN_GRACE) return;
    const near = this.hallway!.current;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      // Bots wake up one segment ahead: the room you're about to enter. Anything further stays
      // dormant so you never get picked off down a 60 m sightline you can't play.
      if (bot.segment > near + 1 || bot.segment < near - 1) continue;
      const shots = bot.update(dt, senses);
      if (this.runSettings.botsShoot && this.time >= this.safeUntil) for (const s of shots) this.botShot(bot, s);
    }
  }

  private botShot(bot: Bot, shot: BotShot): void {
    const p = this.player;
    const ray = makeRay(shot.from.x, shot.from.y, shot.from.z, shot.dir.x, shot.dir.y, shot.dir.z);
    const worldT = this.world.raycastT(ray, 150);
    const maxT = Math.min(worldT, 150);
    let best: { t: number; region: 'head' | 'body' | 'leg' } | null = null;
    for (const hb of p.hitboxes()) {
      const t = rayBox(ray, hb.box, best ? best.t : maxT);
      if (t < (best ? best.t : maxT)) best = { t, region: hb.region };
    }
    const t = best ? best.t : maxT;
    const muzzleOff = 0.45;
    const muzzle = new THREE.Vector3(
      shot.from.x + shot.dir.x * muzzleOff + Math.cos(bot.yaw) * 0.08,
      shot.from.y - 0.22,
      shot.from.z + shot.dir.z * muzzleOff - Math.sin(bot.yaw) * 0.08,
    );
    const end = new THREE.Vector3(shot.from.x + shot.dir.x * t, shot.from.y + shot.dir.y * t, shot.from.z + shot.dir.z * t);
    this.effects.tracer(muzzle, end, '#ffcf8a', 0.012, 0.08);
    this.effects.puff(muzzle, '#ffd59a', 0.25, 0.06);
    this.sfx.gunshot(BOT_WEAPON, { x: shot.from.x, y: shot.from.y, z: shot.from.z }, 0.9);
    if (!best) {
      const eye = this.eye();
      const ex = eye.x - shot.from.x;
      const ey = eye.y - shot.from.y;
      const ez = eye.z - shot.from.z;
      const along = ex * shot.dir.x + ey * shot.dir.y + ez * shot.dir.z;
      if (along > 0 && along < t) {
        const miss = Math.hypot(ex - shot.dir.x * along, ey - shot.dir.y * along, ez - shot.dir.z * along);
        if (miss < 1.5) this.sfx.whiz({ x: shot.from.x + shot.dir.x * along, y: shot.from.y + shot.dir.y * along, z: shot.from.z + shot.dir.z * along });
      }
      return;
    }
    const dmg = damageAt(BOT_WEAPON, best.t, best.region);
    applyHit(p.vitals, dmg);
    this.stats.damageTaken += dmg;
    p.taggedUntil = this.time + AGENT.tagDuration;
    const yawTo = Math.atan2(-(bot.x - p.pos.x), -(bot.z - p.pos.z));
    this.hud.hitFrom(angleDelta(p.yaw, yawTo));
    this.sfx.hurt();
    if (best.region === 'head') this.sfx.headshot();
    if (p.vitals.health <= 0) this.onPlayerDeath(bot, best.region, best.t);
  }

  private onPlayerDeath(bot: Bot, region: 'head' | 'body' | 'leg', distance: number): void {
    this.stats.deaths++;
    this.stats.death = {
      tag: bot.tag,
      reaction: bot.reactionUsed,
      exposed: this.time - bot.sawPlayerAt,
      youSawFirst: bot.playerSawAt !== null && bot.playerSawAt <= bot.sawPlayerAt,
      placement: bot.placementError,
      distance,
      region,
    };
    if (this.runSettings.mode === 'survival') {
      this.player.alive = false;
      this.endRun();
      return;
    }
    // Practice: count it and keep going.
    this.player.vitals = makeVitals(this.runSettings.playerArmor);
    this.safeUntil = this.time + PRACTICE_RESPAWN_GRACE;
    this.hud.showToast(`DEAD · killed from ${TAG_PHRASES[bot.tag]} · it reacted in ${Math.round(bot.reactionUsed * 1000)} ms`, 2.4);
  }

  /** Record when each bot first shows up on your screen and how far off your crosshair was. */
  private trackSightings(): void {
    const eye = this.eye();
    const gun = this.gun;
    const zoom = gun.zoomed ? gun.zoom : 1;
    const hfov = horizontalFov(zoom) * DEG;
    const vfov = verticalFov(horizontalFov(zoom)) * DEG;
    const yaw = this.player.yaw - gun.recoilYaw * DEG;
    const pitch = this.player.pitch + gun.recoilPitch * DEG;
    const fwd = viewDir(yaw, pitch);
    for (const bot of this.bots) {
      if (!bot.alive || bot.playerSawAt !== null || bot.segment > this.hallway!.current + 1 || bot.segment < this.hallway!.current - 1) continue;
      for (const pt of bot.visibilityPoints()) {
        const dx = pt.x - eye.x;
        const dy = pt.y - eye.y;
        const dz = pt.z - eye.z;
        const yawTo = Math.atan2(-dx, -dz);
        if (Math.abs(angleDelta(yaw, yawTo)) > hfov / 2) continue;
        const pitchTo = Math.atan2(dy, Math.hypot(dx, dz));
        if (Math.abs(pitchTo - pitch) > vfov / 2) continue;
        if (this.world.segmentBlocked(eye.x, eye.y, eye.z, pt.x, pt.y, pt.z)) continue;
        const head = bot.headCenter();
        bot.playerSawAt = this.time;
        bot.placementError = angleBetween(fwd.x, fwd.y, fwd.z, head.x - eye.x, head.y - eye.y, head.z - eye.z) / DEG;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- rendering

  private render(dt: number): void {
    const p = this.player;
    const gun = this.gun;
    const alpha = this.state === 'playing' ? this.acc / TICK : 1;
    const eye = p.eyeAt(alpha);
    this.camera.position.set(eye.x, eye.y, eye.z);
    const viewYaw = p.yaw - gun.recoilYaw * DEG;
    const viewPitch = p.pitch + gun.recoilPitch * DEG;
    this.camera.rotation.set(viewPitch, viewYaw, 0, 'YXZ');

    const zoom = 1 + (gun.zoom - 1) * gun.zoomBlend;
    const vfov = verticalFov(horizontalFov(zoom));
    if (Math.abs(this.camera.fov - vfov) > 1e-4) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }

    // Theme-driven sky and light colors follow the segment you're in.
    const seg = this.hallway?.get(this.hallway.current);
    if (seg && seg.theme !== this.skyTheme) this.applyTheme(seg.theme);
    this.sun.position.set(eye.x + 22, eye.y + 55, eye.z + 14);
    this.sun.target.position.set(eye.x, 0, eye.z);

    this.updateBotViews(dt);
    this.effects.update(dt, this.camera);
    this.viewmodel.update(dt, {
      equip: gun.state === 'equipping' ? gun.stateProgress : 1,
      reload: gun.state === 'reloading' ? gun.stateProgress : -1,
      zoomBlend: gun.def.alt?.kind === 'scope' ? 0 : gun.zoomBlend,
      hideForScope: gun.usesScopeOverlay && gun.zoomBlend > 0.6,
      speed: p.speed,
      grounded: p.grounded,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
    });
    this.lookDX = 0;
    this.lookDY = 0;

    const r = this.renderer;
    const f = this.frame;
    const W = window.innerWidth;
    const H = window.innerHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setClearColor('#000000', 1);
    r.clear(true, true, true);
    r.setScissorTest(true);
    r.setScissor(f.x, H - f.y - f.h, f.w, f.h);
    r.setViewport(f.x, H - f.y - f.h, f.w, f.h);
    r.render(this.scene, this.camera);
    r.clearDepth();
    if (this.state !== 'menu') r.render(this.viewmodel.scene, this.viewmodel.camera);
    r.setScissorTest(false);

    if (this.state === 'playing') this.updateHud(dt);
    this.sfx.setListener(eye.x, eye.y, eye.z, -Math.sin(viewYaw) * Math.cos(viewPitch), Math.sin(viewPitch), -Math.cos(viewYaw) * Math.cos(viewPitch));
  }

  private applyTheme(index: number): void {
    const t = THEMES[index % THEMES.length];
    this.skyTheme = index;
    this.sky?.dispose();
    this.sky = skyTexture(t.skyTop, t.skyHorizon);
    this.scene.background = this.sky;
    (this.scene.fog as THREE.Fog).color.set(t.skyHorizon);
    this.hemi.color.set(t.ambientSky);
    this.hemi.groundColor.set(t.ambientGround);
    this.sun.color.set(t.sun);
  }

  private updateBotViews(dt: number): void {
    for (const v of this.views.values()) {
      const bot = v.bot;
      v.root.rotation.y = bot.yaw;
      const shader = v.material.userData.shader as { uniforms: { uFlash: { value: number } } } | undefined;
      if (shader) shader.uniforms.uFlash.value = Math.max(0, shader.uniforms.uFlash.value - dt * 4);
      if (!bot.alive) {
        const t = this.time - bot.diedAt;
        const fall = clamp(t / 0.35, 0, 1);
        v.root.rotation.order = 'YXZ';
        v.root.rotation.x = (fall * fall * Math.PI) / 2.2;
        v.root.position.y = bot.y - fall * 0.15;
        if (t > 0.8) {
          if (!v.material.transparent) {
            v.material.transparent = true;
            v.material.needsUpdate = true;
          }
          v.material.opacity = clamp(1 - (t - 0.8) / 0.7, 0, 1);
        }
        if (t > 1.6) v.root.visible = false;
      }
    }
  }

  private updateHud(dt: number): void {
    const p = this.player;
    const gun = this.gun;
    const s = this.settings;
    this.hud.setVitals(p.vitals.health, p.vitals.shield);
    this.hud.setAmmo(gun.def, gun.ammo, gun.reserve, gun.state === 'reloading' ? gun.stateProgress : null, this.weaponName(gun.def));
    this.hud.setTop(this.time, this.hallway!.current, this.stats.kills);
    this.hud.setFps(s.showFps ? this.fps : null);
    const showStats = s.showStatsPanel || this.input.held(s.binds, 'stats');
    this.hud.setLive(showStats ? this.stats : null, this.lastKill);
    this.hud.update(dt);

    const scoped = gun.usesScopeOverlay && gun.zoomBlend > 0.6;
    this.hud.setScope(scoped);
    if (scoped) {
      this.crosshair.drawSniper(this.crosshairCfg.sniper);
      return;
    }
    const zoom = gun.zoomed ? gun.zoom : 1;
    const heightPx = this.frame.h * (window.devicePixelRatio || 1);
    const err = gun.errorBreakdown(this.time, this.moveSample());
    const profile = gun.zoomed && this.crosshairCfg.separateAds ? this.crosshairCfg.ads : this.crosshairCfg.primary;
    this.crosshair.draw(profile, errorToPixels(err.base, heightPx, zoom), errorToPixels(err.firing, heightPx, zoom), errorToPixels(err.movement, heightPx, zoom));
  }

  private pilotHost(): PilotHost {
    const game = this;
    const p = this.player;
    return {
      get time() {
        return game.time;
      },
      get binds() {
        return game.settings.binds;
      },
      eye: () => this.eye(),
      // The pilot aims the crosshair, which rides the camera recoil like a player's would.
      view: () => ({ yaw: p.yaw - this.gun.recoilYaw * DEG, pitch: p.pitch + this.gun.recoilPitch * DEG }),
      setView: (yaw, pitch) => {
        const ny = yaw + this.gun.recoilYaw * DEG;
        const np = clamp(pitch - this.gun.recoilPitch * DEG, -89 * DEG, 89 * DEG);
        const dYaw = angleDelta(p.yaw, ny);
        this.hud.rotateIndicators(dYaw);
        this.lookDX -= dYaw / DEG;
        this.lookDY -= (np - p.pitch) / DEG;
        p.yaw = ny;
        p.pitch = np;
      },
      speed: () => p.speed,
      velocity: () => ({ x: p.vel.x, z: p.vel.z }),
      bots: () => this.bots,
      currentSegment: () => this.hallway!.current,
      clear: (a, b) => !this.world.segmentBlocked(a.x, a.y, a.z, b.x, b.y, b.z),
      waypoints: () => this.hallway!.segments.flatMap((s) => s.path.map((w, i) => ({ seg: s.index, i, x: w.x, z: w.z }))),
      angles: () => {
        const cur = this.hallway!.current;
        return this.hallway!.segments
          .filter((s) => s.index >= cur && s.index <= cur + 1)
          .flatMap((s) => s.spots.map((sp, i) => ({ key: `${s.index}:${i}`, x: sp.x, y: sp.y + HITBOXES[sp.stance].head.y, z: sp.z })));
      },
      key: (code, down) => this.input.inject(code, down),
      weapon: () => ({
        melee: this.gun.isMelee,
        ready: this.gun.state === 'ready',
        deadzone: this.gun.def.deadzone * this.gun.def.runSpeed,
      }),
    };
  }

  // ---------------------------------------------------------------- debug hooks (used by automated tests)

  debugApi(): Record<string, unknown> {
    return {
      freeze: (on: boolean) => {
        this.frozen = on;
        this.lastFrame = performance.now();
      },
      /** Advance one rendered frame of `dt` seconds (simulation at 128 Hz underneath). */
      frame: (dt: number, draw = true) => {
        if (this.state === 'playing') {
          this.acc += dt;
          let n = 0;
          while (this.acc >= TICK && n < 32) {
            this.tick(TICK);
            this.acc -= TICK;
            n++;
            if (this.state !== 'playing') break;
          }
        }
        if (draw) this.render(dt);
      },
      start: () => {
        this.newRun();
        this.state = 'playing';
        this.menus.hide();
        this.hud.show(true);
        this.crosshair.el.style.display = '';
      },
      look: (yawDeg: number, pitchDeg: number) => {
        this.player.yaw = yawDeg * DEG;
        this.player.pitch = pitchDeg * DEG;
      },
      teleport: (x: number, z: number) => {
        this.player.pos.x = x;
        this.player.pos.z = z;
        this.player.prevPos = { ...this.player.pos };
      },
      step: (seconds: number) => {
        const n = Math.round(seconds / TICK);
        for (let i = 0; i < n && this.state === 'playing'; i++) this.tick(TICK);
      },
      bots: () => this.bots.map((b) => ({ x: b.x, y: b.y, z: b.z, seg: b.segment, tag: b.tag, alive: b.alive, state: b.state, stance: b.stance })),
      player: () => ({ ...this.player.pos, yaw: this.player.yaw / DEG, pitch: this.player.pitch / DEG, hp: this.player.vitals.health, shield: this.player.vitals.shield }),
      segments: () => this.hallway!.segments.map((s) => ({ index: s.index, kind: s.kind, frame: s.frame, exit: s.exitFrame })),
      aimAt: (x: number, y: number, z: number) => {
        const e = this.eye();
        this.player.yaw = Math.atan2(-(x - e.x), -(z - e.z));
        this.player.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
      },
      press: (code: string, seconds: number) => {
        this.input.inject(code, true);
        const n = Math.round(seconds / TICK);
        for (let i = 0; i < n && this.state === 'playing'; i++) this.tick(TICK);
        this.input.inject(code, false);
      },
      botYaw: (i: number) => this.bots[i]?.yaw ?? 0,
      probe: (i: number) => {
        const bot = this.bots[i];
        const p = this.player;
        const r = AGENT.radius;
        const inside = this.world.overlapsAny({ minX: p.pos.x - r, maxX: p.pos.x + r, minY: p.pos.y + 0.05, maxY: p.pos.y + 1.8, minZ: p.pos.z - r, maxZ: p.pos.z + r });
        const eye = bot.eye();
        const los = p.visibilityPoints().map((pt) => !this.world.segmentBlocked(eye.x, eye.y, eye.z, pt.x, pt.y, pt.z));
        return { inside, los, state: bot.state, time: this.time, current: this.hallway!.current, botSeg: bot.segment };
      },
      hold: (code: string, down: boolean) => this.input.inject(code, down),
      stats: () => ({ kills: this.stats.kills, deaths: this.stats.deaths, shots: this.stats.shots, hits: this.stats.hits, rooms: this.stats.rooms, state: this.state }),
      state: () => this.state,
      /** Let the demo autopilot play (on) or hand control back (off). */
      autopilot: (on: boolean, opts: Partial<PilotOptions> = {}) => {
        this.pilot?.release();
        this.pilot = on ? new Autopilot(this.pilotHost(), { ...DEFAULT_PILOT, ...opts }) : null;
      },
      pilotState: () => this.pilot?.debugState() ?? null,
      lastDeath: () => this.stats.death,
      paths: () => this.hallway!.segments.map((s) => ({ index: s.index, kind: s.kind, path: s.path })),
      /** Switch weapon slot like the 1/2/3 keys. */
      slot: (slot: Slot) => this.switchTo(slot),
      inspect: () => this.viewmodel.inspect(),
    };
  }
}
