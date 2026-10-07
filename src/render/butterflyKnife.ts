import * as THREE from 'three';

/**
 * An original glowing balisong (butterfly knife) for the first-person view.
 *
 * Mechanics: two handles sandwich the blade, one on each flat side, each turning on its own
 * pin through the blade's tang. Everything is posed in the frame of the "bite" handle, the
 * one held in the fist:
 *   - `blade` is the blade's angle about the pin axis relative to the bite handle
 *     (0 = open, pointing forward; PI = closed, lying back inside the handles).
 *   - `safe` is the free handle's angle relative to the blade (0 = open, PI = closed over it).
 *
 * Local axes: forward (blade, when open) is -Z, the spine faces +Y, flats face +/-X.
 */

export interface GlowColors {
  /** Bright core color (edges, inlays). */
  core: string;
  /** Softer halo color. */
  halo: string;
}

const BLADE_LEN = 0.12;
const HANDLE_LEN = 0.13;
const BLADE_T = 0.0032;
const HANDLE_T = 0.0055;
const HANDLE_H = 0.0175;
const HANDLE_X = BLADE_T / 2 + HANDLE_T / 2;

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Pin angles for a flip. t = 0 is closed, 1 is open. The free handle swings a full turn over
 * the top of the fist while the blade rides along until it locks open halfway through.
 */
export function balisongPose(t: number): { blade: number; safe: number } {
  const swing = 2 * Math.PI * smooth(t);
  return { blade: Math.PI - Math.min(swing, Math.PI), safe: Math.PI - Math.max(0, swing - Math.PI) };
}

