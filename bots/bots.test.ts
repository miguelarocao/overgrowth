import { describe, expect, it } from 'vitest';
import { hashState } from '../shared/engine';
import { applyReplayTick, replayInitial } from '../shared/replay';
import { runBotGame } from './headless';

describe('determinism', () => {
  it('same seed and inputs produce an identical state hash', () => {
    const a = runBotGame(7, 3, 800);
    const b = runBotGame(7, 3, 800);
    expect(a.hash).toBe(b.hash);
    expect(a.ticks).toBe(b.ticks);
  });

  it('a replay re-runs the engine to the exact same final state', () => {
    const r = runBotGame(99, 4, 1500);
    const rep = r.session.toReplay('t', r.session.initial.players.map((p) => ({ name: 'p' + p.id, team: p.team })), r.winner);
    let s = replayInitial(rep);
    for (const t of rep.ticks) s = applyReplayTick(s, t);
    expect(hashState(s)).toBe(r.hash);
  });
});

describe('headless bot games', () => {
  it('a batch of bot games runs without crashing and ends', () => {
    let finished = 0;
    for (let g = 0; g < 12; g++) {
      const r = runBotGame(300 + g, 2 + (g % 3), 6000);
      if (r.finished) finished++;
      expect(r.ticks).toBeGreaterThan(0);
    }
    expect(finished).toBe(12);
  }, 60_000);
});
