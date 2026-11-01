// Spring showers (optional rule): every so often a rain cloud settles over a
// square patch of the city for a while. Owned land under it grows +1 every turn,
// like a mother plant. The schedule is a pure function of seed and tick, so it is
// deterministic and replayable. Clients never get the seed (it would reveal the
// map), so the server tells them about the current and upcoming shower instead.
import { hashSeed, mulberry32, randInt } from './rng';
import type { GameState } from './types';

export const FIRST_SHOWER_TICK = 100;
export const SHOWER_EVERY_TICKS = 140; // 70 turns
export const SHOWER_TICKS = 30; // 15 turns
export const FORECAST_TICKS = 20; // clouds gather 10 turns ahead

export interface Shower {
  x: number;
  y: number;
  size: number;
  start: number; // first tick it rains
  end: number; // first tick it no longer rains
}

type WeatherInput = Pick<GameState, 'seed' | 'width' | 'height' | 'rules'>;

function nthShower(s: WeatherInput, k: number): Shower {
  const r = mulberry32(hashSeed(s.seed ^ 0x5eed, k));
  const size = s.width >= 26 ? 6 : 5;
  const start = FIRST_SHOWER_TICK + k * SHOWER_EVERY_TICKS;
  return { x: randInt(r, 1, s.width - size - 1), y: randInt(r, 1, s.height - size - 1), size, start, end: start + SHOWER_TICKS };
}

/** The shower raining at `tick`, if any. */
export function showerAt(s: WeatherInput, tick: number): Shower | null {
  if (!s.rules?.showers || tick < FIRST_SHOWER_TICK) return null;
  const k = Math.floor((tick - FIRST_SHOWER_TICK) / SHOWER_EVERY_TICKS);
  const sh = nthShower(s, k);
  return tick < sh.end ? sh : null;
}

/** The next shower if it starts within the forecast window (clouds gathering). */
export function forecastAt(s: WeatherInput, tick: number): Shower | null {
  if (!s.rules?.showers) return null;
  const k = tick < FIRST_SHOWER_TICK ? 0 : Math.floor((tick - FIRST_SHOWER_TICK) / SHOWER_EVERY_TICKS) + 1;
  const sh = nthShower(s, k);
  return sh.start > tick && sh.start - tick <= FORECAST_TICKS ? sh : null;
}

export function inShower(sh: Shower, idx: number, width: number): boolean {
  const x = idx % width, y = Math.floor(idx / width);
  return x >= sh.x && x < sh.x + sh.size && y >= sh.y && y < sh.y + sh.size;
}
