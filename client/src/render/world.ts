// The diorama for one board. Static city geometry is built once; plants, water
// ownership, sprouts and smog are pooled per tile and only rewritten for tiles
// whose visual signature changed.
import * as THREE from 'three';
import { isStreetCoord, neighbors4 } from '../../../shared/grid';
import { TEAMS, teamColor } from '../../../shared/teams';
import type { ClientGame } from '../game';
import { ChunkPool, type Inst, type Kind, KINDS, Recipe, rngFrom, StaticBatch, V, pick } from './kit';
import * as R from './recipes';
import { Critters } from './critters';
import type { Weather } from '../../../shared/protocol';

export interface Badge {
  pos: THREE.Vector3;
  text: string;
  ring: string;
  ghost?: boolean;
  small?: boolean;
}

const SOIL = new THREE.Color('#3B3026');
const HAZE = new THREE.Color('#615B50');
const SMOG_GREY = new THREE.Color('#6A6D6E');
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function tier(stems: number) {
  return stems <= 1 ? 0.7 : stems <= 4 ? 0.8 : stems <= 14 ? 0.9 : stems <= 49 ? 1.0 : 1.1;
}

function maxCounts(make: (team: string, seed: number) => Recipe, teams = TEAMS.map((t) => t.key)): Partial<Record<Kind, number>> {
  const out: Partial<Record<Kind, number>> = {};
  for (const t of teams) for (let s = 0; s < 6; s++) {
    const rc = make(t, s * 977 + 3);
    for (const k of Object.keys(KINDS) as Kind[]) out[k] = Math.max(out[k] ?? 0, rc.count(k));
  }
  return out;
}

