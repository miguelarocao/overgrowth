// Starting values from the spec. Tune here.
export const TICK_MS = 500;
export const TICKS_PER_TURN = 2;
/** Mothers and owned water gain 1 stem every turn. */
export const CORE_GROWTH_TICKS = TICKS_PER_TURN;
/** Every owned tile gains 1 stem every 25 turns. */
export const LAND_GROWTH_TICKS = 25 * TICKS_PER_TURN;
export const DISCONNECT_GRACE_MS = 60_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const MAX_QUEUE = 300;
/**
 * How far you see around each owned tile (Chebyshev distance, so diagonals count).
 * The spec (and generals.io) use 1; playtesters found that too foggy, so we use 2.
 */
export const VISION_RADIUS = 2;
export const FOUNTAIN_GARRISON = 50;
export const WATER_GARRISON_MIN = 40;
export const WATER_GARRISON_MAX = 50;

/**
 * Board side length by player count. Playtesters found the earlier sizes (20 for 2 players
 * up to 35 for 12) too big, so each side is ~15% smaller: 2 players get 18x18 (the low end
 * of generals.io 1v1 maps, which are randomised 18-23 per side), 4 get 20x20 and 8 get
 * 25x25, close to the spec's original 20x20 / 26x26. That's roughly 70-100 tiles per
 * player in bigger games (about 68 at 16 players on 33x33).
 */
const BOARD_SIZES: Record<number, number> = {
  2: 18, 3: 19, 4: 20, 5: 22, 6: 23, 7: 24, 8: 25, 9: 26, 10: 27, 11: 28, 12: 29, 13: 30, 14: 31, 15: 32, 16: 33
};

export function boardSize(playerCount: number): number {
  return BOARD_SIZES[Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount))];
}

/** Time limit options for the lobby, in minutes (0 = no limit). */
export const TIME_LIMITS = [0, 5, 10, 15, 20] as const;

/** Wall-clock minutes at a given tick length, as whole turns of ticks for the engine. */
export function timeLimitTicks(minutes: number, tickMs: number): number {
  if (minutes <= 0) return 0;
  const ticks = Math.round((minutes * 60_000) / tickMs);
  return ticks + (ticks % TICKS_PER_TURN ? TICKS_PER_TURN - (ticks % TICKS_PER_TURN) : 0);
}

/** Game pace options (tick length). */
export const PACES = { relaxed: 500, brisk: 350, frantic: 250 } as const;
export type Pace = keyof typeof PACES;

/** Quick emotes, sent with keys 1-6. */
export const EMOTES: readonly { emoji: string; label: string }[] = [
  { emoji: '🌱', label: 'gg' },
  { emoji: '🌸', label: 'bloom!' },
  { emoji: '🐝', label: 'bzzz' },
  { emoji: '💧', label: 'thirsty' },
  { emoji: '🥀', label: 'oof' },
  { emoji: '👀', label: 'I see you' }
];
