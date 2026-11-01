// Plant, building and prop recipes, ported from reference/overgrowth-3d.html.
// All recipes are local to a tile centre at ground level (y = 0 is the board top).
import * as THREE from 'three';
import { pick, qFrom, randDir, randQuat, Recipe, type Rng, UP, V } from './kit';

export const SLAB_TOP = 0.08;
export const GROUND = 0.1; // top of an owned tile's soil
export const GREENS = ['#4A8C3F', '#3F7F38', '#5FA34E', '#356B30', '#57984A'];
const LAVS = ['#A27DF0', '#B391F5', '#9068E0'];
export const CONCRETE = ['#6F7375', '#73777A', '#6A6E70', '#777B7D'];
const BARK = '#5A4636';

const leafGreen = (team: string, r: Rng) =>
  team === 'rose' ? pick(r, ['#356B30', '#2F5F2B', '#3F7F38'])
  : team === 'lav' ? pick(r, ['#6E8B5E', '#7A9A68', '#5F7D52'])
  : team === 'cherry' ? pick(r, ['#5C8A45', '#6B9650', '#4F7D3C'])
  : pick(r, GREENS);

/** One bloom on a surface point facing `dir`. Shared by bushes (scale 1) and trees (scale ~1.2). */
function bloom(rc: Recipe, team: string, pos: THREE.Vector3, dir: THREE.Vector3, r: Rng, s = 1) {
  switch (team) {
    case 'glory':
      rc.add('disc', pos, qFrom(dir), V(0.075 * s, 0.12 * s, 0.075 * s), pick(r, ['#4A86F2', '#5C93F4']));
      rc.add('ball', pos.clone().addScaledVector(dir, 0.02 * s), null, 0.022 * s, '#F6F1DC');
      break;
    case 'rose':
      rc.add('ball', pos, randQuat(r), 0.065 * s, pick(r, ['#EC4D63', '#E03A54']));
      rc.add('ball', pos.clone().addScaledVector(dir, 0.04 * s), randQuat(r), 0.028 * s, '#8E1A2E');
      break;
    case 'poppy': {
      const d = V(dir.x * 0.4, 1, dir.z * 0.4).normalize();
      rc.add('disc', pos, qFrom(d), V(0.08 * s, 0.15 * s, 0.08 * s), pick(r, ['#F07A2A', '#E8662A', '#F38A3A']));
      rc.add('ball', pos.clone().addScaledVector(d, 0.03 * s), null, 0.025 * s, '#2A1A12');
      break;
    }
    case 'daisy':
      rc.add('disc', pos, qFrom(dir), V(0.085 * s, 0.035 * s, 0.085 * s), pick(r, ['#F4F1E8', '#FFFFFF', '#ECE6D6']));
      rc.add('ball', pos.clone().addScaledVector(dir, 0.012 * s), null, V(0.032 * s, 0.018 * s, 0.032 * s), '#E8B830');
      break;
    case 'cherry':
      for (let k = 0; k < 3; k++) {
        const o = randDir(r).multiplyScalar(0.035 * s);
        rc.add('ball', pos.clone().add(o), randQuat(r), 0.032 * s, pick(r, ['#F5A7C7', '#F8C0D6', '#EE93B8']));
      }
      break;
    case 'bell': {
      // Drooping bells: open side down, hanging just below the surface point.
      const p = pos.clone().add(V(0, -0.035 * s, 0));
      rc.add('bell', p, null, V(0.035 * s, 0.07 * s, 0.035 * s), pick(r, ['#4B3FC9', '#5A4FD6', '#4034B0']));
      rc.add('stem', p.clone().add(V(0, 0.045 * s, 0)), null, V(0.006 * s, 0.03 * s, 0.006 * s), '#4E7A3E');
      break;
    }
  }
}

