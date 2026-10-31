import type { Dir, TileKind } from './types';

export const DX: Record<Dir, number> = { up: 0, down: 0, left: -1, right: 1 };
export const DY: Record<Dir, number> = { up: -1, down: 1, left: 0, right: 0 };

/** Index of the tile next to `idx` in direction `dir`, or -1 if off the board. */
export function neighbor(idx: number, dir: Dir, width: number, height: number): number {
  const x = (idx % width) + DX[dir];
  const y = Math.floor(idx / width) + DY[dir];
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return y * width + x;
}

/** The four orthogonal neighbours that exist on the board. */
export function neighbors4(idx: number, width: number, height: number): number[] {
  const x = idx % width;
  const y = Math.floor(idx / width);
  const out: number[] = [];
  if (y > 0) out.push(idx - width);
  if (y < height - 1) out.push(idx + width);
  if (x > 0) out.push(idx - 1);
  if (x < width - 1) out.push(idx + 1);
  return out;
}

/** Direction from tile a to an adjacent tile b, or null if not adjacent. */
export function dirBetween(a: number, b: number, width: number): Dir | null {
  const ax = a % width, ay = Math.floor(a / width);
  const bx = b % width, by = Math.floor(b / width);
  if (ax === bx && by === ay - 1) return 'up';
  if (ax === bx && by === ay + 1) return 'down';
  if (ay === by && bx === ax - 1) return 'left';
  if (ay === by && bx === ax + 1) return 'right';
  return null;
}

export const passable = (k: TileKind) => k !== 'building';

/** Breadth-first path distances from `start` over passable tiles. -1 = unreachable. */
export function bfsDistances(kinds: readonly TileKind[], width: number, height: number, start: number): Int32Array {
  const dist = new Int32Array(kinds.length).fill(-1);
  if (!passable(kinds[start])) return dist;
  const queue = new Int32Array(kinds.length);
  let head = 0, tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  while (head < tail) {
    const cur = queue[head++];
    for (const n of neighbors4(cur, width, height)) {
      if (dist[n] !== -1 || !passable(kinds[n])) continue;
      dist[n] = dist[cur] + 1;
      queue[tail++] = n;
    }
  }
  return dist;
}

export const isStreetCoord = (x: number, y: number) => x % 5 === 2 || y % 5 === 2;
