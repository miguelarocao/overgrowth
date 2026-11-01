import { describe, expect, it } from 'vitest';
import { step } from './engine';
import { makeState } from './testutil';
import { FIRST_SHOWER_TICK, forecastAt, inShower, showerAt, SHOWER_TICKS } from './weather';
import { generateMap } from './mapgen';
import { computeAwards } from './awards';
import { runBotGame } from '../bots/headless';

describe('spring showers', () => {
  const s = generateMap(12, 2, { showers: true });

  it('is off unless the rule is on', () => {
    const off = generateMap(12, 2, { showers: false });
    expect(showerAt(off, FIRST_SHOWER_TICK + 1)).toBe(null);
    expect(forecastAt(off, FIRST_SHOWER_TICK - 5)).toBe(null);
  });

  it('is forecast, then rains for a fixed window inside the board, deterministically', () => {
    expect(showerAt(s, FIRST_SHOWER_TICK - 1)).toBe(null);
    const f = forecastAt(s, FIRST_SHOWER_TICK - 10)!;
    const r = showerAt(s, FIRST_SHOWER_TICK)!;
    expect(f).toEqual(r);
    expect(showerAt(s, FIRST_SHOWER_TICK + SHOWER_TICKS)).toBe(null);
    expect(r.x + r.size).toBeLessThanOrEqual(s.width);
    expect(showerAt(generateMap(12, 2, { showers: true }), FIRST_SHOWER_TICK)).toEqual(r);
  });

  it('owned land under the cloud grows every turn; outside it does not', () => {
    let st = makeState(Array.from({ length: 20 }, () => '0'.repeat(20)), 1, {});
    st.rules = { showers: true };
    st.seed = 12;
    st.tick = FIRST_SHOWER_TICK - 1;
    const sh = showerAt(st, FIRST_SHOWER_TICK + 1)!;
    const inside = sh.y * 20 + sh.x;
    const outside = inside === 0 ? 399 : 0;
    st = step(step(st, new Map()), new Map()); // ticks 100 (also a land-growth tick), 101
    expect(st.tiles[inside].stems).toBe(3);
    expect(st.tiles[outside].stems).toBe(2);
    expect(inShower(sh, inside, 20)).toBe(true);
  });
});

describe('awards', () => {
  it('hands out superlatives from a replay', () => {
    const g = runBotGame(5, 3, 3000);
    const rep = g.session.toReplay('x', g.session.initial.players.map((p) => ({ name: 'p', team: p.team })), g.winner);
    const awards = computeAwards(rep);
    expect(awards.length).toBeGreaterThan(1);
    expect(awards.find((a) => a.title === 'Rampant Grower')).toBeTruthy();
    for (const a of awards) expect(a.player).toBeLessThan(3);
  }, 30_000);
});
