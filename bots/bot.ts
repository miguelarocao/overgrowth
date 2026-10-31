import { neighbors4 } from '../shared/grid';
import { mulberry32 } from '../shared/rng';
import type { PlayerId, PlayerView, QueuedMove, ViewTile } from '../shared/types';
import { dijkstra, pathToMoves, tracePath } from './path';

/**
 * A simple, deterministic bot. It only sees its own fogged PlayerView and talks
 * to the game through the same queue API as a human (it returns steps to append).
 *
 * Each time its queue runs dry it picks one plan, in priority order:
 *   1. hit a known enemy mother plant when the biggest stack can take it
 *   2. take an adjacent enemy tile with a clearly bigger stack
 *   3. take reachable neutral water
 *   4. march the big stack at the nearest enemy (or explore towards them)
 *   5. expand: walk a stack across empty land, leaving 1 behind per tile
 *   6. gather: pull a stack towards the biggest one
 */
export class Bot {
  private rng: () => number;
  private idCounter = 1;
  private enemyMothers = new Map<number, number>(); // tile -> last seen stems
  private exploreTarget = -1;
  private seenEnemy = new Set<number>();
  /** Where the marching army ended up last time; we keep using it. */
  private army = -1;
  private waitUntil = 0;

  constructor(readonly player: PlayerId, seed: number, readonly aggression = 1) {
    this.rng = mulberry32(seed ^ (player * 0x9e3779b1));
  }

  private nextId = () => this.idCounter++;

