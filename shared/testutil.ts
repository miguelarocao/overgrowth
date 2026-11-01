import type { GameState, Tile, TileKind } from './types';

/**
 * Build a tiny state from ASCII rows for tests.
 * '.' plain, '=' street, '#' building, '~' neutral water.
 * Digits 0-7 are owned plain tiles; uppercase A-H are mothers of players 0-7.
 * Stems come from the `stems` map (index -> count), default 1 for owned, 0 otherwise.
 */
export function makeState(rows: string[], players: number, stems: Record<number, number> = {}): GameState {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[] = [];
  rows.join('').split('').forEach((ch, i) => {
    let kind: TileKind = 'plain';
    let owner: number | null = null;
    let isMother = false;
    if (ch === '=') kind = 'street';
    else if (ch === '#') kind = 'building';
    else if (ch === '~') kind = 'water';
    else if (ch >= '0' && ch <= '7') owner = Number(ch);
    else if (ch >= 'A' && ch <= 'H') { owner = ch.charCodeAt(0) - 65; isMother = true; }
    tiles.push({ kind, owner, isMother, stems: stems[i] ?? (owner !== null ? 1 : 0) });
  });
  return {
    seed: 1,
    tick: 1, // odd, so the next step (tick 2) is a growth tick; tests use tick explicitly where it matters
    width,
    height,
    tiles,
    players: Array.from({ length: players }, (_, id) => ({ id, team: 't' + id, alive: true })),
    buildings: [],
    fountain: -1,
    rules: { showers: false }
  };
}