/** Convert an extruded 2D profile (x along the part, y up, extruded along +Z) into knife space. */
function bladeGeometry(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 });
  // (x, y, z) -> (z, y, -x): length runs forward (-Z), extrusion becomes thickness along X.
  g.rotateY(Math.PI / 2);
  g.translate(-thickness / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function handleGeometry(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 10 });
  // (x, y, z) -> (-z, y, x): length runs back toward the palm (+Z).
  g.rotateY(-Math.PI / 2);
  g.translate(thickness / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function roundedSlot(path: THREE.Path, x0: number, x1: number, h: number): void {
  const r = h;
  path.moveTo(x0 + r, -h);
  path.lineTo(x1 - r, -h);
  path.absarc(x1 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(x0 + r, h);
  path.absarc(x0 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
}

function bladeShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.009, 0.0062);
  s.lineTo(0.016, 0.0085);
  s.lineTo(0.08, 0.0085);
  s.quadraticCurveTo(0.104, 0.0078, BLADE_LEN, 0.0004);
  s.quadraticCurveTo(0.106, -0.0092, 0.076, -0.0106);
  s.lineTo(0.022, -0.0106);
  s.quadraticCurveTo(0.014, -0.0106, 0.012, -0.0062);
  s.lineTo(-0.009, -0.0056);
  s.quadraticCurveTo(-0.0135, 0, -0.009, 0.0062);
  return s;
}

/** A thin band hugging the cutting edge, from the choil to the tip. */
function edgeShape(): THREE.Shape {
  const outer = new THREE.QuadraticBezierCurve(new THREE.Vector2(0.076, -0.0118), new THREE.Vector2(0.108, -0.0102), new THREE.Vector2(BLADE_LEN + 0.0012, 0.0004));
  const inner = new THREE.QuadraticBezierCurve(new THREE.Vector2(0.076, -0.0086), new THREE.Vector2(0.101, -0.0074), new THREE.Vector2(BLADE_LEN - 0.002, 0.0006));
  const s = new THREE.Shape();
  s.moveTo(0.021, -0.0118);
  s.lineTo(0.076, -0.0118);
  for (const p of outer.getPoints(10).slice(1)) s.lineTo(p.x, p.y);
  for (const p of inner.getPoints(10).reverse()) s.lineTo(p.x, p.y);
  s.lineTo(0.021, -0.0086);
  s.closePath();
  return s;
}

function handleShape(): THREE.Shape {
  const h = HANDLE_H / 2;
  const s = new THREE.Shape();
  const x0 = -0.01;
  const x1 = HANDLE_LEN;
  s.moveTo(x0 + h, -h);
  s.lineTo(x1 - h * 0.6, -h);
  s.quadraticCurveTo(x1, -h, x1, -h * 0.2);
  s.lineTo(x1, h * 0.2);
  s.quadraticCurveTo(x1, h, x1 - h * 0.6, h);
  s.lineTo(x0 + h, h);
  s.absarc(x0 + h, 0, h, Math.PI / 2, (3 * Math.PI) / 2, false);
  // Skeleton cut-outs the glowing core shows through.
  for (const [a, b] of [
    [0.024, 0.05],
    [0.058, 0.084],
    [0.092, 0.118],
  ]) {
    const hole = new THREE.Path();
    roundedSlot(hole, a, b, 0.0042);
    s.holes.push(hole);
  }
  return s;
}

let haloTexture: THREE.Texture | null = null;
function halo(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  return haloTexture;
}

export class ButterflyKnife {
  /** Positioned by the viewmodel; holds the fist and the knife. */
  readonly root = new THREE.Group();
  /** The knife in the fist's frame. Animations move this to toss and twirl the knife. */
  readonly knife = new THREE.Group();
  private bladePivot = new THREE.Group();
  private safePivot = new THREE.Group();
  private coreMat: THREE.MeshBasicMaterial;
  private haloMat: THREE.SpriteMaterial;
  private halos: THREE.Sprite[] = [];
  private auraMat: THREE.SpriteMaterial;
  /** Blade tip and blade base in blade space, for swing trails. */
  readonly tipLocal = new THREE.Vector3(0, -0.002, -BLADE_LEN);
  readonly baseLocal = new THREE.Vector3(0, -0.004, -0.03);
  private pulse = 0;

  constructor(colors: GlowColors) {
    const handleMat = new THREE.MeshStandardMaterial({ color: '#1d2129', metalness: 0.85, roughness: 0.32 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: '#d9e0e8', metalness: 1, roughness: 0.16 });
    const pinMat = new THREE.MeshStandardMaterial({ color: '#8a94a3', metalness: 1, roughness: 0.3 });
    this.coreMat = new THREE.MeshBasicMaterial({ color: colors.core, toneMapped: false });
    this.haloMat = new THREE.SpriteMaterial({
      map: halo(),
      color: colors.halo,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      toneMapped: false,
    });

    // Blade with a glowing edge and a glowing fuller line on both flats.
    const blade = new THREE.Mesh(bladeGeometry(bladeShape(), BLADE_T), bladeMat);
    const edge = new THREE.Mesh(bladeGeometry(edgeShape(), BLADE_T + 0.0006), this.coreMat);
    this.bladePivot.add(blade, edge);
    for (const side of [-1, 1]) {
      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.0004, 0.0012, 0.058), this.coreMat);
      fuller.position.set(side * (BLADE_T / 2 + 0.0002), 0.0028, -0.052);
      this.bladePivot.add(fuller);
    }
    for (const s of [0.028, 0.044, 0.06, 0.076, 0.092, 0.108]) {
      const sp = new THREE.Sprite(this.haloMat);
      const h = s > 0.1 ? -0.004 : -0.0105;
      sp.position.set(0, h, -s);
      sp.scale.setScalar(0.042);
      this.bladePivot.add(sp);
      this.halos.push(sp);
    }
    // One wide, faint halo for a bloom-like aura around the whole blade.
    this.auraMat = this.haloMat.clone();
    const aura = new THREE.Sprite(this.auraMat);
    aura.position.set(0, -0.004, -0.065);
    aura.scale.setScalar(0.14);
    this.bladePivot.add(aura);

    // Handles: the bite handle stays in the fist; the safe handle hangs off the blade.
    const handleGeo = handleGeometry(handleShape(), HANDLE_T);
    const bite = new THREE.Mesh(handleGeo, handleMat);
    bite.position.x = HANDLE_X;
    const safe = new THREE.Mesh(handleGeo, handleMat);
    safe.position.x = -HANDLE_X;
    const coreGeo = new THREE.BoxGeometry(HANDLE_T * 0.35, 0.0075, 0.096);
    const biteCore = new THREE.Mesh(coreGeo, this.coreMat);
    biteCore.position.set(HANDLE_X, 0, 0.071);
    const safeCore = new THREE.Mesh(coreGeo, this.coreMat);
    safeCore.position.set(-HANDLE_X, 0, 0.071);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0045, 0.014), pinMat);
    latch.position.set(HANDLE_X + HANDLE_T / 2 + 0.0011, -0.0045, HANDLE_LEN - 0.012);
    this.knife.add(bite, biteCore, latch);
    for (const z of [0.037, 0.105]) {
      const sp = new THREE.Sprite(this.haloMat);
      sp.position.set(HANDLE_X, 0, z);
      sp.scale.setScalar(0.026);
      this.knife.add(sp);
      this.halos.push(sp);
    }
    this.safePivot.add(safe, safeCore);
    for (const z of [0.037, 0.105]) {
      const sp = new THREE.Sprite(this.haloMat);
      sp.position.set(-HANDLE_X, 0, z);
      sp.scale.setScalar(0.026);
      this.safePivot.add(sp);
      this.halos.push(sp);
    }
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0021, 0.0021, HANDLE_X * 2 + HANDLE_T, 12), pinMat);
    pin.rotation.z = Math.PI / 2;
    this.knife.add(pin);
    this.bladePivot.add(this.safePivot);
    this.knife.add(this.bladePivot);

    // A gloved fist wrapped around the bite handle, and the forearm leaving frame.
    const glove = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.85, metalness: 0.05 });
    const cuff = new THREE.MeshStandardMaterial({ color: '#3d4552', roughness: 0.7 });
    const capsule = (r: number, len: number, mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      return m;
    };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Four fingers curling over the handles from the far side, palm on the near side.
    for (const [i, z] of [0.042, 0.06, 0.078, 0.096].entries()) {
      const r = i === 3 ? 0.0072 : 0.0082;
      this.root.add(capsule(r, 0.016, glove, v(0.014, -0.014, z), v(-0.011, -0.012, z)));
      this.root.add(capsule(r * 0.95, 0.008, glove, v(-0.013, -0.011, z), v(-0.012, 0.004, z - 0.002)));
    }
    // Palm and heel of the hand as rounded pads, then the thumb across the top.
    this.root.add(capsule(0.013, 0.05, glove, v(0.017, -0.015, 0.042), v(0.018, -0.017, 0.1)));
    this.root.add(capsule(0.011, 0.03, glove, v(0.006, -0.026, 0.06), v(0.006, -0.028, 0.105)));
    this.root.add(capsule(0.0078, 0.026, glove, v(0.017, 0.002, 0.08), v(0.009, 0.011, 0.042)));
    this.root.add(capsule(0.022, 0.016, cuff, v(0.012, -0.02, 0.118), v(0.016, -0.028, 0.14)));
    this.root.add(this.knife);
    this.setFlip(1);
  }

  setColors(colors: GlowColors): void {
    this.coreMat.color.set(colors.core);
    this.haloMat.color.set(colors.halo);
    this.auraMat.color.set(colors.halo);
  }

  /** 0 = closed, 1 = open. */
  setFlip(t: number): void {
    const p = balisongPose(t);
    this.bladePivot.rotation.x = p.blade;
    this.safePivot.rotation.x = p.safe;
  }

  /** Gentle breathing glow. Returns the current glow strength (for the scene light). */
  update(dt: number): number {
    this.pulse += dt;
    const k = 0.82 + 0.18 * Math.sin(this.pulse * 2.4);
    this.haloMat.opacity = 0.7 * k;
    this.auraMat.opacity = 0.22 * k;
    return k;
  }

  /** World positions of the blade tip and a point near its base (for trails). */
  bladePoints(tip: THREE.Vector3, base: THREE.Vector3): void {
    this.bladePivot.updateWorldMatrix(true, false);
    tip.copy(this.tipLocal).applyMatrix4(this.bladePivot.matrixWorld);
    base.copy(this.baseLocal).applyMatrix4(this.bladePivot.matrixWorld);
  }

  /** Where the forearm attaches (the cuff), in this knife's root space. */
  static readonly WRIST_JOINT = new THREE.Vector3(0.016, -0.028, 0.14);

  /** World position of the blade's middle, where the glow light sits. */
  bladeCenter(out: THREE.Vector3): void {
    this.bladePivot.updateWorldMatrix(true, false);
    out.set(0, -0.004, -0.06).applyMatrix4(this.bladePivot.matrixWorld);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