const easeOutBack = (p: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

class Petals {
  readonly mesh: THREE.InstancedMesh;
  private parts: { p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Quaternion; t0: number; life: number }[] = [];
  private cap = 1500;
  constructor() {
    this.mesh = new THREE.InstancedMesh(KINDS.disc.geo, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.7, flatShading: true }), this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color('#fff'));
  }
  burst(at: THREE.Vector3, color: string | string[], now: number, count = 60, power = 1) {
    const palette = (Array.isArray(color) ? color : [color]).map((c) => new THREE.Color(c));
    for (let k = 0; k < count && this.parts.length < this.cap; k++) {
      const base = palette[k % palette.length];
      const a = Math.random() * Math.PI * 2, up = (1.2 + Math.random() * 1.6) * power, out = (0.6 + Math.random() * 1.2) * power;
      const idx = this.parts.length;
      this.parts.push({
        p: at.clone().add(V(0, 0.3, 0)), v: V(Math.cos(a) * out, up, Math.sin(a) * out),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0)),
        spin: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.1, 0.05)), t0: now, life: 900 + Math.random() * 500
      });
      this.mesh.setColorAt(idx, base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }
  frame(now: number, dt: number) {
    if (!this.parts.length) return;
    const m = new THREE.Matrix4();
    const keep: typeof this.parts = [];
    const colors: THREE.Color[] = [];
    const c = new THREE.Color();
    this.parts.forEach((pt, i) => {
      if (now - pt.t0 > pt.life) return;
      this.mesh.getColorAt(i, c);
      keep.push(pt);
      colors.push(c.clone());
    });
    this.parts = keep;
    this.parts.forEach((pt, i) => {
      pt.v.y -= 3.2 * dt;
      pt.v.multiplyScalar(1 - 1.2 * dt);
      pt.p.addScaledVector(pt.v, dt);
      if (pt.p.y < 0.12) { pt.p.y = 0.12; pt.v.set(0, 0, 0); }
      pt.q.multiply(pt.spin);
      const s = 0.045 * Math.min(1, (pt.life - (now - pt.t0)) / 300);
      m.compose(pt.p, pt.q, V(s, s * 0.4, s));
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, colors[i]);
    });
    this.mesh.count = this.parts.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function squareOutline(hex: string, emissive: number, opacity = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: emissive, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  for (const [dx, dz, w, d] of [[0, 0.47, 0.98, 0.035], [0, -0.47, 0.98, 0.035], [0.47, 0, 0.035, 0.98], [-0.47, 0, 0.035, 0.98]]) {
    const e = new THREE.Mesh(KINDS.box.geo, mat);
    e.scale.set(w, 0.03, d);
    e.position.set(dx, 0, dz);
    g.add(e);
  }
  g.visible = false;
  return g;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly W: number;
  readonly H: number;
  private city: StaticBatch;
  private ground: THREE.InstancedMesh;
  /** One pool per team, sized exactly for that team's bush, so no slots are wasted. */
  private bushPools = new Map<string, ChunkPool>();
  private bushTeam: (string | null)[];
  private trees: ChunkPool;
  private hydrants: ChunkPool;
  private sprouts: ChunkPool;
  private smog: THREE.InstancedMesh;
  private petals = new Petals();
  private sig: { bush: string[]; tree: string[]; ground: string[]; sprout: boolean[]; smog: string[]; vis: boolean[]; owner: (number | null)[]; kind: string[] };
  private buildingHidden: boolean[];
  private growing = new Map<number, { t0: number; scale: number; origin: THREE.Vector3 }>();
  readonly selection = squareOutline('#FFFFFF', 0.9);
  readonly hover = squareOutline('#FFFFFF', 0.3, 0.35);
  readonly billboards: THREE.Mesh[] = [];
  private billboardText = new Map<THREE.Mesh, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; n: number }>();
  critters!: Critters;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  discoUntil = 0;
  private cloud = new THREE.Group();
  private rain: THREE.InstancedMesh;
  private wet: THREE.Mesh;
  private shower: Weather['now'] = null;
  private cloudTarget = 0;
  private rainEdge = new THREE.Group();
  private lastFrame = 0;
  badges: Badge[] = [];

  constructor(readonly game: ClientGame) {
    this.W = game.width;
    this.H = game.height;
    const N = this.W * this.H;
    const sky = new THREE.Color('#59605D');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, this.W * 1.6, this.W * 3.4);

    // Lights.
    this.hemi = new THREE.HemisphereLight('#D3D9D4', '#3A342E', 1.15);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#FFF0DA', 1.7);
    this.sun = sun;
    sun.position.set(this.W * 0.35, this.W * 0.75, this.W * 0.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = this.W / 2 + 2;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: this.W * 3 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this.city = this.buildCity();
    this.scene.add(this.city.group);

    this.ground = new THREE.InstancedMesh(KINDS.box.geo, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9, flatShading: true }), N * 2);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    for (let i = 0; i < N * 2; i++) this.ground.setMatrixAt(i, ZERO);
    this.ground.setColorAt(0, SOIL);
    this.scene.add(this.ground);

    this.bushTeam = new Array(N).fill(null);
    this.trees = new ChunkPool(maxCounts((t, s) => R.tree(t, rngFrom(s))), 16);
    this.hydrants = new ChunkPool(R.hydrant(rngFrom(1)).list.reduce((acc, it) => ({ ...acc, [it.kind]: (acc[it.kind] ?? 0) + 1 }), {} as Partial<Record<Kind, number>>), N);
    this.sprouts = new ChunkPool({ stem: 2, ball: 4 }, N, { shadows: false });
    this.scene.add(this.trees.group, this.hydrants.group, this.sprouts.group, this.petals.mesh);

    this.smog = new THREE.InstancedMesh(KINDS.box.geo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false }), N);
    this.smog.frustumCulled = false;
    this.smog.renderOrder = 2;
    for (let i = 0; i < N; i++) this.smog.setMatrixAt(i, ZERO);
    this.smog.setColorAt(0, HAZE);
    this.scene.add(this.smog);

    // Weather: a cloud of grey puffs, rain streaks and a wet sheen on the ground.
    const puff = new THREE.MeshStandardMaterial({ color: '#B8BEC2', roughness: 1, flatShading: true, transparent: true, opacity: 0 });
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(KINDS.leaf.geo, puff);
      const a = (k / 14) * Math.PI * 2;
      m.position.set(Math.cos(a) * (0.6 + Math.random() * 0.5), Math.random() * 0.3, Math.sin(a) * (0.6 + Math.random() * 0.5));
      m.scale.setScalar(0.55 + Math.random() * 0.35);
      this.cloud.add(m);
    }
    this.cloud.visible = false;
    this.rain = new THREE.InstancedMesh(KINDS.box.geo, new THREE.MeshBasicMaterial({ color: '#CFE3EA', transparent: true, opacity: 0.55 }), 260);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.wet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7FA7C0', transparent: true, opacity: 0, roughness: 0.1, metalness: 0.3, depthWrite: false }));
    this.wet.visible = false;
    this.scene.add(this.cloud, this.rain, this.wet, this.rainEdge);

    this.critters = new Critters(this.W, this.H, (i, y) => this.tilePos(i, y), (x, z) => this.roofAt(x, z),
      (i) => game.tiles[i].owner === null && game.tiles[i].kind !== 'building' && game.tiles[i].kind !== 'water' && i !== game.fountain, game.buildings);
    this.scene.add(this.critters.group);

    this.selection.position.y = 0.13;
    this.hover.position.y = 0.125;
    this.scene.add(this.selection, this.hover);

    this.sig = {
      bush: new Array(N).fill(''), tree: new Array(N).fill(''), ground: new Array(N).fill(''), sprout: new Array(N).fill(false),
      smog: new Array(N).fill(''), vis: new Array(N).fill(false), owner: new Array(N).fill(null), kind: new Array(N).fill('')
    };
    this.buildingHidden = game.buildings.map(() => false);
    this.update(null, 0);
  }

  tilePos(i: number, y = 0) {
    return V((i % this.W) - (this.W - 1) / 2, y, Math.floor(i / this.W) - (this.H - 1) / 2);
  }

  tileAt(x: number, z: number): number {
    const tx = Math.round(x + (this.W - 1) / 2), tz = Math.round(z + (this.H - 1) / 2);
    if (tx < 0 || tz < 0 || tx >= this.W || tz >= this.H) return -1;
    return tz * this.W + tx;
  }

  private buildCity(): StaticBatch {
    const g = this.game;
    const groups = new Map<string, Inst[]>();
    const add = (key: string, rc: Recipe) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(...rc.list);
    };
    const r = rngFrom(g.width * 131 + g.fountain);
    const base = new Recipe();
    base.box(this.W + 0.6, 0.45, this.H + 0.6, '#2B2E31', 0, -0.225, 0);
    for (let i = 0; i < this.W * this.H; i++) {
      const x = i % this.W, y = Math.floor(i / this.W);
      const p = this.tilePos(i);
      const kind = g.tiles[i].kind;
      if (kind === 'building') {
        base.box(0.98, 0.08, 0.98, '#55595C', p.x, 0.04, p.z);
      } else if (isStreetCoord(x, y)) {
        base.box(0.98, 0.06, 0.98, '#3E4246', p.x, 0.03, p.z);
        const row = y % 5 === 2, col = x % 5 === 2;
        if (row && !col) {
          base.box(0.2, 0.004, 0.035, '#B9A56A', p.x - 0.25, 0.062, p.z);
          base.box(0.2, 0.004, 0.035, '#B9A56A', p.x + 0.25, 0.062, p.z);
        } else if (col && !row) {
          base.box(0.035, 0.004, 0.2, '#B9A56A', p.x, 0.062, p.z - 0.25);
          base.box(0.035, 0.004, 0.2, '#B9A56A', p.x, 0.062, p.z + 0.25);
        }
      } else {
        base.box(0.96, 0.08, 0.96, pick(r, R.CONCRETE), p.x, 0.04, p.z);
        // Seams and the occasional crack.
        base.box(0.96, 0.004, 0.012, '#5C6062', p.x, 0.081, p.z);
        if (r() < 0.6) {
          for (let k = 0; k < 2; k++) {
            const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * Math.PI);
            base.box(0.32, 0.004, 0.018, '#2A2C2E', p.x + (r() - 0.5) * 0.4, 0.082, p.z + (r() - 0.5) * 0.4, q);
          }
        }
      }
    }
    add('base', base);
    const side = new THREE.MeshStandardMaterial({ color: '#4A4844', roughness: 0.9, flatShading: true });
    g.buildings.forEach((b, k) => {
      const cx = b.x + (b.w - 1) / 2 - (this.W - 1) / 2;
      const cz = b.y + (b.h - 1) / 2 - (this.H - 1) / 2;
      const br = rngFrom(k * 7919 + b.x * 31 + b.y);
      let rc: Recipe;
      switch (b.style) {
        case 'apartment': rc = R.apartment(b.w, b.h, br); break;
        case 'warehouse': rc = R.warehouse(b.w, b.h, br); break;
        case 'ruin': rc = R.ruin(b.w, b.h, br); break;
        case 'shop': rc = R.shop(b.w, b.h, br); break;
        default: rc = R.car(br);
      }
      add(`b${k}`, rc.transform(0, V(cx, 0, cz)));
      if (b.style === 'shop') {
        const bb = R.shopBillboard(b.w, b.h);
        // Usually the classic ad; sometimes one of the rarer ones. Click to flip through them.
        const n = Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * (R.BILLBOARDS.length - 1));
        const canvas = document.createElement('canvas');
        const tex = R.billboardTexture(R.BILLBOARDS[n], canvas);
        const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
        const panel = new THREE.Mesh(KINDS.box.geo, [side, side, side, side, face, side]);
        this.billboardText.set(panel, { canvas, tex, n });
        panel.scale.set(bb.width, bb.height, 0.05);
        panel.position.set(cx, bb.y, cz + bb.z);
        panel.castShadow = true;
        this.billboards.push(panel);
        this.scene.add(panel);
      }
    });
    if (g.fountain >= 0) add('fountain', R.fountain().transform(0, this.tilePos(g.fountain)));
    return new StaticBatch(groups);
  }

  private bushPool(team: string): ChunkPool {
    let p = this.bushPools.get(team);
    if (!p) {
      p = new ChunkPool(maxCounts((t, s) => R.bush(t, rngFrom(s)), [team]), this.W * this.H);
      this.bushPools.set(team, p);
      this.scene.add(p.group);
    }
    return p;
  }

  /** Height of whatever static geometry is at (x, z): rooftops for props. */
  roofAt(x: number, z: number): number {
    const rc = new THREE.Raycaster(V(x, 30, z), V(0, -1, 0));
    const hit = rc.intersectObject(this.city.group, true)[0];
    return hit ? hit.point.y : R.SLAB_TOP;
  }

  /** Flip a billboard to its next message. */
  flipBillboard(panel: THREE.Object3D) {
    const b = this.billboardText.get(panel as THREE.Mesh);
    if (!b) return;
    b.n = (b.n + 1) % R.BILLBOARDS.length;
    R.billboardTexture(R.BILLBOARDS[b.n], b.canvas);
    b.tex.needsUpdate = true;
  }

  burst(i: number, colors: string | string[], count = 60, power = 1, y = 0) {
    this.petals.burst(this.tilePos(i, y), colors, performance.now(), count, power);
  }

  /** Petal confetti over the whole board (victory!). */
  confetti(colors: string[]) {
    const now = performance.now();
    for (let k = 0; k < 18; k++) {
      const i = Math.floor(Math.random() * this.W * this.H);
      this.petals.burst(this.tilePos(i, 1.5 + Math.random() * 2), colors, now + k * 40, 50, 0.8);
    }
  }

  setWeather(w: Weather) {
    const sh = w.now ?? w.next;
    this.shower = w.now;
    if (!sh) {
      this.cloudTarget = 0;
      this.rainEdge.visible = false;
      return;
    }
    const c = this.tilePos(sh.y * this.W + sh.x).add(V((sh.size - 1) / 2, 0, (sh.size - 1) / 2));
    this.cloud.position.set(c.x, 4.6, c.z);
    this.cloud.scale.setScalar(sh.size / 2.6);
    this.cloud.visible = true;
    this.cloudTarget = w.now ? 0.72 : 0.4;
    // Outline the exact tiles that will get rained on.
    if (this.rainEdge.userData.size !== sh.size) {
      this.rainEdge.clear();
      const m = new THREE.MeshStandardMaterial({ color: '#9FD3F0', emissive: '#9FD3F0', emissiveIntensity: 0.8, transparent: true, opacity: 0.8 });
      const h = sh.size / 2 - 0.02;
      for (const [dx, dz, w, d] of [[0, h, sh.size, 0.05], [0, -h, sh.size, 0.05], [h, 0, 0.05, sh.size], [-h, 0, 0.05, sh.size]]) {
        const e = new THREE.Mesh(KINDS.box.geo, m);
        e.scale.set(w, 0.03, d);
        e.position.set(dx, 0, dz);
        this.rainEdge.add(e);
      }
      this.rainEdge.userData.size = sh.size;
    }
    this.rainEdge.visible = true;
    this.rainEdge.position.set(c.x, 0.14, c.z);
    this.wet.position.set(c.x, 0.112, c.z);
    this.wet.scale.set(sh.size, 1, sh.size);
  }

  private weatherFrame(now: number, dt: number) {
    const puff = (this.cloud.children[0] as THREE.Mesh)?.material as THREE.MeshStandardMaterial;
    if (puff) {
      puff.opacity += (this.cloudTarget - puff.opacity) * Math.min(1, dt * 1.5);
      puff.color.set(this.shower ? '#8E959A' : '#B8BEC2');
      if (puff.opacity < 0.02 && !this.cloudTarget) this.cloud.visible = false;
      this.cloud.rotation.y += dt * 0.05;
      this.cloud.position.y = 4.6 + Math.sin(now * 0.0008) * 0.1;
    }
    const wetMat = this.wet.material as THREE.MeshStandardMaterial;
    wetMat.opacity += ((this.shower ? 0.28 : 0) - wetMat.opacity) * Math.min(1, dt);
    this.wet.visible = wetMat.opacity > 0.01;
    this.rain.visible = !!this.shower;
    if (!this.shower) return;
    const sh = this.shower;
    const m = new THREE.Matrix4();
    const c = this.cloud.position;
    const half = sh.size / 2;
    for (let k = 0; k < 260; k++) {
      // Each drop loops on its own phase, so no per-drop state is needed.
      const seed = k * 12.9898;
      const fx = (Math.sin(seed) * 43758.5453) % 1, fz = (Math.sin(seed * 1.7) * 24634.6345) % 1;
      const ph = ((now * 0.0011 + Math.abs((Math.sin(seed * 3.1) * 9301) % 1)) % 1);
      m.compose(V(c.x + fx * half, 4.3 - ph * 4.2, c.z + fz * half), new THREE.Quaternion(), V(0.012, 0.22, 0.012));
      this.rain.setMatrixAt(k, m);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  private setGround(i: number, team: string | null, soil: boolean) {
    const p = this.tilePos(i);
    const m = new THREE.Matrix4();
    if (team) {
      m.compose(V(p.x, 0.045, p.z), new THREE.Quaternion(), V(0.98, 0.09, 0.98));
      this.ground.setMatrixAt(i * 2, m);
      this.ground.setColorAt(i * 2, new THREE.Color(teamColor(team)));
    } else this.ground.setMatrixAt(i * 2, ZERO);
    if (team && soil) {
      m.compose(V(p.x, 0.05, p.z), new THREE.Quaternion(), V(0.86, 0.1, 0.86));
      this.ground.setMatrixAt(i * 2 + 1, m);
      this.ground.setColorAt(i * 2 + 1, SOIL);
    } else this.ground.setMatrixAt(i * 2 + 1, ZERO);
    this.ground.instanceMatrix.addUpdateRange(i * 32, 32);
    this.ground.instanceMatrix.needsUpdate = true;
    this.ground.instanceColor!.addUpdateRange(i * 6, 6);
    this.ground.instanceColor!.needsUpdate = true;
  }

  private bushOrigin(i: number, water: boolean) {
    const p = this.tilePos(i, R.GROUND);
    if (water) p.add(i === this.game.fountain ? V(-0.38, 0, -0.38) : V(-0.3, 0, -0.3));
    return p;
  }

  /** Re-derive visuals for changed tiles (and their neighbours). `null` = everything. */
  update(changed: number[] | null, now: number) {
    const g = this.game;
    const N = this.W * this.H;
    const dirty = new Set<number>();
    if (!changed) for (let i = 0; i < N; i++) dirty.add(i);
    else for (const i of changed) {
      dirty.add(i);
      for (const n of neighbors4(i, this.W, this.H)) dirty.add(n);
    }
    const ownedVisible = (i: number) => g.tiles[i].visible && g.tiles[i].owner !== null;
    let smogDirty = false;
    const buildingsToCheck = new Set<number>();
    for (const i of dirty) {
      const t = g.tiles[i];
      const team = t.visible && t.owner !== null ? g.teamOf(t.owner) ?? 'glory' : null;
      const water = t.kind === 'water';
      const prevOwner = this.sig.owner[i];
      const wasVisible = this.sig.vis[i];

      // Ground rim + soil.
      const groundSig = team ? `${team}|${water ? 'w' : 's'}` : '';
      if (groundSig !== this.sig.ground[i]) {
        this.setGround(i, team, !water);
        this.sig.ground[i] = groundSig;
      }

      // Mother tree.
      const treeSig = team && t.isMother ? team : '';
      if (treeSig !== this.sig.tree[i]) {
        if (treeSig) this.trees.set(i, R.tree(team!, rngFrom(i * 31 + 7)).list, this.tilePos(i));
        else this.trees.remove(i);
        this.sig.tree[i] = treeSig;
      }

      // Bush (or a small one beside owned water).
      const sc = team && !t.isMother ? (water ? 0.5 : tier(t.stems)) : 0;
      const bushSig = sc ? `${team}|${sc}` : '';
      if (bushSig !== this.sig.bush[i]) {
        const prevTeam = this.bushTeam[i];
        if (prevTeam && prevTeam !== team) {
          this.bushPool(prevTeam).remove(i);
          this.bushTeam[i] = null;
        }
        if (bushSig) {
          const origin = this.bushOrigin(i, water);
          const pool = this.bushPool(team!);
          if (this.bushTeam[i] !== team) pool.set(i, R.bush(team!, rngFrom(i * 17 + TEAMS.findIndex((x) => x.key === team))).list, origin, sc);
          else pool.setTransform(i, origin, sc);
          this.bushTeam[i] = team;
          // Captured in view: grow in with a little overshoot.
          const captured = changed && wasVisible && prevOwner !== t.owner;
          if (captured) {
            this.growing.set(i, { t0: now, scale: sc, origin });
            pool.setTransform(i, origin, 0.001);
          } else if (this.growing.has(i)) this.growing.get(i)!.scale = sc;
        } else {
          if (this.bushTeam[i]) this.bushPool(this.bushTeam[i]!).remove(i);
          this.bushTeam[i] = null;
          this.growing.delete(i);
        }
        this.sig.bush[i] = bushSig;
      }

      if (changed && t.visible && t.owner !== null && prevOwner !== t.owner) this.critters.scare(i, now);

      // Petal burst when water or a mother plant changes hands in view.
      if (changed && wasVisible && t.visible && t.owner !== null && prevOwner !== t.owner && (water || this.sig.kind[i] === 'mother')) {
        this.petals.burst(this.tilePos(i), teamColor(team ?? undefined), now);
      }

      // Hydrant/puddle on water tiles (terrain, always visible). The fountain is static.
      if (water && i !== g.fountain && !this.hydrants.has(i)) this.hydrants.set(i, R.hydrant(rngFrom(i)).list, this.tilePos(i));

      // Sprouts on neutral tiles touching visible growth.
      const sprout = t.visible && t.owner === null && (t.kind === 'plain' || t.kind === 'street') && neighbors4(i, this.W, this.H).some(ownedVisible);
      if (sprout !== this.sig.sprout[i]) {
        if (sprout) this.sprouts.set(i, R.sprouts(rngFrom(i * 13)).list, this.tilePos(i));
        else this.sprouts.remove(i);
        this.sig.sprout[i] = sprout;
      }

      // Smog.
      const hidden = !t.visible && t.kind !== 'building';
      const seen = g.lastSeen[i];
      const smogSig = hidden ? `h${seen ?? ''}` : '';
      if (smogSig !== this.sig.smog[i]) {
        const p = this.tilePos(i);
        if (hidden) {
          this.smog.setMatrixAt(i, new THREE.Matrix4().compose(V(p.x, 0.19, p.z), new THREE.Quaternion(), V(1.0, 0.38, 1.0)));
          const c = HAZE.clone();
          if (seen !== null) c.lerp(new THREE.Color(teamColor(g.teamOf(seen))), 0.28);
          this.smog.setColorAt(i, c);
        } else this.smog.setMatrixAt(i, ZERO);
        this.sig.smog[i] = smogSig;
        smogDirty = true;
      }
      if (t.kind === 'building' && wasVisible !== t.visible) {
        g.buildings.forEach((b, k) => {
          const x = i % this.W, y = Math.floor(i / this.W);
          if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) buildingsToCheck.add(k);
        });
      }

      this.sig.owner[i] = t.visible ? t.owner : null;
      this.sig.vis[i] = t.visible;
      this.sig.kind[i] = t.isMother ? 'mother' : t.kind;
    }
    if (smogDirty) {
      this.smog.instanceMatrix.needsUpdate = true;
      this.smog.instanceColor!.needsUpdate = true;
    }
    // Buildings outside vision stay visible but desaturated.
    const all = !changed;
    g.buildings.forEach((b, k) => {
      if (!all && !buildingsToCheck.has(k)) return;
      let seen = false;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (g.tiles[y * this.W + x].visible) seen = true;
      const hidden = !seen;
      if (hidden !== this.buildingHidden[k] || all) {
        this.city.tint(`b${k}`, SMOG_GREY, hidden ? 0.55 : 0);
        this.buildingHidden[k] = hidden;
      }
    });
    this.refreshBadges();
  }

  refreshBadges() {
    const g = this.game;
    const out: Badge[] = [];
    for (let i = 0; i < g.tiles.length; i++) {
      const t = g.tiles[i];
      if (!t.visible || (t.owner === null && t.stems === 0) || t.kind === 'building') continue;
      let y = 0.62;
      if (t.isMother) y = 2.45;
      else if (t.owner !== null && t.kind !== 'water') y = R.GROUND + (g.teamOf(t.owner) === 'sun' ? 0.95 : 0.62) * tier(t.stems) + 0.1;
      else if (t.kind !== 'water') y = 0.4;
      out.push({ pos: this.tilePos(i, y), text: String(t.stems), ring: t.owner !== null ? teamColor(g.teamOf(t.owner)) : 'rgba(255,255,255,0.55)' });
    }
    this.badges = out;
  }

  frame(now: number) {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    for (const [i, gr] of this.growing) {
      const p = Math.min(1, (now - gr.t0) / 250);
      const team = this.bushTeam[i];
      if (team) this.bushPool(team).setTransform(i, gr.origin, Math.max(0.001, gr.scale * easeOutBack(p)));
      if (p >= 1) this.growing.delete(i);
    }
    this.petals.frame(now, dt);
    this.critters.frame(now, dt);
    this.weatherFrame(now, dt);
    // Disco garden (an easter egg): the lights dance.
    if (now < this.discoUntil) {
      const h = (now * 0.0004) % 1;
      this.hemi.color.setHSL(h, 0.7, 0.65);
      this.sun.color.setHSL((h + 0.5) % 1, 0.8, 0.6);
      this.sun.intensity = 1.7 + Math.sin(now * 0.012) * 0.6;
    } else if (this.discoUntil) {
      this.discoUntil = 0;
      this.hemi.color.set('#D3D9D4');
      this.sun.color.set('#FFF0DA');
      this.sun.intensity = 1.7;
    }
  }

  dispose() {
    this.city.dispose();
    for (const p of this.bushPools.values()) p.dispose();
    this.trees.dispose();
    this.hydrants.dispose();
    this.sprouts.dispose();
    this.ground.dispose();
    this.smog.dispose();
    this.petals.mesh.dispose();
    for (const { tex } of this.billboardText.values()) tex.dispose();
    this.rain.dispose();
  }
}