/** A bush of leaf clusters covered in the team's blooms. */
export function bush(team: string, r: Rng): Recipe {
  const rc = new Recipe();
  const leaves: { p: THREE.Vector3; rad: number }[] = [];
  const n = team === 'lav' ? 5 : team === 'sun' ? 7 : 9;
  for (let k = 0; k < n; k++) {
    const rad = team === 'lav' ? 0.1 + r() * 0.06 : 0.15 + r() * 0.11;
    const a = r() * Math.PI * 2, d = r() * 0.2;
    const p = V(Math.cos(a) * d, rad * 0.75 + r() * 0.12, Math.sin(a) * d);
    rc.add('leafLo', p, null, rad, leafGreen(team, r));
    leaves.push({ p, rad });
  }
  if (team === 'sun') {
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2, d = r() * 0.18;
      const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const h = 0.5 + r() * 0.3;
      rc.add('stem', V(bx, h / 2, bz), null, V(0.018, h, 0.018), '#4E8A3E');
      const dir = V(0.35 + r() * 0.2, 1, 0.35 + r() * 0.2).normalize();
      const top = V(bx, h, bz);
      rc.add('disc', top, qFrom(dir), V(0.14, 0.07, 0.14), '#F2C230');
      rc.add('disc', top.clone().addScaledVector(dir, 0.015), qFrom(dir), V(0.07, 0.09, 0.07), '#5A3A12');
      rc.add('leafLo', V(bx + 0.05, h * 0.5, bz), null, V(0.07, 0.03, 0.05), '#57984A');
    }
    return rc;
  }
  if (team === 'lav') {
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, d = r() * 0.22;
      const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = 0.28 + r() * 0.2;
      const tilt = qFrom(V((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3));
      const up = UP.clone().applyQuaternion(tilt);
      rc.add('stem', base.clone().addScaledVector(up, h / 2), tilt, V(0.009, h, 0.009), '#6E8B5E');
      rc.add('bud', base.clone().addScaledVector(up, h + 0.03), tilt, V(0.03, 0.1, 0.03), pick(r, LAVS));
    }
    return rc;
  }
  const count = { glory: 14, rose: 11, poppy: 8, daisy: 12, cherry: 9, bell: 10 }[team] ?? 10;
  const minY = team === 'bell' ? -0.4 : team === 'poppy' || team === 'daisy' ? 0.3 : 0.05;
  for (let k = 0; k < count; k++) {
    const L = pick(r, leaves), dir = randDir(r, minY, 1);
    bloom(rc, team, L.p.clone().addScaledVector(dir, L.rad * 0.96), dir, r);
  }
  return rc;
}

/** The mother plant: a ~2.5 unit tree with roots cracking the pavement and a blooming canopy. */
export function tree(team: string, r: Rng): Recipe {
  const rc = new Recipe();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r() * 0.4;
    rc.add('taper', V(Math.cos(a) * 0.27, 0.06, Math.sin(a) * 0.27), qFrom(V(-Math.cos(a), 0.12, -Math.sin(a))), V(0.07, 0.55, 0.07), BARK);
  }
  for (let k = 0; k < 3; k++) {
    const a = k * 2.2 + r() * 0.6;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.6 - 0.3, r() * 3, r() * 0.6 - 0.3));
    rc.add('box', V(Math.cos(a) * 0.4, 0.13, Math.sin(a) * 0.4), q, V(0.26, 0.05, 0.2), pick(r, CONCRETE));
  }
  rc.add('taper', V(0, GROUND + 0.5, 0), null, V(0.17, 1.0, 0.17), BARK);
  rc.add('taper', V(0.03, GROUND + 1.28, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.1)), V(0.1, 0.6, 0.1), BARK);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + r() * 0.5;
    const dir = V(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
    rc.add('taper', V(0, GROUND + 1.0, 0).addScaledVector(dir, 0.27), qFrom(dir), V(0.045, 0.55, 0.045), BARK);
  }
  const center = V(0, 1.62, 0);
  const leaves: { p: THREE.Vector3; rad: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const rad = 0.3 + r() * 0.2;
    const p = center.clone().add(V((r() - 0.5) * 0.95, (r() - 0.5) * 0.45, (r() - 0.5) * 0.95));
    rc.add('leaf', p, null, rad, team === 'lav' ? pick(r, ['#5F7D52', '#6E8B5E', '#4F6E46']) : leafGreen(team, r));
    leaves.push({ p, rad });
  }
  const count = ({ glory: 46, sun: 28, lav: 38, rose: 40, poppy: 34, daisy: 44, cherry: 40, bell: 40 } as Record<string, number>)[team] ?? 36;
  for (let k = 0; k < count; k++) {
    const L = pick(r, leaves);
    if (team === 'lav') {
      // Hanging clusters, like wisteria.
      const dir = randDir(r, -0.9, 0.25);
      const pos = L.p.clone().addScaledVector(dir, L.rad * 0.92).add(V(0, -0.07, 0));
      rc.add('bud', pos, qFrom(V(dir.x * 0.25, 1, dir.z * 0.25)), V(0.04, 0.13, 0.04), pick(r, LAVS));
      continue;
    }
    if (team === 'sun') {
      const dir = randDir(r, 0, 1);
      const pos = L.p.clone().addScaledVector(dir, L.rad * 0.96);
      rc.add('disc', pos, qFrom(dir), V(0.12, 0.06, 0.12), '#F2C230');
      rc.add('disc', pos.clone().addScaledVector(dir, 0.012), qFrom(dir), V(0.06, 0.08, 0.06), '#5A3A12');
      continue;
    }
    const minY = team === 'bell' ? -0.9 : team === 'poppy' || team === 'daisy' ? 0 : -0.3;
    const dir = randDir(r, minY, team === 'bell' ? 0.2 : 1);
    bloom(rc, team, L.p.clone().addScaledVector(dir, L.rad * 0.96), dir, r, 1.2);
  }
  return rc;
}

