// Ambient life and easter-egg props. All cosmetic and client-side: placement uses
// the browser's randomness and never depends on hidden game state.
import * as THREE from 'three';
import { isStreetCoord } from '../../../shared/grid';
import { KINDS, V } from './kit';

const box = KINDS.box.geo;
const ball = KINDS.ball.geo;
const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(hex: string, emissive = 0) {
  const k = hex + emissive;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, flatShading: true, emissive: emissive ? hex : '#000', emissiveIntensity: emissive }));
  return mats.get(k)!;
}
function part(g: THREE.Object3D, geo: THREE.BufferGeometry, hex: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, emissive = 0) {
  const m = new THREE.Mesh(geo, mat(hex, emissive));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  g.add(m);
  return m;
}

export type Season = 'halloween' | 'winter' | null;
export function season(d = new Date()): Season {
  const m = d.getMonth(), day = d.getDate();
  if ((m === 9 && day >= 15) || (m === 10 && day <= 5)) return 'halloween';
  if (m === 11) return 'winter';
  return null;
}

interface Pigeon {
  g: THREE.Group;
  head: THREE.Mesh;
  tile: number;
  state: 'idle' | 'flying' | 'gone';
  t0: number;
  vel: THREE.Vector3;
  next: number;
}

export class Critters {
  readonly group = new THREE.Group();
  readonly cat: THREE.Group | null = null;
  private catTail: THREE.Mesh | null = null;
  private catPetUntil = 0;
  readonly pigeons: Pigeon[] = [];
  readonly pumpkins: THREE.Group[] = [];
  private bees: THREE.Group[] = [];
  private beeHome: THREE.Vector3 | null = null;
  private lights: THREE.Mesh[] = [];

