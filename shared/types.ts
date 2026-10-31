// Core engine types. Everything in shared/ is pure TypeScript: no DOM, no network,
// no clocks, no Math.random. Same seed + same inputs => same state.

export type PlayerId = number;
export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export type TileKind = 'plain' | 'street' | 'building' | 'water';
export const KINDS: readonly TileKind[] = ['plain', 'street', 'building', 'water'];

export interface Tile {
  kind: TileKind;
  owner: PlayerId | null;
  stems: number;
  isMother: boolean;
}

export type BuildingStyle = 'apartment' | 'warehouse' | 'ruin' | 'shop' | 'car';

/** A rectangular building footprint, used by the renderer to pick a model. */
export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  style: BuildingStyle;
}

export interface PlayerState {
  id: PlayerId;
  team: string;
  alive: boolean;
}

export interface GameState {
  seed: number;
  tick: number;
  width: number;
  height: number;
  tiles: Tile[]; // row-major: index = y * width + x
  players: PlayerState[]; // players[id].id === id
  buildings: Building[];
  /** Index of the plaza fountain tile. */
  fountain: number;
}

export interface Move {
  from: number;
  dir: Dir;
  half: boolean;
}

/** A move sitting in a player's queue. The id is chosen by the client. */
export interface QueuedMove extends Move {
  id: number;
}

export interface ViewTile {
  kind: TileKind;
  owner: PlayerId | null;
  stems: number;
  isMother: boolean;
  visible: boolean;
}

export interface PlayerView {
  tick: number;
  width: number;
  height: number;
  tiles: ViewTile[];
  /** The player this view is for, or null for a spectator. */
  you: PlayerId | null;
  /** True when nothing is hidden (spectators, eliminated players, game over). */
  full: boolean;
}

export type MoveOutcome = 'ok' | 'failed' | 'invalid';
