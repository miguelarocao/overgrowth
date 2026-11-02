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
});
