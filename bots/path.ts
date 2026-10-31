import { dirBetween, neighbors4 } from '../shared/grid';
import type { QueuedMove, ViewTile } from '../shared/types';

/** Minimal binary heap keyed by number. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Dijkstra from `src`. cost(i) is the price of entering tile i (Infinity = blocked). */
export function dijkstra(tiles: ViewTile[], W: number, H: number, src: number, cost: (i: number) => number) {
  const dist = new Float64Array(tiles.length).fill(Infinity);
  const prev = new Int32Array(tiles.length).fill(-1);
  const heap = new Heap();
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size) {
    const cur = heap.pop();
    const d = dist[cur];
    for (const n of neighbors4(cur, W, H)) {
      const c = cost(n);
      if (!isFinite(c)) continue;
      if (d + c < dist[n]) {
        dist[n] = d + c;
        prev[n] = cur;
        heap.push(d + c, n);
      }
    }
  }
  return { dist, prev };
}

export function tracePath(prev: Int32Array, src: number, dst: number): number[] | null {
  const out = [dst];
  let cur = dst;
  while (cur !== src) {
    cur = prev[cur];
    if (cur < 0) return null;
    out.push(cur);
  }
  return out.reverse();
}

/** Turn a tile path into queued steps. */
export function pathToMoves(path: number[], W: number, nextId: () => number): QueuedMove[] {
  const out: QueuedMove[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const dir = dirBetween(path[k], path[k + 1], W);
    if (!dir) break;
    out.push({ id: nextId(), from: path[k], dir, half: false });
  }
  return out;
}
