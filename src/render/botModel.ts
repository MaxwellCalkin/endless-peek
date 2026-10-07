import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HITBOXES } from '../config/agent';
import type { Stance } from '../world/layout';

/**
 * Procedural training-bot mannequin built from primitives and merged into one geometry per
 * stance. Every part also carries an `outlineDir` attribute (direction from the part's center)
 * so a screen-space outline can be extruded without cracks, VALORANT-enemy-highlight style.
 */

const SUIT = new THREE.Color('#2a2f38');
const PLATE = new THREE.Color('#c9ced6');
const DARK = new THREE.Color('#15181d');
const VISOR = new THREE.Color('#ff6b6b');

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  emissive?: number;
}

function finishPart(geo: THREE.BufferGeometry, color: THREE.Color, m: THREE.Matrix4, emissive = 0): Part {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(m);
  g.computeBoundingBox();
  const center = new THREE.Vector3();
  g.boundingBox!.getCenter(center);
  const pos = g.getAttribute('position');
  const dirs = new Float32Array(pos.count * 3);
  const colors = new Float32Array(pos.count * 3);
  const glow = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center).normalize();
    dirs[i * 3] = v.x;
    dirs[i * 3 + 1] = v.y;
    dirs[i * 3 + 2] = v.z;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    glow[i] = emissive;
  }
  g.setAttribute('outlineDir', new THREE.BufferAttribute(dirs, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  g.deleteAttribute('uv');
  return { geo: g, color };
}

function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Capsule between two points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color): Part {
  const len = a.distanceTo(b);
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 8);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
  return finishPart(geo, color, m);
}

