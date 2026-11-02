// Instancing toolkit. Every plant/prop is a list of part instances (kind, position,
// rotation, scale, colour). Parts of the same kind share one InstancedMesh.
import * as THREE from 'three';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const UP = V(0, 1, 0);
export const qFrom = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());

export type Rng = () => number;
export function rngFrom(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];
export const randQuat = (r: Rng) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
export function randDir(r: Rng, minY = -1, maxY = 1) {
  for (let t = 0; t < 60; t++) {
    const v = V(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    const l = v.length();
    if (l < 0.2 || l > 1) continue;
    v.divideScalar(l);
    if (v.y >= minY && v.y <= maxY) return v;
  }
  return V(0, 1, 0);
}

function prismGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(-0.5, 1);
  shape.lineTo(0.5, 0);
  shape.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

function puddleGeo() {
  const g = new THREE.CircleGeometry(1, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

export type Kind = 'leaf' | 'leafLo' | 'ball' | 'disc' | 'bud' | 'stem' | 'box' | 'cyl' | 'taper' | 'cone' | 'bell' | 'prism' | 'dome' | 'lit' | 'glow' | 'glass' | 'puddle';

interface KindDef { geo: THREE.BufferGeometry; rough: number; metal?: number; emissive?: boolean | string; transparent?: boolean }

export const KINDS: Record<Kind, KindDef> = {
  leaf: { geo: new THREE.IcosahedronGeometry(1, 1), rough: 0.95 },
  // Bushes use the cheaper leaf: hundreds of them are on screen late in a big game.
  leafLo: { geo: new THREE.IcosahedronGeometry(1, 0), rough: 0.95 },
  ball: { geo: new THREE.IcosahedronGeometry(1, 0), rough: 0.8 },
  disc: { geo: new THREE.CylinderGeometry(1, 0.55, 0.35, 7), rough: 0.75 },
  bud: { geo: new THREE.OctahedronGeometry(1, 0), rough: 0.85 }, // stretched: lavender spikes, cattails
  stem: { geo: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), rough: 0.9 },
  box: { geo: new THREE.BoxGeometry(1, 1, 1), rough: 0.9 },
  cyl: { geo: new THREE.CylinderGeometry(1, 1, 1, 10), rough: 0.85 },
  taper: { geo: new THREE.CylinderGeometry(0.6, 1, 1, 7), rough: 0.95 },
  cone: { geo: new THREE.ConeGeometry(1, 1, 10), rough: 0.85 },
  bell: { geo: new THREE.ConeGeometry(1, 1, 6, 1, true), rough: 0.7 },
  prism: { geo: prismGeo(), rough: 0.9 },
  dome: { geo: new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), rough: 0.8 },
  lit: { geo: new THREE.BoxGeometry(1, 1, 1), rough: 0.6, emissive: true },
  // Firefly lily orbs. Instance colours tint only the diffuse part, so the glow colour lives here.
  glow: { geo: new THREE.IcosahedronGeometry(1, 1), rough: 0.4, emissive: '#3DFF7A' },
  glass: { geo: new THREE.BoxGeometry(1, 1, 1), rough: 0.3 },
  puddle: { geo: puddleGeo(), rough: 0.08, metal: 0.35 }
};

export function kindMaterial(kind: Kind): THREE.Material {
  const d = KINDS[kind];
  if (kind === 'puddle') {
    return new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.08, metalness: 0.35, emissive: '#2E4148', emissiveIntensity: 0.5 });
  }
  return new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: d.rough, metalness: d.metal ?? 0, flatShading: true,
    side: kind === 'bell' ? THREE.DoubleSide : THREE.FrontSide,
    ...(d.emissive ? { emissive: typeof d.emissive === 'string' ? d.emissive : '#E8C46A', emissiveIntensity: typeof d.emissive === 'string' ? 0.55 : 0.7 } : {})
  });
}

export interface Inst {
  kind: Kind;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  color: THREE.Color;
}

/** Collects part instances. Positions are local unless the caller adds an offset. */
export class Recipe {
  list: Inst[] = [];
  add(kind: Kind, pos: THREE.Vector3, quat: THREE.Quaternion | null, scale: number | THREE.Vector3, hex: string | THREE.Color) {
    this.list.push({
      kind,
      pos: pos.clone(),
      quat: quat ? quat.clone() : new THREE.Quaternion(),
      scale: typeof scale === 'number' ? V(scale, scale, scale) : scale.clone(),
      color: hex instanceof THREE.Color ? hex.clone() : new THREE.Color(hex)
    });
  }
  box(w: number, h: number, d: number, hex: string, x: number, y: number, z: number, quat: THREE.Quaternion | null = null) {
    this.add('box', V(x, y, z), quat, V(w, h, d), hex);
  }
  /** Rotate every instance about the Y axis around the origin, then translate. */
  transform(rotY: number, offset: THREE.Vector3) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
    for (const it of this.list) {
      it.pos.applyQuaternion(q).add(offset);
      it.quat.premultiply(q);
    }
    return this;
  }
  /** Scale every instance (positions and sizes) about the origin. */
  scaled(f: number) {
    for (const it of this.list) {
      it.pos.multiplyScalar(f);
      it.scale.multiplyScalar(f);
    }
    return this;
  }
  merge(o: Recipe) {
    this.list.push(...o.list);
    return this;
  }
  count(kind: Kind) {
    let n = 0;
    for (const it of this.list) if (it.kind === kind) n++;
    return n;
  }
}

const tmpM = new THREE.Matrix4();
const tmpL = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * A pool of InstancedMeshes (one per part kind) split into fixed-size chunks.
 * Each key (usually a tile) owns one chunk, so updating a tile only rewrites
 * that chunk's instances. Freed chunks are reused lowest-first to keep counts tight.
 */
