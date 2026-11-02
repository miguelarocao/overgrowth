import { describe, expect, it } from 'vitest';
import { makeState } from './testutil';
import { viewFor, visibilityFor } from './view';

describe('visibility', () => {
  const s = makeState([
    'A....',
    '.....',
    '..~..',
    '....#',
    '...1B'
  ], 2, { 12: 44, 23: 6, 24: 9 });

  it('sees own tiles and every tile touching them, including diagonals', () => {
    const v = visibilityFor(s, 0);
    expect([...v].map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 5, 6]);
  });

  it('hides ownership, stems, mothers and water outside vision but keeps streets and buildings', () => {
    const v = viewFor(s, 0);
    expect(v.full).toBe(false);
    expect(v.tiles[12]).toEqual({ kind: 'plain', owner: null, stems: 0, isMother: false, visible: false }); // hydrants hide in fog
    expect(v.tiles[24]).toEqual({ kind: 'plain', owner: null, stems: 0, isMother: false, visible: false });
    expect(v.tiles[19].kind).toBe('building');
    expect(v.tiles[0]).toMatchObject({ owner: 0, isMother: true, visible: true });
  });

  it('spectators and eliminated players see everything', () => {
    expect(viewFor(s, null).tiles[24]).toMatchObject({ owner: 1, isMother: true, stems: 9 });
    const dead = { ...s, players: s.players.map((p) => ({ ...p, alive: p.id !== 0 })) };
    expect(viewFor(dead, 0).full).toBe(true);
  });
});
