import { describe, expect, it } from 'vitest';
import { bfsDistances, passable } from './grid';
import { hashState } from './engine';
import { generateMap } from './mapgen';
import { boardSize, MAX_PLAYERS, SPAWN_EDGE_MARGIN } from './config';

describe('generateMap', () => {
  it('is fully seeded', () => {
    expect(hashState(generateMap(42, 4))).toBe(hashState(generateMap(42, 4)));
    expect(hashState(generateMap(42, 4))).not.toBe(hashState(generateMap(43, 4)));
  });

  for (let n = 2; n <= MAX_PLAYERS; n++) {
    it(`builds a valid, fair map for ${n} players`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const s = generateMap(seed * 101, n);
        const size = boardSize(n);
        expect(s.width).toBe(size);
        expect(s.height).toBe(size);
        const kinds = s.tiles.map((t) => t.kind);
        // Streets on every row/column where index % 5 == 2, never built on.
        for (let i = 0; i < s.tiles.length; i++) {
          const x = i % size, y = Math.floor(i / size);
          if (x % 5 === 2 || y % 5 === 2) expect(['street', 'water']).toContain(kinds[i]);
        }
        const mothers = s.tiles.map((t, i) => (t.isMother ? i : -1)).filter((i) => i >= 0);
        expect(mothers.length).toBe(n);
        mothers.sort((a, b) => s.tiles[a].owner! - s.tiles[b].owner!);
        mothers.forEach((m, pid) => {
          expect(s.tiles[m].owner).toBe(pid);
          const mx = m % size, my = Math.floor(m / size);
          expect(Math.min(mx, my, size - 1 - mx, size - 1 - my)).toBeGreaterThanOrEqual(SPAWN_EDGE_MARGIN);
          expect(kinds[m]).toBe('plain');
        });
        // Every non-building tile reachable from every mother.
        const waters = kinds.map((k, i) => (k === 'water' ? i : -1)).filter((i) => i >= 0);
        const nearest: number[] = [];
        for (const m of mothers) {
          const d = bfsDistances(kinds, size, size, m);
          kinds.forEach((k, i) => {
            if (passable(k)) expect(d[i]).toBeGreaterThanOrEqual(0);
          });
          nearest.push(Math.min(...waters.map((w) => d[w])));
          // Water at least 3 tiles from any mother.
          for (const w of waters) expect(Math.abs((w % size) - (m % size)) + Math.abs(Math.floor(w / size) - Math.floor(m / size))).toBeGreaterThanOrEqual(3);
        }
        expect(Math.max(...nearest) - Math.min(...nearest)).toBeLessThanOrEqual(1);
        // Fountain in the plaza with a ~50 garrison; other water 40-50.
        expect(s.tiles[s.fountain]).toMatchObject({ kind: 'water', stems: 50 });
        for (const w of waters) {
          expect(s.tiles[w].stems).toBeGreaterThanOrEqual(40);
          expect(s.tiles[w].stems).toBeLessThanOrEqual(50);
        }
        const open = kinds.filter((k) => k !== 'building').length;
        expect(waters.length).toBeGreaterThanOrEqual(Math.min(n + 1, Math.round(open / 30)) - 0);
      }
    });
  }
});
