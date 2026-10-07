import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { KnifeSkin } from '../config/settings';
import type { WeaponCategory, WeaponDef } from '../config/weapons';
import { ButterflyKnife, type GlowColors } from './butterflyKnife';
import { GUN_INSPECT_LENGTH, KNIFE_ANIM_LENGTH, type KnifeAnimKind, gunInspectPose, knifePose, restPose } from './knifeAnims';

/**
 * First-person weapon, rendered in its own scene after the world (depth cleared) so it never
 * clips into walls. Models are simple procedural shapes; the motion (equip, recoil kick,
 * reload dip, sway, bob, ADS raise) is what matters for feel.
 */

const METAL = new THREE.MeshStandardMaterial({ color: '#59616c', roughness: 0.38, metalness: 0.5 });
const POLY = new THREE.MeshStandardMaterial({ color: '#3d434b', roughness: 0.7, metalness: 0.05 });
const ACCENT = new THREE.MeshStandardMaterial({ color: '#b8915a', roughness: 0.6, metalness: 0.15 });
const RED = new THREE.MeshStandardMaterial({ color: '#ff4655', roughness: 0.5, metalness: 0.1, emissive: '#5a1016' });
const GLOVE = new THREE.MeshStandardMaterial({ color: '#23272d', roughness: 0.9 });
const SLEEVE = new THREE.MeshStandardMaterial({ color: '#56606e', roughness: 0.85 });
const BLADE = new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.25, metalness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function capsule(r: number, len: number, mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return m;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Gloved hands with forearms running back and down out of frame. */
function hands(grip: THREE.Vector3, fore: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.05, 0.06, 0.07, GLOVE, grip.x, grip.y, grip.z, -0.3));
  g.add(capsule(0.032, 0.3, SLEEVE, v3(grip.x + 0.02, grip.y - 0.03, grip.z + 0.04), v3(grip.x + 0.1, grip.y - 0.2, grip.z + 0.32)));
  g.add(box(0.05, 0.05, 0.08, GLOVE, fore.x, fore.y, fore.z, 0, 0, 0.25));
  g.add(capsule(0.032, 0.42, SLEEVE, v3(fore.x - 0.02, fore.y - 0.03, fore.z + 0.03), v3(fore.x - 0.2, fore.y - 0.25, fore.z + 0.4)));
  return g;
}

interface Model {
  root: THREE.Group;
  muzzle: THREE.Vector3;
}

function rifle(silenced: boolean, heavy: boolean): Model {
  const g = new THREE.Group();
  g.add(box(0.05, 0.075, 0.34, METAL, 0, 0, 0));
  g.add(box(0.044, 0.055, 0.24, POLY, 0, -0.004, -0.28));
  g.add(box(0.008, 0.02, 0.2, ACCENT, 0.026, 0.005, -0.02));
  g.add(box(0.042, 0.15, 0.06, POLY, 0, -0.1, -0.07, 0.28));
  g.add(box(0.04, 0.075, 0.2, POLY, 0, -0.012, 0.27));
  g.add(box(0.034, 0.085, 0.04, POLY, 0, -0.07, 0.1, -0.35));
  g.add(box(0.022, 0.022, 0.1, METAL, 0, 0.048, -0.01));
  g.add(box(0.008, 0.014, 0.008, RED, 0, 0.066, -0.05));
  const barrelLen = silenced ? 0.3 : 0.16;
  g.add(cyl(silenced ? 0.019 : 0.011, barrelLen, silenced ? POLY : METAL, 0, 0.004, -0.4 - barrelLen / 2));
  if (heavy) {
    g.add(box(0.1, 0.1, 0.16, POLY, 0, -0.09, -0.04));
    g.add(box(0.06, 0.085, 0.42, METAL, 0, 0, -0.12));
  }
  g.add(hands(v3(0, -0.085, 0.1), v3(0, -0.045, -0.3)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.004, -0.4 - barrelLen) };
}

function smg(silenced: boolean): Model {
  const g = new THREE.Group();
  g.add(box(0.046, 0.07, 0.26, METAL, 0, 0, 0));
  g.add(box(0.042, 0.05, 0.12, POLY, 0, -0.004, -0.19));
  g.add(box(0.036, 0.14, 0.045, POLY, 0, -0.09, -0.03, 0.1));
  g.add(box(0.036, 0.065, 0.15, POLY, 0, -0.01, 0.2));
  g.add(box(0.032, 0.08, 0.04, POLY, 0, -0.065, 0.07, -0.3));
  g.add(box(0.008, 0.014, 0.008, RED, 0, 0.044, -0.03));
  const len = silenced ? 0.2 : 0.08;
  g.add(cyl(silenced ? 0.017 : 0.01, len, POLY, 0, 0.004, -0.25 - len / 2));
  g.add(hands(v3(0, -0.075, 0.07), v3(0, -0.04, -0.19)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.004, -0.25 - len) };
}