/** Small sprouts on neutral tiles next to someone's growth. */
export function sprouts(r: Rng): Recipe {
  const rc = new Recipe();
  for (let k = 0; k < 2; k++) {
    const sx = (r() - 0.5) * 0.5, sz = (r() - 0.5) * 0.5;
    rc.add('stem', V(sx, SLAB_TOP + 0.03, sz), null, V(0.008, 0.06, 0.008), '#4E8A3E');
    rc.add('ball', V(sx - 0.025, SLAB_TOP + 0.06, sz), randQuat(r), V(0.035, 0.012, 0.022), '#7CC468');
    rc.add('ball', V(sx + 0.025, SLAB_TOP + 0.07, sz), randQuat(r), V(0.035, 0.012, 0.022), '#6DB25A');
  }
  return rc;
}

/** Burst hydrant and puddle. */
export function hydrant(r: Rng): Recipe {
  const rc = new Recipe();
  rc.add('puddle', V(-0.05, GROUND + 0.004, 0.05), null, V(0.32, 1, 0.25), '#A9C3CE');
  const red = '#A8473B';
  const hx = 0.26, hz = -0.24;
  rc.add('cyl', V(hx, SLAB_TOP + 0.11, hz), null, V(0.065, 0.22, 0.065), red);
  rc.add('dome', V(hx, SLAB_TOP + 0.22, hz), null, 0.065, red);
  rc.add('cyl', V(hx - 0.07, SLAB_TOP + 0.14, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), V(0.025, 0.08, 0.025), red);
  const tilt = r() * 0.3;
  for (let t = 0; t < 9; t++) {
    const s = t / 8;
    rc.add('ball', V(hx - 0.11 - s * 0.26, SLAB_TOP + 0.14 + Math.sin(s * Math.PI) * 0.12, hz + s * (0.1 + tilt)), null, 0.022 - t * 0.0013, '#CFE3EA');
  }
  return rc;
}

/** The plaza fountain: a round basin with a spout. */
export function fountain(): Recipe {
  const rc = new Recipe();
  rc.add('cyl', V(0, SLAB_TOP + 0.06, 0), null, V(0.44, 0.12, 0.44), '#8A8C88');
  rc.add('puddle', V(0, SLAB_TOP + 0.125, 0), null, V(0.38, 1, 0.38), '#A9C3CE');
  rc.add('cyl', V(0, SLAB_TOP + 0.25, 0), null, V(0.05, 0.3, 0.05), '#8A8C88');
  rc.add('cyl', V(0, SLAB_TOP + 0.4, 0), null, V(0.16, 0.04, 0.16), '#8A8C88');
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    for (let t = 1; t < 5; t++) {
      const s = t / 5;
      rc.add('ball', V(Math.cos(a) * (0.12 + s * 0.2), SLAB_TOP + 0.42 - s * s * 0.28 + 0.04, Math.sin(a) * (0.12 + s * 0.2)), null, 0.018, '#CFE3EA');
    }
  }
  return rc;
}

// ---------- buildings (footprint w x d tiles, centred on the origin) ----------