  think(view: PlayerView, queueLength: number): QueuedMove[] {
    if (queueLength > 0) return [];
    if (view.tick < this.waitUntil) return [];
    const { tiles, width: W, height: H } = view;
    const me = this.player;
    const mine: number[] = [];
    const enemy: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.owner === me) mine.push(i);
      else if (t.visible && t.owner !== null) enemy.push(i);
      if (t.visible) {
        if (t.owner !== null && t.owner !== me) this.seenEnemy.add(i);
        else this.seenEnemy.delete(i);
        if (t.isMother && t.owner !== me) this.enemyMothers.set(i, t.stems);
        else if (this.enemyMothers.has(i)) this.enemyMothers.delete(i);
      }
    }
    if (!mine.length) return [];
    let big = mine[0];
    for (const i of mine) if (tiles[i].stems > tiles[big].stems) big = i;
    if (this.army >= 0 && tiles[this.army].owner === me && tiles[this.army].stems >= tiles[big].stems * 0.4) big = this.army;
    else this.army = -1;
    const bigStems = tiles[big].stems;
    const plan = (path: number[] | null, max = 40) => (path && path.length > 1 ? pathToMoves(path.slice(0, max + 1), W, this.nextId) : null);

    // Cost of walking through a tile: stems you'd lose there, plus a step.
    const attackCost = (i: number) => {
      const t = tiles[i];
      if (t.kind === 'building') return Infinity;
      if (t.owner === me) return 1;
      if (!t.visible) return t.kind === 'water' ? 60 : 3;
      return 1 + t.stems;
    };
    const fromBig = dijkstra(tiles, W, H, big, attackCost);
    const arrive = (dst: number) => bigStems - fromBig.dist[dst];

    // 1. Known enemy mother.
    let bestMother = -1;
    for (const [m, s] of this.enemyMothers) {
      const est = (tiles[m].visible ? tiles[m].stems : s + 10);
      if (arrive(m) > est + 2 && (bestMother < 0 || fromBig.dist[m] < fromBig.dist[bestMother])) bestMother = m;
    }
    if (bestMother >= 0) {
      const p = plan(tracePath(fromBig.prev, big, bestMother));
      if (p) return p;
    }

    // 2. Adjacent enemy tile, cheapest first.
    let bestHit: [number, number] | null = null;
    for (const e of enemy) {
      for (const n of neighbors4(e, W, H)) {
        if (tiles[n].owner !== me) continue;
        const margin = tiles[n].stems - 1 - tiles[e].stems;
        if (margin >= 2 + tiles[e].stems && (!bestHit || tiles[e].stems < tiles[bestHit[1]].stems)) bestHit = [n, e];
      }
    }
    if (bestHit && this.rng() < 0.85) {
      const p = plan([bestHit[0], bestHit[1]]);
      if (p) return p;
    }

    // 3. Neutral water we can take with the biggest stack.
    if (bigStems > 30) {
      let bestW = -1;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (t.kind !== 'water' || !t.visible || t.owner !== null) continue;
        if (arrive(i) > 4 && (bestW < 0 || fromBig.dist[i] < fromBig.dist[bestW])) bestW = i;
      }
      if (bestW >= 0) {
        const p = plan(tracePath(fromBig.prev, big, bestW));
        if (p) return p;
      }
    }

    // 4. Early on, expanding beats everything else.
    const expand = this.bestExpansion(tiles, W, H, mine);
    if (expand && (view.tick < 500 || expand.length > 4)) return plan(expand)!;

    // 5. Gather when the army is spread thin: walk a far stack home through rich tiles.
    let total = 0;
    for (const i of mine) total += tiles[i].stems;
    if (mine.length > 12 && bigStems < 0.3 * total) {
      const g = this.gatherPath(tiles, W, H, mine, big);
      if (g) return plan(g, 30)!;
    }

    // 6. March: at a known mother, else the nearest enemy, else explore.
    const threshold = Math.min(80, 30 / this.aggression + view.tick / 60);
    if (bigStems > threshold) {
      let target = -1;
      for (const m of this.enemyMothers.keys()) if (target < 0 || fromBig.dist[m] < fromBig.dist[target]) target = m;
      if (target < 0) target = this.pickExplore(view, big, mine);
      if (target >= 0) {
        const path = tracePath(fromBig.prev, big, target);
        const p = plan(path, 25);
        if (p && path) {
          this.army = path[Math.min(25, path.length - 1)];
          return p;
        }
      }
    }

    if (expand) return plan(expand)!;

    // 7. Gather anything left.
    const g = this.gatherPath(tiles, W, H, mine, big);
    if (g) return plan(g, 30)!;
    this.waitUntil = view.tick + 4;
    return [];
  }

  /** A path from a far, rich own tile to the biggest stack, collecting stems on the way. */
  private gatherPath(tiles: ViewTile[], W: number, H: number, mine: number[], big: number): number[] | null {
    const me = this.player;
    const rich = dijkstra(tiles, W, H, big, (i) => (tiles[i].owner === me ? 1 + 8 / (1 + tiles[i].stems) : Infinity));
    let best: number[] | null = null;
    let bestGain = 0;
    for (let k = 0; k < 24; k++) {
      const src = mine[Math.floor(this.rng() * mine.length)];
      if (src === big || tiles[src].stems < 2) continue;
      const back = tracePath(rich.prev, big, src);
      if (!back || back.length < 2) continue;
      const path = back.reverse().slice(0, 31);
      let gain = 0;
      for (let j = 0; j < path.length - 1; j++) gain += tiles[path[j]].stems - 1;
      if (gain > bestGain) { bestGain = gain; best = path; }
    }
    return bestGain >= 4 ? best : null;
  }

  private pickExplore(view: PlayerView, from: number, mine: number[]): number {
    const { tiles, width: W, height: H } = view;
    if (this.exploreTarget >= 0 && !tiles[this.exploreTarget].visible) return this.exploreTarget;
    if (this.seenEnemy.size) {
      // Mothers sit deep inside enemy land: prefer hidden tiles surrounded by known enemy tiles.
      const fx0 = from % W, fy0 = Math.floor(from / W);
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < tiles.length; i++) {
        if (tiles[i].visible || tiles[i].kind === 'building') continue;
        const x = i % W, y = Math.floor(i / W);
        let dense = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && this.seenEnemy.has(ny * W + nx)) dense++;
        }
        if (!dense) continue;
        const score = dense * 2 - (Math.abs(x - fx0) + Math.abs(y - fy0)) + this.rng();
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) {
        this.exploreTarget = best;
        return best;
      }
    }
    // Head for a hidden, open tile far from where we are.
    const fx = from % W, fy = Math.floor(from / W);
    let best = -1, bestScore = -1;
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(this.rng() * tiles.length);
      if (tiles[i].visible || tiles[i].kind === 'building') continue;
      const d = Math.abs((i % W) - fx) + Math.abs(Math.floor(i / W) - fy);
      if (d > bestScore) { bestScore = d; best = i; }
    }
    if (best < 0) best = (H - 1 - fy) * W + (W - 1 - fx);
    this.exploreTarget = best;
    return best;
  }

  /** Greedy walk from the best stack over empty neutral tiles, leaving 1 behind each step. */
  private bestExpansion(tiles: ViewTile[], W: number, H: number, mine: number[]): number[] | null {
    const empty = (i: number) => tiles[i].owner === null && tiles[i].stems === 0 && tiles[i].kind !== 'building' && tiles[i].visible;
    let best: number[] | null = null;
    const sources = mine.filter((i) => tiles[i].stems >= 3).sort((a, b) => tiles[b].stems - tiles[a].stems).slice(0, 6);
    for (const s of sources) {
      // Step through own tiles first if the stack is landlocked (up to 6 tiles).
      let start = s;
      const path = [s];
      if (!neighbors4(s, W, H).some(empty)) {
        const own = dijkstra(tiles, W, H, s, (i) => (tiles[i].owner === this.player ? 1 : empty(i) ? 1 : Infinity));
        let frontier = -1;
        for (let i = 0; i < tiles.length; i++) if (empty(i) && own.dist[i] <= 7 && (frontier < 0 || own.dist[i] < own.dist[frontier])) frontier = i;
        if (frontier < 0) continue;
        const p = tracePath(own.prev, s, frontier);
        if (!p) continue;
        path.length = 0;
        path.push(...p);
        start = frontier;
      }
      const budget = Math.min(tiles[s].stems - 1, 14);
      const seen = new Set(path);
      let cur = start;
      while (path.length - 1 < budget) {
        const opts = neighbors4(cur, W, H).filter((n) => empty(n) && !seen.has(n));
        if (!opts.length) break;
        // Prefer tiles with more empty neighbours (keeps the walk going).
        opts.sort((a, b) => neighbors4(b, W, H).filter(empty).length - neighbors4(a, W, H).filter(empty).length || this.rng() - 0.5);
        cur = opts[0];
        seen.add(cur);
        path.push(cur);
      }
      const gained = path.filter(empty).length;
      if (gained >= 2 && (!best || gained > best.filter(empty).length)) best = path;
    }
    return best;
  }
}
