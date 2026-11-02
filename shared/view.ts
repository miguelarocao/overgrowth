import type { GameState, PlayerId, PlayerView, TileKind, ViewTile } from './types';

/** Which tiles a player can see: their own tiles and every tile touching them (diagonals too). */
export function visibilityFor(state: GameState, player: PlayerId): Uint8Array {
  const { width: W, height: H, tiles } = state;
  const vis = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].owner !== player) continue;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) vis[ny * W + nx] = 1;
      }
    }
  }
  return vis;
}

/** Terrain a player may know about a tile they can't see: water (hydrants) stays hidden until scouted. */
export const fogKind = (k: TileKind): TileKind => (k === 'water' ? 'plain' : k);

/**
 * What a player is allowed to know. Streets and buildings are always visible;
 * ownership, stems, mother plants and water (hydrants) only inside vision. Spectators
 * (player = null) and eliminated players get the full, unfogged view.
 */
export function viewFor(state: GameState, player: PlayerId | null, forceFull = false): PlayerView {
  const full = forceFull || player === null || !state.players[player]?.alive;
  const vis = full ? null : visibilityFor(state, player!);
  const tiles: ViewTile[] = state.tiles.map((t, i) => {
    if (!vis || vis[i]) return { kind: t.kind, owner: t.owner, stems: t.stems, isMother: t.isMother, visible: true };
    return { kind: fogKind(t.kind), owner: null, stems: 0, isMother: false, visible: false };
  });
  return { tick: state.tick, width: state.width, height: state.height, tiles, you: player, full };
}
