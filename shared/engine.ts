import { CORE_GROWTH_TICKS, LAND_GROWTH_TICKS } from './config';
import { neighbor } from './grid';
import type { GameState, Move, MoveOutcome, PlayerId, Tile } from './types';
import { inShower, showerAt } from './weather';

export interface Elimination {
  player: PlayerId;
  by: PlayerId;
}

export interface StepResult {
  state: GameState;
  /** What happened to each submitted move: ok, failed (attack too small) or invalid. */
  outcomes: Map<PlayerId, MoveOutcome>;
  eliminations: Elimination[];
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    tiles: s.tiles.map((t) => ({ ...t })),
    players: s.players.map((p) => ({ ...p })),
    buildings: s.buildings // never changes after generation
  };
}

/** Destination index of a move, or -1 if it leaves the board. */
export function moveDest(state: Pick<GameState, 'width' | 'height'>, move: Move): number {
  return neighbor(move.from, move.dir, state.width, state.height);
}

/** Stems a move would send from a tile holding `stems`. */
export function sendAmount(stems: number, half: boolean): number {
  return half ? Math.floor(stems / 2) : stems - 1;
}

/** Could this move execute right now? (Does not say whether an attack would win.) */
export function isMoveValid(state: GameState, player: PlayerId, move: Move): boolean {
  if (!state.players[player]?.alive) return false;
  if (!Number.isInteger(move.from) || move.from < 0 || move.from >= state.tiles.length) return false;
  const src = state.tiles[move.from];
  if (src.owner !== player || src.stems < 2) return false;
  const to = moveDest(state, move);
  if (to < 0 || state.tiles[to].kind === 'building') return false;
  return sendAmount(src.stems, move.half) >= 1;
}

/**
 * The order moves resolve within a tick, following generals.io:
 *   1. moves onto your own land first (reinforcements land before attacks),
 *   2. moves onto a mother plant last (last-second defence counts),
 *   3. otherwise larger armies before smaller ones,
 *   4. ties in seat order, reversed every other tick, so between any two players
 *      priority alternates every move (a chaser always catches up within two moves).
 * Classified on the board as it stood at the start of the tick. Deterministic.
 */
export function moveOrder(state: GameState, moves: ReadonlyMap<PlayerId, Move | null>, tick: number): PlayerId[] {
  const keyed: { pid: PlayerId; group: number; army: number }[] = [];
  for (const [pid, move] of moves) {
    if (!move) continue;
    const src = state.tiles[move.from];
    const to = moveDest(state, move);
    const dst = to >= 0 ? state.tiles[to] : undefined;
    const group = dst && dst.owner === pid ? 0 : dst && dst.isMother ? 2 : 1;
    const army = src && src.owner === pid ? sendAmount(src.stems, move.half) : 0;
    keyed.push({ pid, group, army });
  }
  const reversed = tick % 2 === 1;
  keyed.sort((a, b) => a.group - b.group || b.army - a.army || (reversed ? b.pid - a.pid : a.pid - b.pid));
  return keyed.map((k) => k.pid);
}

function eliminate(state: GameState, victim: PlayerId, by: PlayerId) {
  state.players[victim].alive = false;
  for (const t of state.tiles) {
    if (t.owner === victim) {
      t.owner = by;
      t.stems = Math.floor(t.stems / 2);
      t.isMother = false;
    }
  }
}

function applyMove(state: GameState, player: PlayerId, move: Move, elims: Elimination[]): MoveOutcome {
  if (!isMoveValid(state, player, move)) return 'invalid';
  const src = state.tiles[move.from];
  const dst: Tile = state.tiles[moveDest(state, move)];
  const send = sendAmount(src.stems, move.half);
  src.stems -= send;
  if (dst.owner === player) {
    dst.stems += send;
    return 'ok';
  }
  if (send > dst.stems) {
    const prevOwner = dst.owner;
    const wasMother = dst.isMother;
    dst.owner = player;
    dst.stems = send - dst.stems;
    if (wasMother && prevOwner !== null) {
      // The captured mother plant becomes a water tile owned by the capturer.
      dst.isMother = false;
      dst.kind = 'water';
      eliminate(state, prevOwner, player);
      elims.push({ player: prevOwner, by: player });
    }
    return 'ok';
  }
  // Defender holds with the difference (0 on a tie).
  dst.stems -= send;
  return 'failed';
}