function pistol(big: boolean): Model {
  const g = new THREE.Group();
  const s = big ? 1.15 : 1;
  g.add(box(0.03 * s, 0.04 * s, 0.17 * s, METAL, 0, 0.02, -0.03));
  g.add(box(0.027 * s, 0.1 * s, 0.045 * s, POLY, 0, -0.04, 0.03, -0.25));
  g.add(box(0.006, 0.01, 0.008, RED, 0, 0.045, -0.1));
  g.add(box(0.05, 0.06, 0.07, GLOVE, 0, -0.05, 0.05, -0.25));
  g.add(capsule(0.032, 0.3, SLEEVE, v3(0.01, -0.08, 0.08), v3(0.08, -0.25, 0.36)));
  g.add(box(0.045, 0.05, 0.065, GLOVE, -0.03, -0.06, 0.06));
  g.add(capsule(0.03, 0.3, SLEEVE, v3(-0.04, -0.09, 0.08), v3(-0.16, -0.26, 0.34)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.02, -0.12 * s) };
}

function sniper(): Model {
  const g = new THREE.Group();
  g.add(box(0.05, 0.08, 0.44, METAL, 0, 0, 0));
  g.add(cyl(0.014, 0.46, METAL, 0, 0.008, -0.45));
  g.add(cyl(0.027, 0.26, POLY, 0, 0.075, -0.02));
  g.add(box(0.045, 0.1, 0.24, POLY, 0, -0.025, 0.32));
  g.add(box(0.034, 0.085, 0.04, POLY, 0, -0.07, 0.13, -0.35));
  g.add(box(0.044, 0.1, 0.05, POLY, 0, -0.085, -0.05, 0.2));
  g.add(hands(v3(0, -0.085, 0.13), v3(0, -0.045, -0.28)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.008, -0.68) };
}

function shotgun(): Model {
  const g = new THREE.Group();
  g.add(box(0.05, 0.07, 0.32, METAL, 0, 0, 0));
  g.add(cyl(0.019, 0.36, METAL, 0, 0.015, -0.34));
  g.add(box(0.05, 0.05, 0.16, ACCENT, 0, -0.04, -0.28));
  g.add(box(0.04, 0.09, 0.2, POLY, 0, -0.018, 0.25));
  g.add(hands(v3(0, -0.075, 0.09), v3(0, -0.06, -0.28)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.015, -0.52) };
}

function knife(): Model {
  const g = new THREE.Group();
  g.add(box(0.01, 0.035, 0.18, BLADE, 0, 0.018, -0.12, 0.2));
  g.add(box(0.026, 0.032, 0.1, POLY, 0, 0, 0.02, 0.2));
  g.add(box(0.05, 0.06, 0.07, GLOVE, 0, -0.018, 0.04));
  return { root: g, muzzle: new THREE.Vector3(0, 0.02, -0.22) };
}

/** Where the forearm meets the tactical knife's fist, in its model space. */
const TACTICAL_JOINT = new THREE.Vector3(0.01, -0.035, 0.075);

function modelFor(def: WeaponDef): Model {
  const cat: WeaponCategory = def.category;
  switch (cat) {
    case 'rifle':
      return rifle(def.silenced, false);
    case 'heavy':
      return rifle(false, true);
    case 'smg':
      return smg(def.silenced);
    case 'sidearm':
      return pistol(def.id === 'sheriff' || def.id === 'bandit');
    case 'sniper':
      return sniper();
    case 'shotgun':
      return def.slot === 'secondary' ? pistol(true) : shotgun();
    case 'melee':
      return knife();
  }
}

export interface ViewmodelState {
  /** 0..1 equip progress (1 = ready). */
  equip: number;
  /** 0..1 reload progress, or -1 when not reloading. */
  reload: number;
  zoomBlend: number;
  hideForScope: boolean;
  speed: number;
  grounded: boolean;
  /** Mouse delta this frame in degrees, for sway. */
  lookDX: number;
  lookDY: number;
}

/**
 * Orientation that points a knife's blade (its local -Z) along `blade` with its flat side
 * (local +X) turned toward `flat`, both in view space.
 */
