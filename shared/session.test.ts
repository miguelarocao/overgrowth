import { describe, expect, it } from 'vitest';
import { GameSession } from './session';
import { makeState } from './testutil';
import type { QueuedMove } from './types';

const q = (id: number, from: number, dir: QueuedMove['dir'], half = false): QueuedMove => ({ id, from, dir, half });

describe('move queue', () => {
  it('executes one step per tick, leaving 1 behind each step (30 -> 29, 28, 27)', () => {
    // 5 wide, 2 tall; the stack sits at index 0.
    const s = makeState(['A....', '.....'], 1, { 0: 30 });
    s.tick = 2; // keep growth out of the way for 3 ticks (ticks 3, 4 would grow mother; check land counts)
    const g = new GameSession(s);
    g.enqueue(0, [q(1, 0, 'right'), q(2, 1, 'right'), q(3, 2, 'down')]);
    let r = g.advance();
    expect(r.executed.get(0)).toBe(1);
    expect(g.state.tiles[1].stems).toBe(29);
    r = g.advance();
    expect(g.state.tiles[1].stems).toBe(1);
    expect(g.state.tiles[2].stems).toBe(28);
    r = g.advance();
    expect(g.state.tiles[7].stems).toBe(27);
    expect(r.executed.get(0)).toBe(3);
    expect(g.queues[0]).toEqual([]);
  });

  it('a failed step drops the rest of its path but keeps other stacks', () => {
    // Player 0 stack of 5 at index 0 attacks neutral water (40). Another stack at index 5 queued after.
    const s = makeState(['A~...', '0....'], 1, { 0: 5, 1: 40, 5: 6 });
    const g = new GameSession(s);
    g.enqueue(0, [q(1, 0, 'right'), q(2, 1, 'right'), q(3, 2, 'right'), q(4, 5, 'right')]);
    const r = g.advance();
    expect(r.executed.has(0)).toBe(false);
    expect(r.dropped.get(0)).toEqual([1, 2, 3]);
    expect(g.queues[0].map((m) => m.id)).toEqual([4]);
    const r2 = g.advance();
    expect(r2.executed.get(0)).toBe(4);
  });

  it('skips invalid steps (source lost or < 2 stems) and runs the next valid one the same tick', () => {
    const s = makeState(['A....', '0....'], 1, { 0: 1, 5: 6 });
    const g = new GameSession(s);
    g.enqueue(0, [q(1, 0, 'right'), q(2, 1, 'right'), q(3, 5, 'right')]);
    const r = g.advance();
    expect(r.dropped.get(0)).toEqual([1, 2]);
    expect(r.executed.get(0)).toBe(3);
  });

  it('ignores steps into buildings or off the board when queueing', () => {
    const s = makeState(['A#'], 1, { 0: 5 });
    const g = new GameSession(s);
    g.enqueue(0, [q(1, 0, 'right'), q(2, 0, 'up'), q(3, 0, 'down')]);
    expect(g.queues[0]).toEqual([]);
  });

  it('undo removes the last step, clear empties the queue', () => {
    const s = makeState(['A....'], 1, { 0: 5 });
    const g = new GameSession(s);
    g.enqueue(0, [q(1, 0, 'right'), q(2, 1, 'right')]);
    expect(g.undo(0)?.id).toBe(2);
    expect(g.queues[0].length).toBe(1);
    g.clear(0);
    expect(g.queues[0].length).toBe(0);
  });

  it('surrender is applied at the start of the next tick and ends the game', () => {
    const s = makeState(['A...B'], 2);
    const g = new GameSession(s);
    g.surrender(1);
    const r = g.advance();
    expect(r.surrendered).toEqual([1]);
    expect(r.over).toBe(true);
    expect(r.winner).toBe(0);
  });
});
