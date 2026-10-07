import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { WeaponCategory, WeaponDef } from '../config/weapons';

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
  g.add(capsule(0.032, 0.3, SLEEVE, v3(0.01, -0.04, 0.07), v3(0.08, -0.22, 0.34)));
  return { root: g, muzzle: new THREE.Vector3(0, 0.02, -0.22) };
}

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
  private swing = 0;
  private currentId = '';
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
    const tex = flashTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffd59a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.16, 0.16, 0.16);
    this.flash.visible = false;
    this.holder.add(this.flash);
  }

  setWeapon(def: WeaponDef): void {
    if (this.currentId === def.id) return;
    this.currentId = def.id;
    if (this.model) this.holder.remove(this.model.root);
    this.model = modelFor(def);
    this.holder.add(this.model.root);
    this.flash.position.copy(this.model.muzzle);
  }

  onShot(silenced: boolean): void {
    this.kick = Math.min(1.6, this.kick + 1);
    this.kickRot = Math.min(1.6, this.kickRot + 1);
    this.flashTime = silenced ? 0.025 : 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = silenced ? 0.08 : 0.16;
    this.flash.scale.set(s, s, s);
  }

  onSwing(): void {
    this.swing = 1;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, s: ViewmodelState): void {
    const m = this.model;
    if (!m) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    this.swing = Math.max(0, this.swing - dt * 4);
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

    if (s.equip < 1) {
      const e = 1 - s.equip;
      y -= e * e * 0.3;
      rx -= e * e * 0.7;
    }
    if (s.reload >= 0) {
      const r = Math.sin(Math.min(1, s.reload) * Math.PI);
      y -= r * 0.09;
      rx += r * 0.55;
      rz += r * 0.35;
    }
    if (this.swing > 0) {
      const w = Math.sin(this.swing * Math.PI);
      x -= w * 0.12;
      ry += w * 0.9;
      rz -= w * 0.4;
    }

    this.holder.position.set(x, y, zz);
    this.holder.rotation.set(rx, ry, rz);
    this.holder.visible = this.visible && !s.hideForScope;
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