function boxPart(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color, rx = 0, emissive = 0): Part {
  return finishPart(new THREE.BoxGeometry(w, h, d), color, at(x, y, z, rx), emissive);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function buildParts(stance: Stance): Part[] {
  const hb = HITBOXES[stance];
  const headY = hb.head.y;
  const headZ = hb.head.z;
  const parts: Part[] = [];
  if (stance === 'stand') {
    // Legs
    parts.push(limb(V(-0.1, 0.1, 0.02), V(-0.11, 0.52, 0), 0.075, SUIT));
    parts.push(limb(V(-0.11, 0.52, 0), V(-0.11, 0.9, 0), 0.085, SUIT));
    parts.push(limb(V(0.11, 0.1, -0.04), V(0.12, 0.52, -0.02), 0.075, SUIT));
    parts.push(limb(V(0.12, 0.52, -0.02), V(0.11, 0.9, 0), 0.085, SUIT));
    parts.push(boxPart(0.12, 0.08, 0.24, -0.1, 0.04, -0.03, DARK));
    parts.push(boxPart(0.12, 0.08, 0.24, 0.11, 0.04, -0.07, DARK));
    parts.push(boxPart(0.13, 0.13, 0.09, -0.11, 0.5, -0.08, PLATE));
    parts.push(boxPart(0.13, 0.13, 0.09, 0.12, 0.5, -0.1, PLATE));
    // Hips and torso
    parts.push(boxPart(0.36, 0.18, 0.22, 0, 0.95, 0, SUIT));
    parts.push(boxPart(0.42, 0.44, 0.26, 0, 1.24, 0, SUIT));
    parts.push(boxPart(0.36, 0.3, 0.06, 0, 1.3, -0.15, PLATE, -0.06));
    parts.push(boxPart(0.3, 0.24, 0.12, 0, 1.33, 0.17, DARK));
  } else {
    // Crouched: knees forward, hips low.
    parts.push(limb(V(-0.12, 0.08, 0.12), V(-0.13, 0.42, -0.22), 0.075, SUIT));
    parts.push(limb(V(-0.13, 0.42, -0.22), V(-0.12, 0.62, 0.05), 0.085, SUIT));
    parts.push(limb(V(0.13, 0.06, 0.2), V(0.14, 0.2, -0.12), 0.075, SUIT));
    parts.push(limb(V(0.14, 0.2, -0.12), V(0.12, 0.6, 0.06), 0.085, SUIT));
    parts.push(boxPart(0.12, 0.08, 0.24, -0.12, 0.04, 0.08, DARK));
    parts.push(boxPart(0.12, 0.1, 0.26, 0.13, 0.05, 0.2, DARK, 0.6));
    parts.push(boxPart(0.13, 0.13, 0.09, -0.13, 0.44, -0.27, PLATE));
    parts.push(boxPart(0.36, 0.18, 0.24, 0, 0.66, 0.05, SUIT));
    parts.push(boxPart(0.42, 0.4, 0.26, 0, 0.88, -0.01, SUIT, 0.15));
    parts.push(boxPart(0.36, 0.28, 0.06, 0, 0.92, -0.16, PLATE, 0.1));
    parts.push(boxPart(0.3, 0.22, 0.12, 0, 0.95, 0.16, DARK, 0.15));
  }
  const shoulderY = headY - 0.2;
  // Shoulders, neck, head.
  parts.push(finishPart(new THREE.SphereGeometry(0.085, 10, 8), PLATE, at(-0.24, shoulderY, headZ * 0.5)));
  parts.push(finishPart(new THREE.SphereGeometry(0.085, 10, 8), PLATE, at(0.24, shoulderY, headZ * 0.5)));
  parts.push(limb(V(0, shoulderY + 0.02, headZ * 0.5), V(0, headY - 0.08, headZ), 0.05, SUIT));
  parts.push(finishPart(new THREE.SphereGeometry(0.125, 16, 12), PLATE, at(0, headY, headZ)));
  parts.push(boxPart(0.19, 0.06, 0.07, 0, headY + 0.005, headZ - 0.1, DARK));
  parts.push(boxPart(0.17, 0.035, 0.02, 0, headY + 0.005, headZ - 0.135, VISOR, 0, 1));
  // Arms holding a rifle at the shoulder, aimed forward.
  const gunY = shoulderY - 0.06;
  const gz = headZ * 0.5;
  parts.push(limb(V(0.24, shoulderY - 0.02, gz), V(0.2, gunY - 0.12, gz - 0.12), 0.055, SUIT));
  parts.push(limb(V(0.2, gunY - 0.12, gz - 0.12), V(0.09, gunY - 0.02, gz - 0.2), 0.05, SUIT));
  parts.push(limb(V(-0.24, shoulderY - 0.02, gz), V(-0.12, gunY - 0.1, gz - 0.22), 0.055, SUIT));
  parts.push(limb(V(-0.12, gunY - 0.1, gz - 0.22), V(0.06, gunY - 0.03, gz - 0.42), 0.05, SUIT));
  // Rifle
  parts.push(boxPart(0.06, 0.09, 0.72, 0.07, gunY, gz - 0.36, DARK));
  parts.push(boxPart(0.05, 0.14, 0.06, 0.07, gunY - 0.1, gz - 0.28, DARK));
  parts.push(boxPart(0.04, 0.04, 0.26, 0.07, gunY + 0.01, gz - 0.84, DARK));
  return parts;
}

export interface BotGeometry {
  body: THREE.BufferGeometry;
}

const geometryCache = new Map<Stance, THREE.BufferGeometry>();

export function botGeometry(stance: Stance): THREE.BufferGeometry {
  let g = geometryCache.get(stance);
  if (!g) {
    const parts = buildParts(stance);
    g = mergeGeometries(parts.map((p) => p.geo), false)!;
    g.computeBoundingSphere();
    geometryCache.set(stance, g);
  }
  return g;
}

export function makeBodyMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05 });
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFlash = { value: 0 };
    m.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.6 + vec3(uFlash);',
      );
  };
  m.customProgramCacheKey = () => 'bot-body';
  return m;
}

/** Screen-space extruded outline drawn only where the body did not write stencil. */
export function makeOutlineMaterial(color: THREE.ColorRepresentation, widthPx: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uWidth: { value: widthPx },
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 outlineDir;
      uniform float uWidth;
      uniform vec2 uResolution;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec4 dirClip = projectionMatrix * modelViewMatrix * vec4(position + outlineDir * 0.05, 1.0);
        vec2 d = dirClip.xy / dirClip.w - clip.xy / clip.w;
        float l = length(d);
        if (l > 1e-6) clip.xy += (d / l) * uWidth * 2.0 / uResolution * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    transparent: true,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });
}

/** Wireframe boxes matching the hitboxes, for the "show hitboxes" option. */
export function hitboxHelper(stance: Stance): THREE.Group {
  const g = new THREE.Group();
  const hb = HITBOXES[stance];
  const colors = { head: '#ff3355', body: '#ffcc33', legs: '#33ccff' } as const;
  for (const key of ['head', 'body', 'legs'] as const) {
    const b = hb[key];
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colors[key], depthTest: false, transparent: true }));
    line.position.set(0, b.y, b.z);
    line.renderOrder = 10;
    g.add(line);
  }
  return g;
}