export function apartment(w: number, d: number, r: Rng): Recipe {
  const rc = new Recipe();
  const fw = w - 0.14, fd = d - 0.14;
  const floors = 4 + Math.floor(r() * 3);
  const h = floors * 0.6 + 0.4, base = SLAB_TOP;
  rc.box(fw, h, fd, pick(r, ['#7D8184', '#787C7F', '#83878A']), 0, base + h / 2, 0);
  for (let f = 1; f < floors + 1; f++) rc.box(fw + 0.02, 0.04, fd + 0.02, '#6A6E71', 0, base + f * 0.6, 0);
  const top = base + h;
  rc.box(fw, 0.14, 0.06, '#6A6E71', 0, top + 0.07, fd / 2 - 0.03);
  rc.box(fw, 0.14, 0.06, '#6A6E71', 0, top + 0.07, -(fd / 2 - 0.03));
  rc.box(0.06, 0.14, fd, '#6A6E71', fw / 2 - 0.03, top + 0.07, 0);
  rc.box(0.06, 0.14, fd, '#6A6E71', -(fw / 2 - 0.03), top + 0.07, 0);
  const faces: [number, number, number][] = [[0, 1, fw], [0, -1, fw], [1, 0, fd], [-1, 0, fd]];
  for (const [nx, nz, span] of faces) {
    const cols = Math.max(1, Math.floor(span / 0.55));
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < floors; row++) {
        const u = (col - (cols - 1) / 2) * 0.55, y = base + 0.38 + row * 0.6;
        const pos = nx !== 0 ? V(nx * (fw / 2 + 0.005), y, u) : V(u, y, nz * (fd / 2 + 0.005));
        const sc = nx !== 0 ? V(0.03, 0.3, 0.32) : V(0.32, 0.3, 0.03);
        if (r() < 0.07) rc.add('lit', pos, null, sc, '#E8C46A');
        else rc.add('glass', pos, null, sc, r() < 0.15 ? '#0E1012' : '#262B2F');
      }
    }
  }
  rc.box(0.3, 0.16, 0.22, '#8A8F94', -fw / 4, top + 0.08, fd / 5);
  rc.box(0.22, 0.12, 0.3, '#8A8F94', -fw / 4 - 0.05, top + 0.06, -fd / 10);
  // Rooftop water tower.
  const wx = fw / 2 - 0.45, wz = -(fd / 2 - 0.45);
  for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) rc.box(0.03, 0.34, 0.03, '#3A3E42', wx + dx, top + 0.17, wz + dz);
  rc.add('cyl', V(wx, top + 0.55, wz), null, V(0.24, 0.42, 0.24), '#6B5544');
  rc.add('cone', V(wx, top + 0.86, wz), null, V(0.27, 0.2, 0.27), '#4E3F34');
  // Ivy climbing one side.
  for (let k = 0; k < 14; k++) {
    const y = 0.25 + r() * 1.4 * (1 - k / 22);
    const zz = (r() - 0.5) * fd * 0.8;
    rc.add('leaf', V(fw / 2 + 0.03, y, zz), null, 0.07 + r() * 0.06, pick(r, GREENS));
  }
  return rc;
}

export function warehouse(w: number, d: number, r: Rng): Recipe {
  // Built along X, then rotated if the footprint is deeper than wide.
  const long = Math.max(w, d), short = Math.min(w, d);
  const L = long - 0.12, S = short - 0.12;
  const rc = new Recipe();
  const base = SLAB_TOP;
  rc.box(L, 0.95, S, pick(r, ['#6E5446', '#735848', '#68503F']), 0, base + 0.475, 0);
  const teeth = Math.max(1, Math.round(L / 0.95));
  const tw = L / teeth;
  for (let k = 0; k < teeth; k++) {
    const x = -L / 2 + tw * (k + 0.5);
    rc.add('prism', V(x, base + 0.95, 0), null, V(tw, 0.38, S - 0.02), '#5E4A3E');
    rc.add('glass', V(x - tw / 2 + 0.01, base + 0.95 + 0.17, 0), null, V(0.02, 0.3, S - 0.12), '#2A3438');
  }
  rc.box(0.7, 0.6, 0.03, '#4A3B33', -L / 4, base + 0.3, S / 2 + 0.005);
  rc.box(0.5, 0.5, 0.03, '#4A3B33', L / 4, base + 0.25, S / 2 + 0.005);
  rc.box(0.06, 0.5, 0.02, '#5A3A2C', 0.1, base + 0.6, S / 2 + 0.01);
  return w >= d ? rc : rc.transform(Math.PI / 2, V(0, 0, 0));
}

export function ruin(w: number, d: number, r: Rng): Recipe {
  const long = Math.max(w, d), short = Math.min(w, d);
  const L = long - 0.14, S = short - 0.14;
  const rc = new Recipe();
  const base = SLAB_TOP, c = '#6F6B66';
  rc.box(L, 1.0, S, c, 0, base + 0.5, 0);
  rc.box(L * 0.3, 0.5, S, c, -L * 0.33, base + 1.25, 0);
  rc.box(L * 0.2, 0.85, S * 0.45, c, -L * 0.38, base + 1.42, -S * 0.2);
  rc.box(L * 0.32, 0.22, S, c, L * 0.13, base + 1.11, 0);
  for (let k = 0; k < 7; k++) {
    const q = qFrom(V((r() - 0.5) * 0.5, 1, (r() - 0.5) * 0.5));
    rc.add('stem', V((r() - 0.3) * L * 0.6, base + 1.18, (r() - 0.5) * S * 0.7), q, V(0.012, 0.4, 0.012), '#8A4A2A');
  }
  for (let k = 0; k < 3; k++) rc.box(0.24, 0.26, 0.03, '#1C1F21', -L * 0.3 + k * L * 0.3, base + 0.45, S / 2 + 0.005);
  for (let k = 0; k < 6; k++) {
    rc.add('box', V((r() - 0.5) * L * 0.8, 0.12, S / 2 - 0.05 - r() * 0.1), randQuat(r), V(0.08 + r() * 0.1, 0.05 + r() * 0.07, 0.08 + r() * 0.1), pick(r, CONCRETE));
  }
  return w >= d ? rc : rc.transform(Math.PI / 2, V(0, 0, 0));
}