function knifeOrientation(blade: THREE.Vector3, flat: THREE.Vector3): THREE.Quaternion {
  const z = blade.clone().normalize().negate();
  const x = flat.clone().sub(z.clone().multiplyScalar(flat.dot(z))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Where the knife hand rests and where it goes for an inspect, relative to the weapon holder. */
const KNIFE_REST_POS = new THREE.Vector3(-0.012, 0.04, 0.18);
const KNIFE_REST_Q = knifeOrientation(new THREE.Vector3(-0.32, 0.72, -0.6), new THREE.Vector3(0.45, 0.2, 0.87));
/** The knife arm's elbow stays put (off screen, bottom right); the forearm always spans wrist to elbow. */
const KNIFE_ELBOW = new THREE.Vector3(0.14, -0.23, 0.46);
const KNIFE_PRESENT_POS = new THREE.Vector3(-0.13, 0.095, 0.25);
const KNIFE_PRESENT_Q = knifeOrientation(new THREE.Vector3(-0.22, 1, -0.3), new THREE.Vector3(0.2, 0, 1));
const BUTTERFLY_WRIST = new THREE.Vector3(0, -0.02, 0.13);
const TACTICAL_WRIST = new THREE.Vector3(0, -0.03, 0.1);

/** Additive ribbon left behind the blade tip during slashes. */
class SwingTrail {
  readonly mesh: THREE.Mesh;
  private samples: { tip: THREE.Vector3; base: THREE.Vector3; age: number }[] = [];
  private positions: Float32Array;
  private alphas: Float32Array;
  private geometry = new THREE.BufferGeometry();
  private static readonly MAX = 24;
  private static readonly LIFE = 0.16;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    const n = SwingTrail.MAX;
    this.positions = new Float32Array(n * 2 * 3);
    this.alphas = new Float32Array(n * 2);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#7df9ff') } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor * vAlpha, vAlpha); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  push(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.samples.unshift({ tip: tip.clone(), base: base.clone(), age: 0 });
    if (this.samples.length > SwingTrail.MAX) this.samples.pop();
  }

  update(dt: number): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > SwingTrail.LIFE) this.samples.pop();
    const n = SwingTrail.MAX;
    for (let i = 0; i < n; i++) {
      const s = this.samples[Math.min(i, this.samples.length - 1)];
      const on = i < this.samples.length && this.samples.length > 1;
      if (s) {
        this.positions.set([s.tip.x, s.tip.y, s.tip.z, s.base.x, s.base.y, s.base.z], i * 6);
      }
      const a = on ? (1 - s.age / SwingTrail.LIFE) * (1 - i / n) : 0;
      this.alphas[i * 2] = a * 0.9;
      this.alphas[i * 2 + 1] = a * 0.15;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.visible = this.samples.length > 1;
  }

  clear(): void {
    this.samples = [];
    this.mesh.visible = false;
  }
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private model: Model | null = null;
  private flash: THREE.Sprite;
  private kick = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private flashTime = 0;
  private currentId = '';
  private melee = false;
  /** Knives hang off a wrist pivot so slashes swing from the wrist, not the blade. */
  private wrist = new THREE.Group();
  private forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 1, 4, 12), SLEEVE);
  private joint = new THREE.Vector3();
  private butterfly: ButterflyKnife | null = null;
  private knifeSkin: KnifeSkin = 'butterfly';
  private glow: GlowColors = { core: '#7df9ff', halo: '#38e8ff' };
  private glowLight = new THREE.PointLight('#7df9ff', 0, 0.45, 2);
  private trail = new SwingTrail();
  private clock = 0;
  private anim: { kind: KnifeAnimKind | 'gunInspect'; t0: number; combo: number } | null = null;
  private combo = 0;
  private idle = 0;
  private lastFlip = 1;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private twistAxis = new THREE.Vector3(0, 0, 1);
  /** Called when a balisong flip locks (blade or handle snaps into place). */
  onFlipClick: (() => void) | null = null;
  visible = true;

  constructor(renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 10);
    // Soft studio reflections so metal parts read as metal instead of black.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.holder.scale.setScalar(0.82);
    this.scene.add(this.holder);
    this.scene.add(new THREE.HemisphereLight('#dfe8f2', '#4a4038', 1.4));
    const key = new THREE.DirectionalLight('#fff3e0', 2.2);
    key.position.set(0.6, 1, 0.4);
    this.scene.add(key);
    // Always present (just dark when unused) so switching weapons never recompiles shaders.
    this.scene.add(this.glowLight);
    this.scene.add(this.trail.mesh);
    const tex = flashTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffd59a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.16, 0.16, 0.16);
    this.flash.visible = false;
    this.holder.add(this.flash);
  }

  /** Choose the knife skin and its glow colors; rebuilds the knife if it's out. */
  setKnife(skin: KnifeSkin, glow: GlowColors): void {
    const rebuild = skin !== this.knifeSkin && this.melee;
    this.knifeSkin = skin;
    this.glow = glow;
    this.butterfly?.setColors(glow);
    this.glowLight.color.set(glow.core);
    this.trail.material.uniforms.uColor.value.set(skin === 'butterfly' ? glow.halo : '#ffffff');
    if (rebuild) {
      const id = this.currentId;
      this.currentId = '';
      this.setWeapon({ id, category: 'melee' } as WeaponDef);
    }
  }

  setWeapon(def: WeaponDef): void {
    if (this.currentId === def.id) return;
    this.currentId = def.id;
    if (this.model) this.holder.remove(this.model.root);
    this.holder.remove(this.wrist, this.forearm);
    this.butterfly?.dispose();
    this.butterfly = null;
    this.wrist.clear();
    this.trail.clear();
    this.anim = null;
    this.melee = def.category === 'melee';
    if (this.melee) {
      const root = new THREE.Group();
      if (this.knifeSkin === 'butterfly') {
        this.butterfly = new ButterflyKnife(this.glow);
        this.butterfly.root.position.copy(BUTTERFLY_WRIST).negate();
        this.wrist.add(this.butterfly.root);
        this.joint.copy(ButterflyKnife.WRIST_JOINT).sub(BUTTERFLY_WRIST);
      } else {
        const k = knife();
        k.root.position.copy(TACTICAL_WRIST).negate();
        this.wrist.add(k.root);
        this.joint.copy(TACTICAL_JOINT).sub(TACTICAL_WRIST);
      }
      this.holder.add(this.wrist, this.forearm);
      this.model = { root, muzzle: new THREE.Vector3() };
    } else {
      this.model = modelFor(def);
      this.holder.add(this.model.root);
    }
    this.flash.position.copy(this.model.muzzle);
  }

  /** Play the draw animation for the weapon that was just equipped. */
  onEquip(): void {
    if (this.melee) this.start('draw');
    else this.anim = null;
  }

  /** Inspect (VALORANT default key: Y). Ignored while another animation plays. */
  inspect(): void {
    if (this.anim && this.anim.kind !== 'fidget') return;
    this.start(this.melee ? 'inspect' : 'gunInspect');
  }

  onShot(silenced: boolean): void {
    if (this.anim?.kind === 'gunInspect') this.anim = null;
    this.kick = Math.min(1.6, this.kick + 1);
    this.kickRot = Math.min(1.6, this.kickRot + 1);
    this.flashTime = silenced ? 0.025 : 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = silenced ? 0.08 : 0.16;
    this.flash.scale.set(s, s, s);
  }

  onSwing(heavy: boolean): void {
    this.start(heavy ? 'heavy' : 'swing', heavy ? 0 : this.combo++);
  }

  /** Cancel an inspect (e.g. when reloading or aiming). */
  interrupt(): void {
    if (this.anim && (this.anim.kind === 'inspect' || this.anim.kind === 'gunInspect' || this.anim.kind === 'fidget')) this.anim = null;
  }

  get inspecting(): boolean {
    return this.anim?.kind === 'inspect' || this.anim?.kind === 'gunInspect';
  }

  private start(kind: KnifeAnimKind | 'gunInspect', combo = 0): void {
    this.anim = { kind, t0: this.clock, combo };
    this.idle = 0;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, s: ViewmodelState): void {
    const m = this.model;
    if (!m) return;
    this.clock += dt;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;

    const targetSwayX = Math.max(-1, Math.min(1, -s.lookDX * 0.04));
    const targetSwayY = Math.max(-1, Math.min(1, s.lookDY * 0.04));
    const k = Math.min(1, dt * 10);
    this.swayX += (targetSwayX - this.swayX) * k;
    this.swayY += (targetSwayY - this.swayY) * k;
    if (s.grounded && s.speed > 0.3) this.bobPhase += dt * (4 + s.speed * 1.4);
    const bobAmt = s.grounded ? Math.min(1, s.speed / 5.4) : 0;

    const z = s.zoomBlend;
    // Hip pose (low right, angled in toward the crosshair) blending into a centered ADS pose.
    let x = 0.19 * (1 - z);
    let y = -0.185 * (1 - z) + -0.138 * z;
    let zz = -0.56 * (1 - z) + -0.52 * z;
    let rx = 0.02 * (1 - z);
    let ry = 0.085 * (1 - z);
    let rz = 0.025 * (1 - z);

    x += this.swayX * 0.012 * (1 - z * 0.8) + Math.sin(this.bobPhase) * 0.006 * bobAmt;
    y += this.swayY * 0.012 * (1 - z * 0.8) - Math.abs(Math.cos(this.bobPhase)) * 0.008 * bobAmt;
    ry += this.swayX * 0.04;
    rx += this.swayY * 0.04;

    zz += this.kick * 0.035;
    rx += this.kickRot * 0.05;

    if (s.equip < 1 && !this.melee) {
      const e = 1 - s.equip;
      y -= e * e * 0.3;
      rx -= e * e * 0.7;
    }
    if (s.reload >= 0) {
      if (this.inspecting) this.anim = null;
      const r = Math.sin(Math.min(1, s.reload) * Math.PI);
      y -= r * 0.09;
      rx += r * 0.55;
      rz += r * 0.35;
    }
    if (z > 0.05 && this.inspecting) this.anim = null;

    // Expire finished animations; idle fidget for the balisong.
    if (this.anim) {
      const len = this.anim.kind === 'gunInspect' ? GUN_INSPECT_LENGTH : KNIFE_ANIM_LENGTH[this.anim.kind];
      if (this.clock - this.anim.t0 >= len) this.anim = null;
    }
    if (!this.anim && this.butterfly) {
      this.idle += dt;
      if (this.idle > 9) this.start('fidget');
    }

    if (this.anim?.kind === 'gunInspect') {
      const g = gunInspectPose(this.clock - this.anim.t0);
      x += g.pos[0];
      y += g.pos[1];
      zz += g.pos[2];
      rx += g.rot[0];
      ry += g.rot[1];
      rz += g.rot[2];
    }

    this.holder.position.set(x, y, zz);
    this.holder.rotation.set(rx, ry, rz);
    this.holder.visible = this.visible && !s.hideForScope;

    if (this.melee) this.updateKnife(dt);
    else this.glowLight.intensity = 0;
  }

  private updateKnife(dt: number): void {
    const a = this.anim;
    const pose = a && a.kind !== 'gunInspect' ? knifePose(a.kind, this.clock - a.t0, a.combo) : restPose();
    // View-space offset * (rest -> inspect blend) * twist about the knife's own long axis.
    this.wrist.position.lerpVectors(KNIFE_REST_POS, KNIFE_PRESENT_POS, pose.present).add(this.tmpA.set(...pose.pos));
    const q = this.wrist.quaternion.slerpQuaternions(KNIFE_REST_Q, KNIFE_PRESENT_Q, pose.present);
    q.premultiply(this.tmpQ.setFromEuler(this.tmpE.set(pose.rot[0], pose.rot[1], pose.rot[2])));
    q.multiply(this.tmpQ.setFromAxisAngle(this.twistAxis, pose.twist));
    this.wrist.scale.setScalar(1.22);
    // Forearm from the wrist joint (wherever the animation put it) back to the fixed elbow.
    this.wrist.updateMatrix();
    const j = this.tmpA.copy(this.joint).applyMatrix4(this.wrist.matrix);
    const dir = this.tmpB.copy(KNIFE_ELBOW).sub(j);
    const len = dir.length();
    this.forearm.position.copy(j).addScaledVector(dir, 0.5);
    this.forearm.quaternion.setFromUnitVectors(this.twistAxis.set(0, 1, 0), dir.normalize());
    this.twistAxis.set(0, 0, 1);
    this.forearm.scale.set(1, Math.max(0.05, len - 0.048), 1);
    const b = this.butterfly;
    if (!b) {
      this.glowLight.intensity = 0;
      this.trail.update(dt);
      return;
    }
    b.setFlip(pose.flip);
    b.knife.position.set(...pose.tossPos);
    b.knife.rotation.set(...pose.tossRot);
    // A click each time the blade locks open/closed or the free handle slaps shut.
    const prev = this.lastFlip;
    const f = pose.flip;
    if ((prev < 0.5) !== (f < 0.5) || (prev < 0.995 && f >= 0.995) || (prev > 0.005 && f <= 0.005)) this.onFlipClick?.();
    this.lastFlip = f;

    const strength = b.update(dt);
    this.holder.updateWorldMatrix(true, true);
    b.bladeCenter(this.tmpA);
    this.glowLight.position.copy(this.tmpA);
    this.glowLight.intensity = 0.32 * strength;
    if (pose.trail) {
      b.bladePoints(this.tmpA, this.tmpB);
      this.trail.push(this.tmpA, this.tmpB);
    }
    this.trail.update(dt);
  }
}

function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,150,0.9)');
  g.addColorStop(1, 'rgba(255,150,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 64 : 26;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
