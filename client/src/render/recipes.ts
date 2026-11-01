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

/** Leaf clumps in a mound. Returns their centres so blooms can sit on them. */
function mound(rc: Recipe, r: Rng, n: number, rad: [number, number], spread: number, colors: string[], squash = 1, lift = 0) {
  const out: { p: THREE.Vector3; rad: number }[] = [];
  for (let k = 0; k < n; k++) {
    const rr = rad[0] + r() * (rad[1] - rad[0]);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    const p = V(Math.cos(a) * d, lift + rr * 0.7 * squash + r() * 0.06, Math.sin(a) * d);
    rc.add('leafLo', p, randQuat(r), V(rr, rr * squash, rr), pick(r, colors));
    out.push({ p, rad: rr });
  }
  return out;
}

/** A stem from a to b (a thin cylinder). */
function stemBetween(rc: Recipe, a: THREE.Vector3, b: THREE.Vector3, thick: number, hex: string) {
  const d = b.clone().sub(a);
  rc.add('stem', a.clone().addScaledVector(d, 0.5), qFrom(d), V(thick, d.length(), thick), hex);
}

/**
 * Each team's growth has its own silhouette, not just its own colour, so teams stay
 * distinct at a glance (and for colourblind players):
 * morning glory = vine arch, sunflower = tall stalks, lavender = spiky tuft,
 * rose = dense round shrub, poppy = cups on thin stems, daisy = flat white carpet,
 * cherry = tiny tree, bluebell = weeping fountain of bells.
 */
