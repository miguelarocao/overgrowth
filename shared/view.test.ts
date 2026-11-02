import { describe, expect, it } from 'vitest';
import { makeState } from './testutil';
import { VISION_RADIUS } from './config';
import { viewFor, visibilityFor } from './view';

describe('visibility', () => {
  // 7x7: player 0's mother in the corner, a hydrant at (3,3), player 1 in the far corner.
  const s = makeState([
    'A......',
    '.......',
    '.......',
    '...~...',
    '.......',
    '......#',
    '.....1B'
  ], 2, { 24: 44, 47: 6, 48: 9 });

  it(`sees every tile within ${VISION_RADIUS} of an owned tile, including diagonals`, () => {
    const v = visibilityFor(s, 0);
    const want: number[] = [];
    for (let y = 0; y <= VISION_RADIUS; y++) for (let x = 0; x <= VISION_RADIUS; x++) want.push(y * 7 + x);
    expect([...v].map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual(want);
  });

  it('hides ownership, stems, mothers and water outside vision but keeps streets and buildings', () => {
    const v = viewFor(s, 0);
    expect(v.full).toBe(false);
    expect(v.tiles[24]).toEqual({ kind: 'plain', owner: null, stems: 0, isMother: false, visible: false }); // hydrants hide in fog
    expect(v.tiles[48]).toEqual({ kind: 'plain', owner: null, stems: 0, isMother: false, visible: false });
    expect(v.tiles[41].kind).toBe('building');
    expect(v.tiles[0]).toMatchObject({ owner: 0, isMother: true, visible: true });
  });

  it('spectators and eliminated players see everything', () => {
    expect(viewFor(s, null).tiles[48]).toMatchObject({ owner: 1, isMother: true, stems: 9 });
    const dead = { ...s, players: s.players.map((p) => ({ ...p, alive: p.id !== 0 })) };
    expect(viewFor(dead, 0).full).toBe(true);
  });
});
