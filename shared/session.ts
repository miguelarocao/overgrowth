import { MAX_QUEUE } from './config';
import { gameResult, isMoveValid, moveDest, stepDetailed, surrender, type Elimination } from './engine';
import type { GameState, Move, PlayerId, QueuedMove } from './types';
import { DIRS } from './types';
import type { Replay, ReplayTick } from './replay';

export interface TickReport {
  tick: number;
  /** Id of the queued step each player executed successfully this tick. */
  executed: Map<PlayerId, number>;
  /** Ids of queued steps dropped this tick (failed attack, lost source, too few stems) per player. */
  dropped: Map<PlayerId, number[]>;
  eliminations: Elimination[];
  surrendered: PlayerId[];
  over: boolean;
  winner: PlayerId | null;
}

/**
 * Remove every step that continues the path of `failed` (its `from` is the
 * failed step's destination, transitively). Steps for other stacks stay.
 */
export function dropContinuation(state: Pick<GameState, 'width' | 'height'>, queue: QueuedMove[], failed: Move): number[] {
  const dead = new Set<number>([moveDest(state, failed)]);
  const removed: number[] = [];
  for (let j = 0; j < queue.length; ) {
    const m = queue[j];
    if (dead.has(m.from)) {
      removed.push(m.id);
      dead.add(moveDest(state, m));
      queue.splice(j, 1);
    } else j++;
  }
  return removed;
}

export function isWellFormedMove(m: unknown, tileCount: number): m is QueuedMove {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    Number.isInteger(o.from) && (o.from as number) >= 0 && (o.from as number) < tileCount &&
    typeof o.dir === 'string' && (DIRS as readonly string[]).includes(o.dir) &&
    typeof o.half === 'boolean' && Number.isInteger(o.id)
  );
}

/**
 * A running game: engine state plus each player's private move queue.
 * The server holds one per room; offline play and tests use it directly.
 * Deterministic given the same sequence of calls.
 */
export class GameSession {
  state: GameState;
  readonly initial: GameState;
  readonly queues: QueuedMove[][];
  readonly log: ReplayTick[] = [];
  private pendingSurrender: PlayerId[] = [];

  constructor(state: GameState) {
    this.state = state;
    this.initial = state;
    this.queues = state.players.map(() => []);
  }

  get over() {
    return gameResult(this.state).over;
  }

  /** Append steps to a player's queue. Malformed steps and steps into buildings or off the board are ignored. */
  enqueue(player: PlayerId, moves: readonly QueuedMove[]) {
    const q = this.queues[player];
    if (!q || !this.state.players[player].alive) return;
    for (const m of moves) {
      if (q.length >= MAX_QUEUE) break;
      if (!isWellFormedMove(m, this.state.tiles.length)) continue;
      const to = moveDest(this.state, m);
      if (to < 0 || this.state.tiles[to].kind === 'building') continue;
      q.push({ id: m.id, from: m.from, dir: m.dir, half: m.half });
    }
  }

  undo(player: PlayerId): QueuedMove | undefined {
    return this.queues[player]?.pop();
  }

  clear(player: PlayerId) {
    if (this.queues[player]) this.queues[player].length = 0;
  }

  surrender(player: PlayerId) {
    if (this.state.players[player]?.alive && !this.pendingSurrender.includes(player)) this.pendingSurrender.push(player);
  }

  /** Run one tick: surrenders, then one queued step per player, then growth. */
  advance(): TickReport {
    const executed = new Map<PlayerId, number>();
    const dropped = new Map<PlayerId, number[]>();
    const addDropped = (p: PlayerId, ids: number[]) => dropped.set(p, [...(dropped.get(p) ?? []), ...ids]);

    const surrendered = this.pendingSurrender.filter((p) => this.state.players[p].alive);
    this.pendingSurrender = [];
    for (const p of surrendered) {
      this.state = surrender(this.state, p);
      this.queues[p].length = 0;
    }

    // Pop each player's next valid step; invalid ones are dropped with their path.
    const moves = new Map<PlayerId, Move>();
    const chosen = new Map<PlayerId, QueuedMove>();
    for (const p of this.state.players) {
      if (!p.alive) continue;
      const q = this.queues[p.id];
      while (q.length) {
        const m = q.shift()!;
        if (isMoveValid(this.state, p.id, m)) {
          moves.set(p.id, m);
          chosen.set(p.id, m);
          break;
        }
        addDropped(p.id, [m.id, ...dropContinuation(this.state, q, m)]);
      }
    }

    const before = this.state;
    const res = stepDetailed(this.state, moves);
    this.state = res.state;
    for (const [pid, m] of chosen) {
      if (res.outcomes.get(pid) === 'ok') executed.set(pid, m.id);
      else addDropped(pid, [m.id, ...dropContinuation(before, this.queues[pid], m)]);
    }
    for (const e of res.eliminations) this.queues[e.player].length = 0;

    const rec: ReplayTick = { m: [...moves].map(([p, m]) => [p, m.from, DIRS.indexOf(m.dir), m.half ? 1 : 0]) };
    if (surrendered.length) rec.s = surrendered;
    this.log.push(rec);

    const { over, winner } = gameResult(this.state);
    return { tick: this.state.tick, executed, dropped, eliminations: res.eliminations, surrendered, over, winner };
  }

  toReplay(id: string, players: { name: string; team: string }[], winner: PlayerId | null, tickMs?: number): Replay {
    return {
      rules: this.initial.rules,
      tickMs,
      version: 1,
      id,
      seed: this.initial.seed,
      playerCount: this.initial.players.length,
      players,
      winner,
      ticks: this.log
    };
  }
}