export function bush(team: string, r: Rng): Recipe {
  const rc = new Recipe();
  switch (team) {
    case 'glory': {
      mound(rc, r, 5, [0.11, 0.17], 0.18, GREENS, 0.8);
      // A vine arch across the tile, covered in big blue trumpets.
      const tilt = r() * Math.PI;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, a = Math.PI * t;
        pts.push(V(Math.cos(a) * 0.32, Math.sin(a) * 0.5 + 0.02, 0).applyAxisAngle(UP, tilt));
      }
      for (let k = 0; k < 8; k++) {
        stemBetween(rc, pts[k], pts[k + 1], 0.014, '#3F7F38');
        rc.add('leafLo', pts[k].clone().add(V(0, 0.02, 0)), randQuat(r), V(0.07, 0.03, 0.06), pick(r, GREENS));
        const dir = pts[k].clone().setY(0).normalize().add(V(0, 0.8, 0)).normalize();
        bloom(rc, 'glory', pts[k].clone().add(V(0, 0.04, 0)), dir, r, 1.45);
      }
      for (let k = 0; k < 5; k++) bloom(rc, 'glory', V((r() - 0.5) * 0.4, 0.22 + r() * 0.06, (r() - 0.5) * 0.4), randDir(r, 0.4, 1), r, 1.3);
      return rc;
    }
    case 'sun': {
      mound(rc, r, 3, [0.08, 0.12], 0.14, GREENS);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r() * 0.8, d = 0.08 + r() * 0.16;
        const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
        const h = 0.7 + r() * 0.35;
        rc.add('stem', V(bx, h / 2, bz), null, V(0.022, h, 0.022), '#4E8A3E');
        for (const s of [0.35, 0.6]) rc.add('leafLo', V(bx + 0.06, h * s, bz), qFrom(V(1, 0.4, 0)), V(0.09, 0.025, 0.06), '#57984A');
        const dir = V(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize();
        const top = V(bx, h, bz);
        rc.add('disc', top, qFrom(dir), V(0.19, 0.08, 0.19), '#F2C230');
        rc.add('disc', top.clone().addScaledVector(dir, 0.02), qFrom(dir), V(0.095, 0.1, 0.095), '#5A3A12');
      }
      return rc;
    }
    case 'lav': {
      mound(rc, r, 4, [0.07, 0.1], 0.14, ['#7A9A68', '#6E8B5E'], 0.6);
      for (let k = 0; k < 18; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.3;
        const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
        const h = 0.32 + r() * 0.3;
        const tilt = qFrom(V(Math.cos(a) * d * 0.6, 1, Math.sin(a) * d * 0.6));
        const up = UP.clone().applyQuaternion(tilt);
        rc.add('stem', base.clone().addScaledVector(up, h / 2), tilt, V(0.009, h, 0.009), '#6E8B5E');
        rc.add('bud', base.clone().addScaledVector(up, h + 0.05), tilt, V(0.035, 0.13, 0.035), pick(r, LAVS));
      }
      return rc;
    }
    case 'rose': {
      const leaves = mound(rc, r, 11, [0.13, 0.19], 0.2, ['#2F5F2B', '#356B30', '#2A5426'], 1, 0.08);
      for (let k = 0; k < 6; k++) {
        const a = r() * Math.PI * 2;
        stemBetween(rc, V(0, 0.15, 0), V(Math.cos(a) * 0.42, 0.25 + r() * 0.3, Math.sin(a) * 0.42), 0.012, '#6B2230');
      }
      for (let k = 0; k < 15; k++) {
        const L = pick(r, leaves), dir = randDir(r, -0.1, 1);
        bloom(rc, 'rose', L.p.clone().addScaledVector(dir, L.rad * 0.95), dir, r, 1.35);
      }
      return rc;
    }
    case 'poppy': {
      mound(rc, r, 6, [0.06, 0.09], 0.28, ['#6B9B4A', '#5F8D41'], 0.5);
      for (let k = 0; k < 8; k++) {
        const a = r() * Math.PI * 2, d = 0.06 + Math.sqrt(r()) * 0.3;
        const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
        const h = 0.35 + r() * 0.35;
        const mid = base.clone().add(V((r() - 0.5) * 0.12, h * 0.5, (r() - 0.5) * 0.12));
        const top = base.clone().add(V((r() - 0.5) * 0.08, h, (r() - 0.5) * 0.08));
        stemBetween(rc, base, mid, 0.008, '#5F8D41');
        stemBetween(rc, mid, top, 0.008, '#5F8D41');
        rc.add('disc', top, qFrom(V(0, 1, 0)), V(0.11, 0.17, 0.11), pick(r, ['#F07A2A', '#E8662A', '#F38A3A']));
        rc.add('ball', top.clone().add(V(0, 0.035, 0)), null, 0.03, '#2A1A12');
      }
      return rc;
    }
    case 'daisy': {
      mound(rc, r, 8, [0.12, 0.16], 0.3, ['#5FA34E', '#4A8C3F'], 0.45);
      for (let k = 0; k < 22; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.38;
        const p = V(Math.cos(a) * d, 0.12 + r() * 0.06 + (0.38 - d) * 0.2, Math.sin(a) * d);
        const dir = V(Math.cos(a) * d * 0.6, 1, Math.sin(a) * d * 0.6).normalize();
        bloom(rc, 'daisy', p, dir, r, 1.25);
      }
      return rc;
    }
    case 'cherry': {
      // A tiny cherry tree: trunk, two branches, a pink canopy and fallen petals.
      rc.add('taper', V(0, 0.2, 0), null, V(0.045, 0.4, 0.045), BARK);
      stemBetween(rc, V(0, 0.32, 0), V(0.16, 0.48, 0.05), 0.022, BARK);
      stemBetween(rc, V(0, 0.34, 0), V(-0.14, 0.5, -0.06), 0.022, BARK);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r() * 0.5, d = 0.12 + r() * 0.12;
        const c = V(Math.cos(a) * d, 0.5 + r() * 0.16, Math.sin(a) * d);
        for (let j = 0; j < 4; j++) rc.add('ball', c.clone().add(randDir(r).multiplyScalar(0.06)), randQuat(r), 0.07 + r() * 0.03, pick(r, ['#F5A7C7', '#F8C0D6', '#EE93B8', '#FBD3E2']));
      }
      for (let k = 0; k < 6; k++) rc.add('disc', V((r() - 0.5) * 0.7, 0.01, (r() - 0.5) * 0.7), randQuat(r), V(0.03, 0.006, 0.03), '#F8C0D6');
      return rc;
    }
    case 'bell': {
      // A weeping fountain: arching stems that droop at the ends, bells hanging along them.
      for (let k = 0; k < 5; k++) rc.add('leafLo', V((r() - 0.5) * 0.15, 0.08, (r() - 0.5) * 0.15), qFrom(V(r() - 0.5, 1, r() - 0.5)), V(0.03, 0.18, 0.05), pick(r, GREENS));
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r() * 0.4;
        const out = V(Math.cos(a), 0, Math.sin(a));
        let prev = V(0, 0.05, 0);
        for (let j = 1; j <= 4; j++) {
          const t = j / 4;
          const p = out.clone().multiplyScalar(0.36 * t).add(V(0, 0.05 + Math.sin(t * Math.PI * 0.85) * 0.5, 0));
          stemBetween(rc, prev, p, 0.008, '#4E7A3E');
          if (j >= 2) bloom(rc, 'bell', p, V(0, -1, 0), r, 1.5);
          prev = p;
        }
      }
      return rc;
    }
  }
  // Fallback: a plain leafy mound with team blooms.
  const leaves = mound(rc, r, 9, [0.15, 0.24], 0.2, GREENS);
  for (let k = 0; k < 10; k++) {
    const L = pick(r, leaves), dir = randDir(r, 0.05, 1);
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

/** Where the hydrant stands on a water tile (local coordinates). */
export const HYDRANT_AT = V(0.24, 0, -0.22);
export const NOZZLE = V(0.24 - 0.13, SLAB_TOP + 0.24, -0.22);

/** A burst fire hydrant over a big puddle. The spray itself is animated separately. */
export function hydrant(_r: Rng): Recipe {
  const rc = new Recipe();
  rc.add('puddle', V(-0.04, GROUND + 0.004, 0.06), null, V(0.44, 1, 0.36), '#9DBBC8');
  rc.add('puddle', V(-0.04, GROUND + 0.006, 0.06), null, V(0.3, 1, 0.24), '#B9D4DE');
  const red = '#C24A3A', dark = '#8E3328';
  const { x: hx, z: hz } = HYDRANT_AT;
  rc.add('cyl', V(hx, SLAB_TOP + 0.02, hz), null, V(0.12, 0.04, 0.12), dark);
  rc.add('cyl', V(hx, SLAB_TOP + 0.17, hz), null, V(0.085, 0.3, 0.085), red);
  rc.add('cyl', V(hx, SLAB_TOP + 0.26, hz), null, V(0.1, 0.03, 0.1), dark);
  rc.add('dome', V(hx, SLAB_TOP + 0.31, hz), null, V(0.085, 0.07, 0.085), red);
  rc.add('cyl', V(hx, SLAB_TOP + 0.39, hz), null, V(0.02, 0.04, 0.02), dark);
  const side = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  rc.add('cyl', V(hx - 0.1, SLAB_TOP + 0.24, hz), side, V(0.035, 0.08, 0.035), red);
  rc.add('cyl', V(hx + 0.1, SLAB_TOP + 0.2, hz), side, V(0.03, 0.06, 0.03), dark);
  const front = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  rc.add('cyl', V(hx, SLAB_TOP + 0.18, hz + 0.1), front, V(0.04, 0.06, 0.04), red);
  return rc;
}

/**
 * Captured water flourishes: lily pads (some blooming in the owner's flower),
 * reeds and cattails, team bushes at the corners and vines up the hydrant.
 */
export function oasis(team: string, r: Rng, isFountain = false): Recipe {
  const rc = new Recipe();
  for (const [x, z, s] of [[-0.32, -0.32, 0.55], [-0.36, 0.34, 0.5], [0.36, 0.33, 0.45]] as [number, number, number][]) {
    rc.merge(bush(team, r).scaled(s).transform(r() * 6, V(x, GROUND, z)));
  }
  const padY = isFountain ? SLAB_TOP + 0.135 : GROUND + 0.012;
  for (let k = 0; k < 4; k++) {
    const p = isFountain
      ? V(Math.cos(k * 1.6) * 0.24, padY, Math.sin(k * 1.6) * 0.24)
      : V(-0.04 + (r() - 0.5) * 0.5, padY, 0.06 + (r() - 0.5) * 0.36);
    rc.add('disc', p, null, V(0.07, 0.008, 0.07), pick(r, ['#4F8C3E', '#5FA34E']));
    if (k < 2) bloom(rc, team, p.clone().add(V(0, 0.03, 0)), V(0, 1, 0), r, 0.9);
  }
  for (let k = 0; k < 5; k++) {
    const p = V(0.05 + (r() - 0.5) * 0.25, 0, 0.33 + (r() - 0.5) * 0.08);
    const h = 0.3 + r() * 0.2;
    rc.add('stem', p.clone().add(V(0, h / 2, 0)), qFrom(V((r() - 0.5) * 0.2, 1, 0)), V(0.008, h, 0.008), '#5F8D41');
    if (k % 2 === 0) rc.add('bud', p.clone().add(V(0, h, 0)), null, V(0.022, 0.06, 0.022), '#6B4A2A');
  }
  if (isFountain) return rc;
  // Vines spiralling up the hydrant.
  for (let k = 0; k < 9; k++) {
    const a = k * 1.3, y = SLAB_TOP + 0.04 + k * 0.035;
    const p = HYDRANT_AT.clone().add(V(Math.cos(a) * 0.1, y, Math.sin(a) * 0.1));
    rc.add('leafLo', p, randQuat(r), V(0.04, 0.02, 0.035), pick(r, GREENS));
    if (k % 3 === 2) bloom(rc, team, p.clone().add(V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03)), V(Math.cos(a), 0.4, Math.sin(a)).normalize(), r, 0.8);
  }
  return rc;
}

