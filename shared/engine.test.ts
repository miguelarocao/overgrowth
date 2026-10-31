import { describe, expect, it } from 'vitest';
import { gameResult, hashState, isMoveValid, priorityOrder, step, stepDetailed, surrender } from './engine';
import type { Move } from './types';
import { makeState } from './testutil';

const mv = (from: number, dir: Move['dir'], half = false): Move => ({ from, dir, half });
const one = (p: number, m: Move) => new Map([[p, m]]);

describe('moving and combat', () => {
  it('sends all but one onto an empty tile and captures it', () => {
    const s = makeState(['0.'], 1, { 0: 10 });
    s.tick = 2; // next tick 3: no growth
    const n = step(s, one(0, mv(0, 'right')));
    expect(n.tiles[0]).toMatchObject({ owner: 0, stems: 1 });
    expect(n.tiles[1]).toMatchObject({ owner: 0, stems: 9 });
    expect(s.tiles[1].owner).toBe(null); // input not mutated
  });

  it('half mode sends half, rounded down', () => {
    const s = makeState(['0.'], 1, { 0: 11 });
    s.tick = 2;
    const n = step(s, one(0, mv(0, 'right', true)));
    expect(n.tiles[0].stems).toBe(6);
    expect(n.tiles[1].stems).toBe(5);
  });

  it('merges onto your own tile', () => {
    const s = makeState(['00'], 1, { 0: 5, 1: 3 });
    s.tick = 2;
    const n = step(s, one(0, mv(0, 'right')));
    expect(n.tiles[1].stems).toBe(7);
  });

  it('defender holds on a tie with 0 stems', () => {
    const s = makeState(['01'], 2, { 0: 6, 1: 5 });
    s.tick = 2;
    const r = stepDetailed(s, one(0, mv(0, 'right')));
    expect(r.state.tiles[1]).toMatchObject({ owner: 1, stems: 0 });
    expect(r.outcomes.get(0)).toBe('failed');
  });

  it('defender keeps the difference when stronger', () => {
    const s = makeState(['0~'], 1, { 0: 20, 1: 45 });
    s.tick = 2;
    const n = step(s, one(0, mv(0, 'right')));
    expect(n.tiles[1]).toMatchObject({ owner: null, stems: 26 });
  });

  it('attacker captures with the remainder', () => {
    const s = makeState(['0~'], 1, { 0: 50, 1: 45 });
    s.tick = 2;
    const n = step(s, one(0, mv(0, 'right')));
    expect(n.tiles[1]).toMatchObject({ owner: 0, stems: 4, kind: 'water' });
  });

  it('rejects moves into buildings, off the board, from foreign tiles or with < 2 stems', () => {
    const s = makeState(['0#', '1.'], 2, { 0: 5, 2: 1 });
    expect(isMoveValid(s, 0, mv(0, 'right'))).toBe(false);
    expect(isMoveValid(s, 0, mv(0, 'up'))).toBe(false);
    expect(isMoveValid(s, 0, mv(2, 'right'))).toBe(false);
    expect(isMoveValid(s, 1, mv(2, 'right'))).toBe(false);
    expect(isMoveValid(s, 0, mv(0, 'down'))).toBe(true);
    expect(stepDetailed(s, one(0, mv(0, 'right'))).outcomes.get(0)).toBe('invalid');
  });

  it('applies moves one at a time in rotating priority order', () => {
    expect(priorityOrder(3, 0)).toEqual([0, 1, 2]);
    expect(priorityOrder(3, 1)).toEqual([1, 2, 0]);
    // Both players attack the same neutral tile; whoever goes first takes it, the other attacks them.
    const s = makeState(['0.1'], 2, { 0: 10, 2: 10 });
    s.tick = 2; // stepping to tick 3: order [1, 0]
    const moves = new Map([[0, mv(0, 'right')], [1, mv(2, 'left')]]);
    const n = step(s, moves);
    // Player 1 moves first: captures with 9. Player 0 then attacks with 9 => tie, player 1 holds with 0.
    expect(n.tiles[1]).toMatchObject({ owner: 1, stems: 0 });
    s.tick = 3; // stepping to tick 4: order [0, 1]
    const n2 = step(s, moves);
    expect(n2.tiles[1]).toMatchObject({ owner: 0, stems: 0 });
  });
});

describe('growth', () => {
  it('mothers and owned water grow every turn (2 ticks), land every 25 turns', () => {
    let s = makeState(['A0~2'], 3, { 0: 1, 1: 1, 2: 40, 3: 1 });
    s.tiles[2].owner = 1; // owned water
    s.tick = 0;
    const none = new Map();
    s = step(s, none); // tick 1
    expect(s.tiles[0].stems).toBe(1);
    s = step(s, none); // tick 2: turn boundary
    expect(s.tiles[0].stems).toBe(2);
    expect(s.tiles[2].stems).toBe(41);
    expect(s.tiles[1].stems).toBe(1);
    for (let i = 0; i < 48; i++) s = step(s, none); // tick 50 = 25 turns
    expect(s.tick).toBe(50);
    expect(s.tiles[1].stems).toBe(2); // land +1
    expect(s.tiles[0].stems).toBe(1 + 25 + 1);
    expect(s.tiles[3].stems).toBe(2);
  });

  it('neutral water does not grow', () => {
    let s = makeState(['A~'], 1, { 1: 40 });
    s.tick = 0;
    for (let i = 0; i < 50; i++) s = step(s, new Map());
    expect(s.tiles[1].stems).toBe(40);
  });
});

describe('capture and elimination', () => {
  it('capturing a mother eliminates its owner, halves their land and turns the mother into water', () => {
    const s = makeState(['0B11'], 2, { 0: 30, 1: 10, 2: 9, 3: 4 });
    s.tick = 2;
    const r = stepDetailed(s, one(0, mv(0, 'right')));
    expect(r.eliminations).toEqual([{ player: 1, by: 0 }]);
    expect(r.state.players[1].alive).toBe(false);
    expect(r.state.tiles[1]).toMatchObject({ owner: 0, stems: 19, kind: 'water', isMother: false });
    expect(r.state.tiles[2]).toMatchObject({ owner: 0, stems: 4 });
    expect(r.state.tiles[3]).toMatchObject({ owner: 0, stems: 2 });
    expect(gameResult(r.state)).toEqual({ over: true, winner: 0 });
  });

  it('surrender turns land neutral and the mother into neutral water', () => {
    const s = makeState(['A.B1'], 2, { 0: 5, 2: 12, 3: 7 });
    const n = surrender(s, 1);
    expect(n.players[1].alive).toBe(false);
    expect(n.tiles[2]).toMatchObject({ owner: null, kind: 'water', stems: 12, isMother: false });
    expect(n.tiles[3]).toMatchObject({ owner: null, stems: 7 });
    expect(gameResult(n).winner).toBe(0);
  });

  it('eliminated players cannot move', () => {
    const s = makeState(['A.1'], 2, { 2: 5 });
    s.players[1].alive = false;
    expect(isMoveValid(s, 1, mv(2, 'left'))).toBe(false);
  });
});

describe('hashState', () => {
  it('differs when state differs', () => {
    const s = makeState(['0.'], 1, { 0: 3 });
    const n = step(s, one(0, mv(0, 'right')));
    expect(hashState(s)).not.toBe(hashState(n));
    expect(hashState(n)).toBe(hashState(step(s, one(0, mv(0, 'right')))));
  });
});
