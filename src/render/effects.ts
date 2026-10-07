import * as THREE from 'three';

interface Timed {
  obj: THREE.Object3D;
  life: number;
  max: number;
  kind: 'tracer' | 'puff' | 'spark';
  vel?: THREE.Vector3;
}

const TRACER_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
const DECAL_GEO = new THREE.PlaneGeometry(0.06, 0.06);
const PUFF_GEO = new THREE.PlaneGeometry(1, 1);

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Pooled tracers, impact decals, dust puffs and hit sparks. */
export class Effects {
  readonly group = new THREE.Group();
  private live: Timed[] = [];
  private decals: THREE.Mesh[] = [];
  private decalIndex = 0;
  private puffTex = puffTexture();
  private decalMat = new THREE.MeshBasicMaterial({
    color: '#1a1a1a',
    transparent: true,
    opacity: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    depthWrite: false,
  });

  constructor() {
    for (let i = 0; i < 96; i++) {
      const d = new THREE.Mesh(DECAL_GEO, this.decalMat);
      d.visible = false;
      d.matrixAutoUpdate = false;
      this.group.add(d);
      this.decals.push(d);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.012, life = 0.06): void {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(TRACER_GEO, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(width, width, len);
    this.group.add(m);
    this.live.push({ obj: m, life, max: life, kind: 'tracer' });
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation): void {
    const d = this.decals[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % this.decals.length;
    d.position.copy(point).addScaledVector(normal, 0.003);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI);
    d.updateMatrix();
    d.visible = true;
    this.puff(point.clone().addScaledVector(normal, 0.05), color, 0.25, 0.28);
  }

  puff(point: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.puffTex, color, transparent: true, opacity: 0.6, depthWrite: false });
    const m = new THREE.Mesh(PUFF_GEO, mat);
    m.position.copy(point);
    m.scale.setScalar(size);
    m.userData.billboard = true;
    this.group.add(m);
    this.live.push({ obj: m, life, max: life, kind: 'puff' });
  }

  sparks(point: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(PUFF_GEO, mat);
      m.position.copy(point);
      m.scale.setScalar(0.035);
      m.userData.billboard = true;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.group.add(m);
      this.live.push({ obj: m, life: 0.25, max: 0.25, kind: 'spark', vel: v });
    }
  }

  clearDecals(): void {
    for (const d of this.decals) d.visible = false;
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.life -= dt;
      const mesh = e.obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const k = Math.max(0, e.life / e.max);
      if (e.kind === 'tracer') mat.opacity = 0.85 * k;
      else if (e.kind === 'puff') {
        mat.opacity = 0.6 * k;
        mesh.scale.multiplyScalar(1 + dt * 2.5);
      } else if (e.vel) {
        e.vel.y -= 9.8 * dt;
        mesh.position.addScaledVector(e.vel, dt);
        mat.opacity = k;
      }
      if (mesh.userData.billboard) mesh.quaternion.copy(camera.quaternion);
      if (e.life <= 0) {
        this.group.remove(mesh);
        mat.dispose();
        this.live.splice(i, 1);
      }
    }
  }
}