export class ChunkPool {
  readonly group = new THREE.Group();
  private meshes = new Map<Kind, THREE.InstancedMesh>();
  private free: number[] = [];
  private top = 0;
  private used = new Map<number, { chunk: number; insts: Inst[] }>();

  constructor(private sizes: Partial<Record<Kind, number>>, private maxChunks: number, opts: { shadows?: boolean } = {}) {
    for (const k of Object.keys(sizes) as Kind[]) {
      const n = sizes[k]!;
      if (!n) continue;
      const m = new THREE.InstancedMesh(KINDS[k].geo, kindMaterial(k), n * maxChunks);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = opts.shadows ?? true;
      m.receiveShadow = true;
      m.setColorAt(0, new THREE.Color('#fff'));
      this.meshes.set(k, m);
      this.group.add(m);
    }
  }

  has(key: number) {
    return this.used.has(key);
  }

  set(key: number, insts: Inst[], origin: THREE.Vector3, scale = 1) {
    let e = this.used.get(key);
    if (!e) {
      let chunk: number;
      if (this.free.length) {
        this.free.sort((a, b) => a - b);
        chunk = this.free.shift()!;
      } else {
        if (this.top >= this.maxChunks) return;
        chunk = this.top++;
      }
      e = { chunk, insts };
      this.used.set(key, e);
    }
    e.insts = insts;
    this.write(e.chunk, insts, origin, scale, true);
    this.refreshCounts();
  }

  setTransform(key: number, origin: THREE.Vector3, scale: number) {
    const e = this.used.get(key);
    if (e) this.write(e.chunk, e.insts, origin, scale, false);
  }

  remove(key: number) {
    const e = this.used.get(key);
    if (!e) return;
    this.used.delete(key);
    for (const [k, m] of this.meshes) {
      const n = this.sizes[k]!;
      for (let j = 0; j < n; j++) m.setMatrixAt(e.chunk * n + j, ZERO);
      m.instanceMatrix.addUpdateRange(e.chunk * n * 16, n * 16);
      m.instanceMatrix.needsUpdate = true;
    }
    this.free.push(e.chunk);
    while (this.top > 0 && this.free.includes(this.top - 1)) {
      this.free.splice(this.free.indexOf(this.top - 1), 1);
      this.top--;
    }
    this.refreshCounts();
  }

  private refreshCounts() {
    for (const [k, m] of this.meshes) m.count = this.top * this.sizes[k]!;
  }

  private write(chunk: number, insts: Inst[], origin: THREE.Vector3, scale: number, colors: boolean) {
    const base = new THREE.Matrix4().compose(origin, new THREE.Quaternion(), V(scale, scale, scale));
    const cursor = new Map<Kind, number>();
    for (const it of insts) {
      const m = this.meshes.get(it.kind);
      if (!m) continue;
      const n = this.sizes[it.kind]!;
      const j = cursor.get(it.kind) ?? 0;
      if (j >= n) continue;
      cursor.set(it.kind, j + 1);
      tmpL.compose(it.pos, it.quat, it.scale);
      tmpM.multiplyMatrices(base, tmpL);
      m.setMatrixAt(chunk * n + j, tmpM);
      if (colors) m.setColorAt(chunk * n + j, it.color);
    }
    for (const [k, m] of this.meshes) {
      const n = this.sizes[k]!;
      for (let j = cursor.get(k) ?? 0; j < n; j++) m.setMatrixAt(chunk * n + j, ZERO);
      m.instanceMatrix.addUpdateRange(chunk * n * 16, n * 16);
      m.instanceMatrix.needsUpdate = true;
      if (colors && m.instanceColor) {
        m.instanceColor.addUpdateRange(chunk * n * 3, n * 3);
        m.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const m of this.meshes.values()) {
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

/**
 * Static instances built once (the city). Groups remember their instance slots
 * so they can be recoloured later (buildings desaturate under smog).
 */
export class StaticBatch {
  readonly group = new THREE.Group();
  private meshes = new Map<Kind, THREE.InstancedMesh>();
  private slots = new Map<string, { kind: Kind; index: number; color: THREE.Color }[]>();

  constructor(groups: Map<string, Inst[]>) {
    const byKind = new Map<Kind, { inst: Inst; key: string }[]>();
    for (const [key, list] of groups) for (const inst of list) {
      if (!byKind.has(inst.kind)) byKind.set(inst.kind, []);
      byKind.get(inst.kind)!.push({ inst, key });
    }
    for (const [kind, list] of byKind) {
      const m = new THREE.InstancedMesh(KINDS[kind].geo, kindMaterial(kind), list.length);
      m.castShadow = kind !== 'puddle';
      m.receiveShadow = true;
      list.forEach(({ inst, key }, i) => {
        tmpM.compose(inst.pos, inst.quat, inst.scale);
        m.setMatrixAt(i, tmpM);
        m.setColorAt(i, inst.color);
        if (!this.slots.has(key)) this.slots.set(key, []);
        this.slots.get(key)!.push({ kind, index: i, color: inst.color.clone() });
      });
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.meshes.set(kind, m);
      this.group.add(m);
    }
  }

  /** Mix a group's colours towards `toward` by `amount` (0 restores the originals). */
  tint(key: string, toward: THREE.Color, amount: number) {
    const s = this.slots.get(key);
    if (!s) return;
    const c = new THREE.Color();
    for (const { kind, index, color } of s) {
      const m = this.meshes.get(kind)!;
      c.copy(color).lerp(toward, amount);
      m.setColorAt(index, c);
      m.instanceColor!.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of this.meshes.values()) {
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