  constructor(
    private W: number,
    private H: number,
    private tilePos: (i: number, y?: number) => THREE.Vector3,
    private roofAt: (x: number, z: number) => number,
    private tileOpen: (i: number) => boolean,
    buildings: { x: number; y: number; w: number; h: number; style: string }[]
  ) {
    const center = (b: (typeof buildings)[0]) => V(b.x + (b.w - 1) / 2 - (W - 1) / 2, 0, b.y + (b.h - 1) / 2 - (H - 1) / 2);
    const tall = buildings.filter((b) => b.style === 'apartment' || b.style === 'shop' || b.style === 'warehouse');
    // A cat lives on one rooftop. Click it.
    if (tall.length) {
      const b = tall[Math.floor(Math.random() * tall.length)];
      const c = center(b);
      const p = V(c.x + 0.25, 0, c.z + 0.2);
      p.y = this.roofAt(p.x, p.z);
      const cat = new THREE.Group();
      const fur = Math.random() < 0.5 ? '#E08A3C' : Math.random() < 0.5 ? '#2B2B2E' : '#D8D2C4';
      part(cat, box, fur, 0, 0.06, 0, 0.2, 0.1, 0.1);
      part(cat, box, fur, 0.12, 0.13, 0, 0.09, 0.09, 0.09);
      part(cat, box, fur, 0.14, 0.2, 0.03, 0.025, 0.04, 0.025);
      part(cat, box, fur, 0.14, 0.2, -0.03, 0.025, 0.04, 0.025);
      part(cat, box, '#7FC468', 0.17, 0.14, 0.022, 0.01, 0.015, 0.015, 0.8);
      part(cat, box, '#7FC468', 0.17, 0.14, -0.022, 0.01, 0.015, 0.015, 0.8);
      this.catTail = part(cat, box, fur, -0.13, 0.12, 0, 0.025, 0.16, 0.025);
      this.catTail.rotation.z = 0.5;
      cat.position.copy(p);
      cat.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(cat);
      this.cat = cat;
    }
    // Pigeons peck along the streets and scatter when growth arrives.
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group();
      part(g, box, '#8D9298', 0, 0.06, 0, 0.11, 0.06, 0.06);
      const head = part(g, box, '#6F767E', 0.06, 0.1, 0, 0.04, 0.04, 0.04);
      part(head, box, '#D9A441', 0.7, 0, 0, 0.6, 0.25, 0.3);
      part(g, box, '#5C6E6A', 0.03, 0.08, 0, 0.03, 0.03, 0.065);
      this.group.add(g);
      const pg: Pigeon = { g, head, tile: -1, state: 'gone', t0: 0, vel: V(0, 0, 0), next: performance.now() + Math.random() * 5000 };
      this.pigeons.push(pg);
      this.land(pg);
    }
    // Seasonal decorations on rooftops.
    const s = season();
    const roofs = [...tall].sort(() => Math.random() - 0.5).slice(0, 7);
    for (const b of roofs) {
      const c = center(b);
      if (s === 'halloween') {
        const p = V(c.x - 0.3 + Math.random() * 0.2, 0, c.z + 0.3);
        p.y = this.roofAt(p.x, p.z);
        const g = new THREE.Group();
        part(g, ball, '#E8742A', 0, 0.09, 0, 0.13, 0.09, 0.13);
        part(g, box, '#4E7A3E', 0, 0.2, 0, 0.02, 0.06, 0.02);
        part(g, box, '#FFC24A', 0.12, 0.1, 0.03, 0.02, 0.025, 0.025, 1.6);
        part(g, box, '#FFC24A', 0.12, 0.1, -0.03, 0.02, 0.025, 0.025, 1.6);
        part(g, box, '#FFC24A', 0.125, 0.06, 0, 0.02, 0.015, 0.06, 1.6);
        g.position.copy(p);
        g.rotation.y = Math.random() * 6;
        this.group.add(g);
        this.pumpkins.push(g);
      } else if (s === 'winter') {
        const colors = ['#FF5A5A', '#FFD34A', '#5AD1FF', '#7FE07F'];
        for (let k = 0; k < 9; k++) {
          const p = V(c.x - b.w / 2 + 0.1 + (k / 8) * (b.w - 0.2), 0, c.z + b.h / 2 - 0.08);
          p.y = this.roofAt(p.x, c.z) + 0.02;
          const l = part(this.group, ball, colors[k % 4], p.x, p.y, p.z, 0.03, 0.03, 0.03, 1.5);
          this.lights.push(l);
        }
      }
    }
  }

  /** Objects that react to clicks. */
  clickables(): THREE.Object3D[] {
    return [...(this.cat ? [this.cat] : []), ...this.pigeons.filter((p) => p.state === 'idle').map((p) => p.g), ...this.pumpkins];
  }

  pet(now: number) {
    this.catPetUntil = now + 1500;
  }

  private land(p: Pigeon) {
    const streets: number[] = [];
    for (let i = 0; i < this.W * this.H; i++) {
      if (isStreetCoord(i % this.W, Math.floor(i / this.W)) && this.tileOpen(i)) streets.push(i);
    }
    if (!streets.length) return;
    p.tile = streets[Math.floor(Math.random() * streets.length)];
    const pos = this.tilePos(p.tile, 0.06);
    p.g.position.set(pos.x + (Math.random() - 0.5) * 0.5, 0.06, pos.z + (Math.random() - 0.5) * 0.5);
    p.g.rotation.y = Math.random() * Math.PI * 2;
    p.g.visible = true;
    p.state = 'idle';
  }

  /** Scatter pigeons near a tile (growth arrived, or someone clicked). Returns how many flew. */
  scare(tile: number, now: number, radius = 1): number {
    let n = 0;
    const tx = tile % this.W, ty = Math.floor(tile / this.W);
    for (const p of this.pigeons) {
      if (p.state !== 'idle') continue;
      const px = p.tile % this.W, py = Math.floor(p.tile / this.W);
      if (Math.max(Math.abs(px - tx), Math.abs(py - ty)) > radius) continue;
      this.fly(p, now);
      n++;
    }
    return n;
  }

  fly(p: Pigeon, now: number) {
    const a = Math.random() * Math.PI * 2;
    p.state = 'flying';
    p.t0 = now;
    p.vel.set(Math.cos(a) * 2.2, 2.4, Math.sin(a) * 2.2);
    p.g.rotation.y = -a;
  }

  pigeonOf(o: THREE.Object3D) {
    return this.pigeons.find((p) => p.g === o) ?? null;
  }

  setBees(home: THREE.Vector3 | null) {
    this.beeHome = home;
    if (home && !this.bees.length) {
      for (let k = 0; k < 5; k++) {
        const g = new THREE.Group();
        part(g, ball, '#F2C230', 0, 0, 0, 0.045, 0.035, 0.035);
        part(g, box, '#1E1E1E', 0, 0, 0, 0.02, 0.04, 0.04);
        part(g, box, '#E8F4FF', 0, 0.03, 0.02, 0.03, 0.005, 0.03);
        part(g, box, '#E8F4FF', 0, 0.03, -0.02, 0.03, 0.005, 0.03);
        this.group.add(g);
        this.bees.push(g);
      }
    }
    for (const b of this.bees) b.visible = !!home;
  }

  get hasBees() {
    return !!this.beeHome;
  }

  frame(now: number, dt: number) {
    if (this.cat && this.catTail) {
      const petting = now < this.catPetUntil;
      this.catTail.rotation.z = 0.5 + Math.sin(now * (petting ? 0.025 : 0.004)) * (petting ? 0.6 : 0.25);
      this.cat.scale.setScalar(petting ? 1 + Math.sin(now * 0.02) * 0.04 : 1);
    }
    for (const p of this.pigeons) {
      if (p.state === 'idle') {
        p.head.position.y = 0.1 - Math.max(0, Math.sin(now * 0.006 + p.tile)) * 0.03;
        if (now > p.next) {
          p.next = now + 2000 + Math.random() * 5000;
          p.g.rotation.y += (Math.random() - 0.5) * 2;
        }
      } else if (p.state === 'flying') {
        p.g.position.addScaledVector(p.vel, dt);
        p.vel.y += 0.6 * dt;
        p.g.rotation.z = Math.sin(now * 0.05) * 0.3;
        if (now - p.t0 > 3000) {
          p.state = 'gone';
          p.g.visible = false;
          p.next = now + 15000 + Math.random() * 20000;
        }
      } else if (now > p.next) this.land(p);
    }
    if (this.pumpkins.length) mat('#FFC24A', 1.6).emissiveIntensity = 1.3 + 0.5 * Math.abs(Math.sin(now * 0.013) * Math.sin(now * 0.0071));
    this.lights.forEach((l, k) => l.scale.setScalar(0.03 * (0.8 + 0.4 * Math.max(0, Math.sin(now * 0.004 + k)))));
    if (this.beeHome) {
      this.bees.forEach((b, k) => {
        const t = now * 0.0018 + k * 1.3;
        b.position.set(this.beeHome!.x + Math.cos(t) * (0.55 + 0.1 * Math.sin(t * 3)), this.beeHome!.y + Math.sin(t * 2.3) * 0.25, this.beeHome!.z + Math.sin(t) * (0.55 + 0.1 * Math.cos(t * 2)));
        b.rotation.y = -t;
      });
    }
  }
}
