import { step, surrender } from './engine';
import { generateMap } from './mapgen';
import type { GameState, Move, PlayerId, Rules } from './types';
import { DIRS } from './types';

/** One tick of inputs: moves as [player, from, dirIndex, half] and any surrenders. */
export interface ReplayTick {
  m: [PlayerId, number, number, 0 | 1][];
  s?: PlayerId[];
}

/** A replay is just the seed plus every tick's inputs. The viewer re-runs the engine. */
export interface Replay {
  version: 1;
  id: string;
  seed: number;
  playerCount: number;
  players: { name: string; team: string }[];
  winner: PlayerId | null;
  ticks: ReplayTick[];
  /** Rule variants in play (absent in old replays = no variants). */
  rules?: Rules;
  tickMs?: number;
}

export function replayInitial(r: Replay): GameState {
  const s = generateMap(r.seed, r.playerCount, r.rules ?? { showers: false });
  r.players.forEach((p, i) => {
    if (s.players[i]) s.players[i].team = p.team;
  });
  return s;
}

/** Apply one recorded tick, in the same order the live session does. */
export function applyReplayTick(state: GameState, t: ReplayTick): GameState {
  let s = state;
  for (const p of t.s ?? []) s = surrender(s, p);
  const moves = new Map<PlayerId, Move>();
  for (const [p, from, d, half] of t.m) moves.set(p, { from, dir: DIRS[d], half: half === 1 });
  return step(s, moves);
}
