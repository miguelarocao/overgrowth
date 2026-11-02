import { describe, expect, it } from 'vitest';
import { ClientGame } from './game';

describe('ClientGame', () => {
  it('remembers hydrants it has seen after they go back into the fog', () => {
    const g = new ClientGame({ t: 'started', width: 2, height: 1, terrain: [0, 0], buildings: [], fountain: -1, you: 0, players: [], tickMs: 500, tick: 0, rules: { showers: false } }, () => {});
    const tick = (changedTiles: any[]) => ({ t: 'tick' as const, tick: 1, changedTiles, players: [], queue: [], ack: 0, executed: null, dropped: [], full: false, weather: { now: null, next: null } });
    g.applyTick(tick([[1, 3, -1, 45, 0, 1]])); // visible water
    expect(g.tiles[1].kind).toBe('water');
    g.applyTick(tick([[1, 0, -1, 0, 0, 0]])); // hidden: the server reports plain ground
    expect(g.tiles[1].kind).toBe('water');
    expect(g.tiles[0].kind).toBe('plain');
  });

  it('Space / Tab cycles through your biggest stacks, then wraps', () => {
    const players = [{ id: 0, name: 'A', team: 'glory', alive: true, connected: true, bot: false, stems: 0, land: 0 }];
    const g = new ClientGame({ t: 'started', width: 8, height: 1, terrain: new Array(8).fill(0), buildings: [], fountain: -1, you: 0, players, tickMs: 500, tick: 0, rules: { showers: false } }, () => {});
    // Tile i holds stems[i] for player 0; tile 7 belongs to nobody. Tile 6 has 1 stem (can't move).
    const stems = [9, 3, 20, 7, 5, 12, 1, 50];
    g.applyTick({ t: 'tick', tick: 1, players, queue: [], ack: 0, executed: null, dropped: [], full: false, weather: { now: null, next: null },
      changedTiles: stems.map((n, i) => [i, 0, i === 7 ? -1 : 0, n, 0, 1] as any) });
    const order = Array.from({ length: 6 }, () => g.cycleStacks());
    expect(order).toEqual([2, 5, 0, 3, 4, 2]); // top 5, biggest first, then back to the top
    expect(g.cycleStacks(true)).toBe(4); // Shift goes back
    g.select(1); // picking something else by hand restarts from the biggest
    expect(g.cycleStacks()).toBe(2);
  });
});