export function shop(w: number, d: number, r: Rng): Recipe {
  const rc = new Recipe();
  const fw = w - 0.14, fd = d - 0.14;
  const base = SLAB_TOP;
  rc.box(fw, 1.0, fd, pick(r, ['#7A7570', '#807A72', '#75716B']), 0, base + 0.5, 0);
  rc.add('glass', V(0, base + 0.35, fd / 2 + 0.005), null, V(fw * 0.65, 0.45, 0.02), '#22282B');
  const aw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0));
  rc.box(fw * 0.8, 0.04, 0.34, pick(r, ['#5E7F7A', '#7F5E5E', '#6E6A4A']), 0, base + 0.78, fd / 2 + 0.13, aw);
  rc.box(0.05, 0.75, 0.05, '#3A3E42', -fw * 0.32, base + 1.37, -0.2);
  rc.box(0.05, 0.75, 0.05, '#3A3E42', fw * 0.32, base + 1.37, -0.2);
  rc.box(0.3, 0.14, 0.24, '#8A8F94', fw * 0.27, base + 1.07, fd * 0.2);
  return rc;
}

/** Where a shop's billboard goes (a textured panel added as a plain mesh). */
export function shopBillboard(w: number, d: number) {
  const fw = w - 0.14;
  return { width: fw * 0.86, height: 0.7 * Math.min(1, fw / 1.6 + 0.2), y: SLAB_TOP + 1.95, z: -0.22, depth: d };
}

export function car(r: Rng): Recipe {
  const rc = new Recipe();
  const body = pick(r, ['#7B5A4A', '#5A6B7B', '#6E7B5A', '#7B6E5A']);
  const roof = new THREE.Color(body).multiplyScalar(0.88).getStyle();
  rc.box(0.36, 0.15, 0.74, body, 0, 0.15, 0);
  rc.box(0.32, 0.13, 0.38, roof, 0, 0.29, -0.04);
  rc.add('glass', V(0, 0.29, -0.04), null, V(0.33, 0.07, 0.39), '#22282B');
  rc.box(0.37, 0.04, 0.2, '#5A3A2C', 0, 0.2, 0.2);
  const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  for (const [wx, wz] of [[0.19, 0.24], [-0.19, -0.24], [0.19, -0.24]]) rc.add('cyl', V(wx, 0.07, wz), wq, V(0.07, 0.05, 0.07), '#1E2022');
  // Weeds poking out.
  for (let k = 0; k < 4; k++) rc.add('leaf', V((r() - 0.5) * 0.5, 0.1, (r() - 0.5) * 0.8), null, 0.05 + r() * 0.04, pick(r, GREENS));
  return rc.transform(r() * Math.PI, V(0, SLAB_TOP - 0.02, 0));
}

export function billboardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 224;
  const x = c.getContext('2d')!;
  x.fillStyle = '#CDBE98';
  x.fillRect(0, 0, 512, 224);
  x.fillStyle = '#E2A23A';
  x.beginPath();
  x.arc(420, 112, 70, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#A8483A';
  x.font = '900 58px Impact, "Arial Black", sans-serif';
  x.textBaseline = 'middle';
  x.fillText('SUNNY DAYS', 28, 82);
  x.fillText('AHEAD', 28, 148);
  x.fillStyle = '#8F8A80';
  for (const rr of [[300, 20, 90, 60], [60, 170, 120, 40], [200, 120, 70, 50], [460, 150, 52, 74]]) x.fillRect(rr[0], rr[1], rr[2], rr[3]);
  const g = x.createLinearGradient(0, 0, 0, 224);
  g.addColorStop(0, 'rgba(60,55,45,0)');
  g.addColorStop(1, 'rgba(60,55,45,0.5)');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 224);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
