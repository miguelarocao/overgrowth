// Starting values from the spec. Tune here.
export const TICK_MS = 500;
export const TICKS_PER_TURN = 2;
/** Mothers and owned water gain 1 stem every turn. */
export const CORE_GROWTH_TICKS = TICKS_PER_TURN;
/** Every owned tile gains 1 stem every 25 turns. */
export const LAND_GROWTH_TICKS = 25 * TICKS_PER_TURN;
export const DISCONNECT_GRACE_MS = 60_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_QUEUE = 300;
export const FOUNTAIN_GARRISON = 50;
export const WATER_GARRISON_MIN = 40;
export const WATER_GARRISON_MAX = 50;

export function boardSize(playerCount: number): number {
  return playerCount <= 4 ? 20 : 26;
}