/**
 * Ivy for a building being overgrown. `anchors` are points on its walls (sorted
 * bottom-up) and roof; `coverage` (0..1) is how much of it is claimed.
 */
export function ivy(team: string, anchors: { p: THREE.Vector3; n: THREE.Vector3; roof: boolean }[], coverage: number, r: Rng): Recipe {
  const rc = new Recipe();
  const walls = anchors.filter((a) => !a.roof);
  const n = Math.round(walls.length * coverage);
  for (let k = 0; k < n; k++) {
    const a = walls[k];
    const s = 0.1 + r() * 0.07;
    rc.add('leafLo', a.p.clone().addScaledVector(a.n, 0.04), randQuat(r), V(s, s * 1.2, s * 0.55), pick(r, GREENS));
    if (k % 2 === 1) bloom(rc, team, a.p.clone().addScaledVector(a.n, 0.1), a.n.clone().add(V(0, 0.3, 0)).normalize(), r, 1.1);
  }
  if (coverage >= 1) {
    // A roof garden once the building is surrounded.
    const roofs = anchors.filter((a) => a.roof);
    roofs.forEach((a, k) => {
      if (k % 2 === 0) rc.merge(bush(team, r).scaled(0.45).transform(r() * 6, a.p));
      else rc.add('leafLo', a.p.clone().add(V(0, 0.05, 0)), randQuat(r), 0.1, pick(r, GREENS));
    });
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

export const BILLBOARDS = [
  ['SUNNY DAYS', 'AHEAD'],
  ['WATER YOUR', 'COWORKERS'],
  ['LEAF IT ALL', 'BEHIND'],
  ['CONCRETE IS', 'TEMPORARY'],
  ['PHOTOSYNTHESIZE', 'RESPONSIBLY'],
  ['YOU HAD ME', 'AT HELLO-PHYLL'],
  ['ROOTS BEFORE', 'SHOOTS'],
  ['GROW FOR IT', '']
];

export function billboardTexture(lines = BILLBOARDS[0], canvas?: HTMLCanvasElement): THREE.CanvasTexture {
  const c = canvas ?? document.createElement('canvas');
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
  x.textBaseline = 'middle';
  for (const [k, line] of lines.entries()) {
    x.font = `900 ${Math.min(58, Math.floor(58 * 13 / Math.max(10, line.length)))}px Impact, "Arial Black", sans-serif`;
    x.fillText(line, 28, k ? 148 : 82);
  }
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
