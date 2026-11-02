import { MOTHER_VISION_RADIUS, VISION_RADIUS } from './config';
import type { GameState, PlayerId, PlayerView, TileKind, ViewTile } from './types';

/**
 * Which tiles a player can see: everything within VISION_RADIUS of a tile they own (diagonals
 * too), plus any mother tree within MOTHER_VISION_RADIUS, since trees stand tall over the city.
 */
export function visibilityFor(state: GameState, player: PlayerId): Uint8Array {
  const { width: W, height: H, tiles } = state;
  const vis = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].owner !== player) continue;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
      for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) vis[ny * W + nx] = 1;
      }
    }
  }
  // Tall trees: reveal just the mother's tile when any of your land is within the larger radius.
  const R = MOTHER_VISION_RADIUS;
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i].isMother || vis[i]) continue;
    const x = i % W, y = Math.floor(i / W);
    search: for (let ny = Math.max(0, y - R); ny <= Math.min(H - 1, y + R); ny++) {
      for (let nx = Math.max(0, x - R); nx <= Math.min(W - 1, x + R); nx++) {
        if (tiles[ny * W + nx].owner === player) {
          vis[i] = 1;
          break search;
        }
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
