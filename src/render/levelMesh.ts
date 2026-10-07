import * as THREE from 'three';
import type { MaterialSlot } from '../world/layout';
import type { Segment, WorldBox } from '../world/hallway';
import { crateTexture, floorTexture, metalTexture, plainTexture, wallTexture } from './textures';
import { THEMES, type Theme } from './themes';

/**
 * Turns a segment's boxes into a handful of merged meshes (one per material slot).
 * World-space UVs keep texel density constant on every wall; crates and the seal use
 * per-face UVs so their artwork frames each face.
 */

type UvMode = 'world' | 'face';

interface SlotStyle {
  uv: UvMode;
  /** Meters covered by one texture repeat (world UVs). */
  scale: number;
}

const STYLE: Record<MaterialSlot, SlotStyle> = {
  wall: { uv: 'world', scale: 2.5 },
  accent: { uv: 'world', scale: 1.5 },
  floor: { uv: 'world', scale: 2.0 },
  platform: { uv: 'world', scale: 2.0 },
  metal: { uv: 'world', scale: 1.0 },
  crate: { uv: 'face', scale: 1 },
  crateAlt: { uv: 'face', scale: 1 },
  seal: { uv: 'face', scale: 1 },
};

/** Shader tweak shared by world materials: contact darkening near the floor and an optional painted stripe. */
function addWallShading(mat: THREE.MeshStandardMaterial, theme: Theme, stripe: boolean): void {
  const accent = new THREE.Color(theme.accent);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStripeY = { value: stripe ? theme.stripeY : -10 };
    shader.uniforms.uStripeH = { value: theme.stripeH };
    shader.uniforms.uStripeColor = { value: accent };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPos;\nuniform float uStripeY;\nuniform float uStripeH;\nuniform vec3 uStripeColor;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float ao = mix(0.62, 1.0, smoothstep(0.0, 0.85, vWorldPos.y));
        diffuseColor.rgb *= ao;
        // Two-tone wainscot below the painted stripe, then the stripe itself.
        float below = step(vWorldPos.y, uStripeY) * step(-5.0, uStripeY);
        diffuseColor.rgb *= mix(1.0, 0.86, below);
        float stripe = step(uStripeY, vWorldPos.y) * step(vWorldPos.y, uStripeY + uStripeH);
        diffuseColor.rgb = mix(diffuseColor.rgb, uStripeColor, stripe * 0.92);`,
      );
  };
  mat.customProgramCacheKey = () => `wall-shading-${stripe ? 1 : 0}`;
}

export class LevelMaterials {
  private cache = new Map<number, Record<MaterialSlot, THREE.Material>>();

  get(themeIndex: number): Record<MaterialSlot, THREE.Material> {
    let set = this.cache.get(themeIndex);
    if (set) return set;
    const theme = THEMES[themeIndex % THEMES.length];
    const seed = 1000 + themeIndex * 17;
    const std = (map: THREE.Texture, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...opts });
    const wall = std(wallTexture(theme, seed));
    addWallShading(wall, theme, theme.stripeH > 0);
    // Pillars: the zone's accent color, muted toward the wall color so it doesn't shout.
    const accentColor = '#' + new THREE.Color(theme.accent).lerp(new THREE.Color(theme.wall), 0.62).getHexString();
    const accent = std(plainTexture(accentColor, theme.wallNoise, seed + 1));
    addWallShading(accent, theme, false);
    const platform = std(plainTexture(theme.platform, theme.wallNoise, seed + 2));
    addWallShading(platform, theme, false);
    const crate = std(crateTexture(theme.crate, theme.crateEdge, seed + 3, false), { roughness: 0.85 });
    addWallShading(crate, theme, false);
    const crateAlt = std(crateTexture(theme.crateAlt, theme.crateAltEdge, seed + 4, true), { roughness: 0.7, metalness: 0.15 });
    addWallShading(crateAlt, theme, false);
    const metal = std(metalTexture(theme, seed + 5, false), { roughness: 0.55, metalness: 0.35 });
    const seal = std(metalTexture(theme, seed + 6, true), { roughness: 0.6, metalness: 0.3 });
    const floor = std(floorTexture(theme, seed + 7), { roughness: 0.95 });
    set = { wall, accent, floor, platform, metal, crate, crateAlt, seal };
    this.cache.set(themeIndex, set);
    return set;
  }
}

class GeometryAccumulator {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /** Adds one quad. Corners are given counter-clockwise when viewed from the normal side. */
  quad(
    p: [number, number, number][],
    n: [number, number, number],
    uv: [number, number][],
  ): void {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i][0], p[i][1], p[i][2]);
      this.normals.push(n[0], n[1], n[2]);
      this.uvs.push(uv[i][0], uv[i][1]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function addBox(acc: GeometryAccumulator, b: WorldBox, style: SlotStyle, skipBottom: boolean): void {
  const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = b;
  const s = 1 / style.scale;
  const face = style.uv === 'face';
  // +X
  acc.quad(
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    [1, 0, 0],
    face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[-z1 * s, y0 * s], [-z0 * s, y0 * s], [-z0 * s, y1 * s], [-z1 * s, y1 * s]],
  );
  // -X
  acc.quad(
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [-1, 0, 0],
    face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[z0 * s, y0 * s], [z1 * s, y0 * s], [z1 * s, y1 * s], [z0 * s, y1 * s]],
  );
  // +Z
  acc.quad(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
    face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]],
  );
  // -Z
  acc.quad(
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ],
    [0, 0, -1],
    face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[-x1 * s, y0 * s], [-x0 * s, y0 * s], [-x0 * s, y1 * s], [-x1 * s, y1 * s]],
  );
  // +Y
  acc.quad(
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [0, 1, 0],
    face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, -z1 * s], [x1 * s, -z1 * s], [x1 * s, -z0 * s], [x0 * s, -z0 * s]],
  );
  if (!skipBottom) {
    acc.quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
      face ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]],
    );
  }
}

export function buildSegmentMesh(seg: Segment, materials: LevelMaterials, extra: WorldBox[] = []): THREE.Group {
  const mats = materials.get(seg.theme);
  const accs = new Map<MaterialSlot, GeometryAccumulator>();
  for (const b of [...seg.boxes, ...extra]) {
    let acc = accs.get(b.mat);
    if (!acc) {
      acc = new GeometryAccumulator();
      accs.set(b.mat, acc);
    }
    // Things standing on the floor never show their bottom face.
    addBox(acc, b, STYLE[b.mat], b.minY >= -0.01 || b.mat === 'floor');
  }
  const group = new THREE.Group();
  group.name = `segment-${seg.index}`;
  for (const [slot, acc] of accs) {
    const mesh = new THREE.Mesh(acc.build(), mats[slot]);
    mesh.castShadow = slot !== 'floor';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

export function buildBoxMesh(b: WorldBox, theme: number, materials: LevelMaterials): THREE.Mesh {
  const acc = new GeometryAccumulator();
  addBox(acc, b, STYLE[b.mat], true);
  const mesh = new THREE.Mesh(acc.build(), materials.get(theme)[b.mat]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