function grow(state: GameState) {
  const core = state.tick % CORE_GROWTH_TICKS === 0;
  const land = state.tick % LAND_GROWTH_TICKS === 0;
  const rain = core ? showerAt(state, state.tick) : null;
  if (!core && !land) return;
  state.tiles.forEach((t, i) => {
    if (t.owner === null || !state.players[t.owner].alive) return;
    if (core && (t.isMother || t.kind === 'water')) t.stems += 1;
    else if (rain && inShower(rain, i, state.width)) t.stems += 1;
    if (land) t.stems += 1;
  });
}

/**
 * Advance one tick. Moves are applied one at a time in rotating priority order,
 * then growth is applied. Pure: the input state is not modified.
 */
export function stepDetailed(prev: GameState, moves: ReadonlyMap<PlayerId, Move | null>): StepResult {
  const state = cloneState(prev);
  state.tick = prev.tick + 1;
  const outcomes = new Map<PlayerId, MoveOutcome>();
  const eliminations: Elimination[] = [];
  for (const pid of moveOrder(prev, moves, state.tick)) {
    const move = moves.get(pid);
    if (!move) continue;
    outcomes.set(pid, applyMove(state, pid, move, eliminations));
  }
  grow(state);
  return { state, outcomes, eliminations };
}

export function step(state: GameState, moves: ReadonlyMap<PlayerId, Move | null>): GameState {
  return stepDetailed(state, moves).state;
}

/**
 * A player gives up. Their tiles turn neutral and keep their stems; their mother
 * plant becomes a neutral water tile. Pure.
 */
export function surrender(prev: GameState, player: PlayerId): GameState {
  if (!prev.players[player]?.alive) return prev;
  const state = cloneState(prev);
  state.players[player].alive = false;
  for (const t of state.tiles) {
    if (t.owner !== player) continue;
    t.owner = null;
    if (t.isMother) {
      t.isMother = false;
      t.kind = 'water';
    }
  }
  return state;
}

export function alivePlayers(state: GameState): PlayerId[] {
  return state.players.filter((p) => p.alive).map((p) => p.id);
}

export type EndReason = 'conquest' | 'time';

export interface GameResult {
  over: boolean;
  winner: PlayerId | null;
  /** Why it ended: the last mother plant standing, or the time limit. null while playing. */
  reason: EndReason | null;
}

/**
 * The game ends when at most one player is left, or when the time limit (if any) runs out.
 * On time, the biggest garden by land wins, then by stems; a tie on both is a draw (null).
 */
export function gameResult(state: GameState): GameResult {
  const alive = alivePlayers(state);
  if (alive.length <= 1) return { over: true, winner: alive.length === 1 ? alive[0] : null, reason: 'conquest' };
  const limit = state.rules?.timeLimitTicks ?? 0;
  if (limit <= 0 || state.tick < limit) return { over: false, winner: null, reason: null };
  return { over: true, winner: leader(state, alive), reason: 'time' };
}

/** The alive player with the most land, then most stems; null if the top two tie on both. */
export function leader(state: GameState, alive = alivePlayers(state)): PlayerId | null {
  const st = playerStats(state);
  const ranked = [...alive].sort((a, b) => st[b].land - st[a].land || st[b].stems - st[a].stems);
  const [a, b] = ranked;
  if (b !== undefined && st[a].land === st[b].land && st[a].stems === st[b].stems) return null;
  return a ?? null;
}

export interface PlayerStats {
  stems: number;
  land: number;
}

export function playerStats(state: GameState): PlayerStats[] {
  const out = state.players.map(() => ({ stems: 0, land: 0 }));
  for (const t of state.tiles) {
    if (t.owner === null) continue;
    out[t.owner].stems += t.stems;
    out[t.owner].land += 1;
  }
  return out;
}

/** FNV-1a hash of the full game state, for determinism checks. */
export function hashState(state: GameState): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  mix(state.tick);
  for (const t of state.tiles) {
    mix(t.owner === null ? -1 : t.owner);
    mix(t.stems);
    mix((t.isMother ? 1 : 0) | (['plain', 'street', 'building', 'water'].indexOf(t.kind) << 1));
  }
  for (const p of state.players) mix(p.alive ? 1 : 0);
  return (h >>> 0).toString(16).padStart(8, '0');
}
