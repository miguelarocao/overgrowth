import { boardSize, FOUNTAIN_GARRISON, MAX_PLAYERS, MIN_PLAYERS, WATER_GARRISON_MAX, WATER_GARRISON_MIN } from './config';
import { bfsDistances, isStreetCoord, neighbors4, passable } from './grid';
import { hashSeed, mulberry32, pick, randInt } from './rng';
import { TEAMS } from './teams';
import type { Building, BuildingStyle, GameState, Tile, TileKind } from './types';

interface Block { x0: number; y0: number; x1: number; y1: number }

/** Runs of non-street indices along one axis, e.g. [[0,1],[3,6],[8,11],...]. */
function segments(size: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= size; i++) {
    const street = i === size || i % 5 === 2;
    if (!street && start < 0) start = i;
    if (street && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

const inBlock = (b: Block, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

function styleFor(w: number, h: number, rng: () => number): BuildingStyle {
  if (w === 1 && h === 1) return rng() < 0.6 ? 'car' : 'shop';
  if (w === 1 || h === 1) return rng() < 0.5 ? 'warehouse' : 'ruin';
  return rng() < 0.6 ? 'apartment' : 'shop';
}

/**
 * Generate a map. Fully seeded: the same seed and player count always give the
 * same map. Maps that fail reachability or fairness checks are retried with the
 * next seed, deterministically.
 */
export function generateMap(seed: number, playerCount: number): GameState {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`playerCount must be ${MIN_PLAYERS}..${MAX_PLAYERS}`);
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const state = tryGenerate(attempt === 0 ? seed : hashSeed(seed, attempt), playerCount);
    if (state) {
      state.seed = seed;
      return state;
    }
  }
  throw new Error('could not generate a valid map');
}

function tryGenerate(seed: number, n: number): GameState | null {
  const rng = mulberry32(hashSeed(seed, n));
  const size = boardSize(n);
  const W = size, H = size;
  const kinds: TileKind[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) kinds.push(isStreetCoord(x, y) ? 'street' : 'plain');
  const stems = new Array<number>(W * H).fill(0);

  // City blocks between the streets.
  const segs = segments(size);
  const blocks: Block[] = [];
  for (const [y0, y1] of segs) for (const [x0, x1] of segs) blocks.push({ x0, y0, x1, y1 });
  const c = (size - 1) / 2;
  let plaza = blocks[0];
  let best = Infinity;
  for (const b of blocks) {
    const d = Math.hypot((b.x0 + b.x1) / 2 - c, (b.y0 + b.y1) / 2 - c);
    if (d < best - 1e-9) { best = d; plaza = b; }
  }

  // 1 or 2 rectangular buildings per block (1-2 wide, 1-3 deep). Never on streets.
  const buildings: Building[] = [];
  for (const b of blocks) {
    if (b === plaza) continue;
    const count = rng() < 0.5 ? 1 : 2;
    const placed: Building[] = [];
    for (let k = 0; k < count; k++) {
      for (let tries = 0; tries < 12; tries++) {
        let w = randInt(rng, 1, 2), h = randInt(rng, 1, 3);
        if (rng() < 0.5) [w, h] = [h, w];
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        if (w > bw || h > bh) continue;
        const x = b.x0 + randInt(rng, 0, bw - w), y = b.y0 + randInt(rng, 0, bh - h);
        if (placed.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h)) continue;
        const bld = { x, y, w, h, style: styleFor(w, h, rng) };
        placed.push(bld);
        break;
      }
    }
    for (const bld of placed) {
      buildings.push(bld);
      for (let y = bld.y; y < bld.y + bld.h; y++) for (let x = bld.x; x < bld.x + bld.w; x++) kinds[y * W + x] = 'building';
    }
  }

  // Plaza fountain.
  const fx = plaza.x0 + randInt(rng, 1, Math.max(1, plaza.x1 - plaza.x0 - 1));
  const fy = plaza.y0 + randInt(rng, 1, Math.max(1, plaza.y1 - plaza.y0 - 1));
  const fountain = fy * W + fx;
  kinds[fountain] = 'water';
  stems[fountain] = FOUNTAIN_GARRISON;

  // Every non-building tile must be connected. Check once from any open tile.
  const anyOpen = kinds.findIndex((k) => passable(k));
  const all = bfsDistances(kinds, W, H, anyOpen);
  for (let i = 0; i < kinds.length; i++) if (passable(kinds[i]) && all[i] < 0) return null;

  // Mother plants: non-street tiles outside the plaza, spread far apart.
  const candidates: number[] = [];
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = Math.floor(i / W);
    if (kinds[i] !== 'plain' || inBlock(plaza, x, y)) continue;
    if (neighbors4(i, W, H).filter((j) => passable(kinds[j])).length < 2) continue;
    candidates.push(i);
  }
  if (candidates.length < n) return null;
  const minSpread = Math.floor((1.3 * size) / Math.sqrt(n));
  let mothers: number[] | null = null;
  let mothersDist: Int32Array[] = [];
  let bestSpread = -1;
  for (let trial = 0; trial < 16; trial++) {
    const chosen = [pick(rng, candidates)];
    const dists = [bfsDistances(kinds, W, H, chosen[0])];
    while (chosen.length < n) {
      // Farthest-point sampling, picking randomly among near-best options for variety.
      const score = candidates.map((cand) => (chosen.includes(cand) ? -1 : Math.min(...dists.map((d) => d[cand]))));
      const top = Math.max(...score);
      if (top <= 0) break;
      const good = candidates.filter((_, k) => score[k] >= top * 0.9);
      const next = pick(rng, good);
      chosen.push(next);
      dists.push(bfsDistances(kinds, W, H, next));
    }
    if (chosen.length < n) continue;
    let spread = Infinity;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) spread = Math.min(spread, dists[a][chosen[b]]);
    if (spread > bestSpread) { bestSpread = spread; mothers = chosen; mothersDist = dists; }
  }
  if (!mothers || bestSpread < minSpread) return null;

  const waters = [fountain];
  const nearWater = (i: number) => waters.some((w) => Math.max(Math.abs((w % W) - (i % W)), Math.abs(Math.floor(w / W) - Math.floor(i / W))) < 2);
  const freeTile = (i: number) => {
    const x = i % W, y = Math.floor(i / W);
    if (mothers!.some((m) => Math.abs((m % W) - x) + Math.abs(Math.floor(m / W) - y) < 3)) return false;
    return (kinds[i] === 'plain' || kinds[i] === 'street') && !inBlock(plaza, x, y) && !nearWater(i);
  };

  // One "home" water per mother at the same path distance, for fairness.
  const homeDist = randInt(rng, 5, 7);
  for (let m = 0; m < n; m++) {
    const options: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!freeTile(i) || mothersDist[m][i] !== homeDist) continue;
      if (mothersDist.some((d, o) => o !== m && d[i] <= homeDist + 1)) continue;
      options.push(i);
    }
    if (!options.length) return null;
    const w = pick(rng, options);
    waters.push(w);
    kinds[w] = 'water';
    stems[w] = randInt(rng, WATER_GARRISON_MIN, WATER_GARRISON_MAX);
  }

  // The rest: roughly one water per 30 non-building tiles, farther from every mother than its home water.
  const open = kinds.filter((k) => k !== 'building').length;
  const target = Math.max(n + 1, Math.round(open / 30));
  while (waters.length < target) {
    const options: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!freeTile(i)) continue;
      if (mothersDist.some((d) => d[i] <= homeDist)) continue;
      options.push(i);
    }
    if (!options.length) break;
    const w = pick(rng, options);
    waters.push(w);
    kinds[w] = 'water';
    stems[w] = randInt(rng, WATER_GARRISON_MIN, WATER_GARRISON_MAX);
  }

  // Fairness: every mother has (nearly) the same path distance to its nearest water.
  const nearest = mothersDist.map((d) => Math.min(...waters.map((w) => d[w]).filter((v) => v >= 0)));
  if (Math.max(...nearest) - Math.min(...nearest) > 1) return null;
  if (nearest.some((v) => v < 3)) return null;
  const fxm = fountain % W, fym = Math.floor(fountain / W);
  if (mothers.some((m) => Math.abs((m % W) - fxm) + Math.abs(Math.floor(m / W) - fym) < 3)) return null;

  const tiles: Tile[] = kinds.map((kind, i) => ({ kind, owner: null, stems: stems[i], isMother: false }));
  mothers.forEach((m, pid) => {
    tiles[m] = { kind: 'plain', owner: pid, stems: 1, isMother: true };
  });

  return {
    seed,
    tick: 0,
    width: W,
    height: H,
    tiles,
    players: Array.from({ length: n }, (_, id) => ({ id, team: TEAMS[id].key, alive: true })),
    buildings,
    fountain
  };
}
