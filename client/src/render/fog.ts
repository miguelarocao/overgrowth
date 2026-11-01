// Fog of war: a solid bank of smog over every tile you can't see. Boxes give it
// body, puffs on top give it a cloudy surface that spills a little over its edges.
// Only tall buildings rise above it. It rolls back when you gain vision and rolls
// in again when you lose it.
import * as THREE from 'three';
import { KINDS, rngFrom, V } from './kit';

export const FOG_H = 1.5;
const PUFFS = 4;
const BASE = new THREE.Color('#8A8B86');
const TOP = new THREE.Color('#A9AAA4');
const PUFF_GEO = new THREE.SphereGeometry(1, 8, 4);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Fog {
  readonly group = new THREE.Group();
  private box: THREE.InstancedMesh;
  private puff: THREE.InstancedMesh;
  private level: Float32Array;
  private target: Float32Array;
  private moving = new Set<number>();
  private offsets: { x: number; y: number; z: number; r: number }[][];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(n: number, private tilePos: (i: number, y?: number) => THREE.Vector3) {
    // Smooth shading on the puffs reads as cloud; flat shading made them look like rocks.
    this.box = new THREE.InstancedMesh(KINDS.box.geo, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 1 }), n);
    this.puff = new THREE.InstancedMesh(PUFF_GEO, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 1 }), n * PUFFS);
    for (const im of [this.box, this.puff]) {
      im.frustumCulled = false;
      im.receiveShadow = true;
      im.castShadow = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, ZERO);
      im.setColorAt(0, BASE);
      this.group.add(im);
    }
    this.level = new Float32Array(n);
    this.target = new Float32Array(n);
    this.offsets = Array.from({ length: n }, (_, i) => {
      const r = rngFrom(i * 7 + 3);
      // One puff per quadrant: neighbours' puffs meet and merge into one blanket,
      // while spilling only ~0.2 tiles past the edge (your vision ring stays clear).
      return Array.from({ length: PUFFS }, (_, k) => ({ x: (k % 2 ? 0.22 : -0.22) + (r() - 0.5) * 0.08, y: (r() - 0.5) * 0.08, z: (k < 2 ? 0.22 : -0.22) + (r() - 0.5) * 0.08, r: 0.36 + r() * 0.1 }));
    });
  }

  /** Cover (or uncover) a tile. `tint` colours it towards whoever owned it when last seen. */
  set(i: number, hidden: boolean, tint: THREE.Color | null, instant: boolean) {
    this.target[i] = hidden ? 1 : 0;
    const c = BASE.clone(), top = TOP.clone();
    if (tint) {
      c.lerp(tint, 0.22);
      top.lerp(tint, 0.18);
    }
    this.box.setColorAt(i, c);
    for (let k = 0; k < PUFFS; k++) this.puff.setColorAt(i * PUFFS + k, top.clone().offsetHSL(0, 0, (k - 1) * 0.02));
    this.box.instanceColor!.needsUpdate = true;
    this.puff.instanceColor!.needsUpdate = true;
    if (instant) {
      this.level[i] = this.target[i];
      this.write(i);
    } else this.moving.add(i);
  }

  private write(i: number) {
    const lv = this.level[i];
    const p = this.tilePos(i);
    if (lv <= 0.001) {
      this.box.setMatrixAt(i, ZERO);
      for (let k = 0; k < PUFFS; k++) this.puff.setMatrixAt(i * PUFFS + k, ZERO);
    } else {
      const h = FOG_H * lv;
      this.m.compose(V(p.x, h / 2, p.z), this.q, V(1.01, h, 1.01));
      this.box.setMatrixAt(i, this.m);
      this.offsets[i].forEach((o, k) => {
        const r = o.r * (0.4 + 0.6 * lv);
        this.m.compose(V(p.x + o.x, h - 0.06 + o.y, p.z + o.z), this.q, V(r, r * 0.5, r));
        this.puff.setMatrixAt(i * PUFFS + k, this.m);
      });
    }
    this.box.instanceMatrix.needsUpdate = true;
    this.puff.instanceMatrix.needsUpdate = true;
    this.group.visible = this.level.some((v) => v > 0);
  }

  frame(dt: number) {
    if (!this.moving.size) return;
    const step = dt / 0.4;
    for (const i of this.moving) {
      const d = this.target[i] - this.level[i];
      if (Math.abs(d) <= step) {
        this.level[i] = this.target[i];
        this.moving.delete(i);
      } else this.level[i] += Math.sign(d) * step;
      this.write(i);
    }
  }

  dispose() {
    this.box.dispose();
    this.puff.dispose();
  }
}
