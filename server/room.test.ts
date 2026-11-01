import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../shared/protocol';
import { decodeTile } from '../shared/protocol';
import { visibilityFor } from '../shared/view';
import { Room, type Conn } from './room';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) { this.msgs.push(JSON.parse(JSON.stringify(m))); }
  last<T extends ServerMsg['t']>(t: T) { return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined; }
  all<T extends ServerMsg['t']>(t: T) { return this.msgs.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
}

function setup() {
  let now = 1000;
  const clock = { advance: (ms: number) => (now += ms) };
  let ticking = false;
  const room = new Room('abc', {
    now: () => now, random: () => 0.25,
    startTicking: () => (ticking = true), stopTicking: () => (ticking = false),
    saveReplay: (r) => r.id
  });
  return { room, clock, isTicking: () => ticking };
}

describe('room lobby', () => {
  it('first joiner hosts; players get distinct teams; only host starts', () => {
    const { room, isTicking } = setup();
    const a = new FakeConn(), b = new FakeConn();
    room.join(a, 'Ana');
    room.join(b, 'Ben');
    const lobby = b.last('lobby')!;
    expect(lobby.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(new Set(lobby.players.map((p) => p.team)).size).toBe(2);
    expect(lobby.host).toBe(lobby.players[0].seat);
    room.handle(b, { t: 'start' });
    expect(room.phase).toBe('lobby');
    room.handle(a, { t: 'start' });
    expect(room.phase).toBe('playing');
    expect(isTicking()).toBe(true);
  });

  it('team picks must be free', () => {
    const { room } = setup();
    const a = new FakeConn(), b = new FakeConn();
    room.join(a, 'A');
    room.join(b, 'B');
    const teamA = a.last('lobby')!.players[0].team;
    room.handle(b, { t: 'pickTeam', team: teamA });
    expect(b.last('lobby')!.players[1].team).not.toBe(teamA);
    room.handle(b, { t: 'pickTeam', team: 'daisy' });
    expect(b.last('lobby')!.players[1].team).toBe('daisy');
  });

  it('host can fill seats with bots', () => {
    const { room } = setup();
    const a = new FakeConn();
    room.join(a, 'A');
    room.handle(a, { t: 'addBot' });
    room.handle(a, { t: 'addBot' });
    expect(a.last('lobby')!.players.filter((p) => p.bot).length).toBe(2);
    room.handle(a, { t: 'removeBot', seat: a.last('lobby')!.players[1].seat });
    expect(a.last('lobby')!.players.length).toBe(2);
  });
});

describe('room game', () => {
  function started() {
    const s = setup();
    const a = new FakeConn(), b = new FakeConn();
    s.room.join(a, 'A');
    s.room.join(b, 'B');
    s.room.handle(a, { t: 'addBot' });
    s.room.handle(a, { t: 'start' });
    return { ...s, a, b };
  }

  it('never sends hidden tile contents', () => {
    const { room, a } = started();
    for (let i = 0; i < 30; i++) room.tick();
    const state = room.session!.state;
    const vis = visibilityFor(state, 0);
    // Rebuild what client A knows from the deltas.
    const known = new Map<number, ReturnType<typeof decodeTile>>();
    for (const t of a.all('tick')) for (const d of t.changedTiles) known.set(d[0], decodeTile(d));
    for (const [i, t] of known) {
      if (!vis[i]) {
        expect(t.visible).toBe(false);
        expect(t.owner).toBe(null);
        expect(t.stems).toBe(0);
        expect(t.isMother).toBe(false);
      }
    }
    expect(a.last('started')!.terrain.length).toBe(state.tiles.length);
  });

  it('keeps each queue private and acks client seqs', () => {
    const { room, a, b } = started();
    const state = room.session!.state;
    const mother = state.tiles.findIndex((t) => t.isMother && t.owner === 0);
    room.handle(a, { t: 'queue', seq: 3, moves: [{ id: 1, from: mother, dir: 'up', half: false }, { id: 2, from: mother, dir: 'left', half: true }] });
    room.handle(a, { t: 'undo', seq: 4 });
    room.tick();
    const ta = a.last('tick')!, tb = b.last('tick')!;
    expect(ta.ack).toBe(4);
    expect(tb.queue).toEqual([]);
    expect(tb.dropped).toEqual([]);
    // A's only remaining step (from a 1-stem mother) was invalid and dropped; B never hears about it.
    expect(ta.dropped).toEqual([1]);
  });

  it('reconnects with the token and resends the full view', () => {
    const { room, a } = started();
    room.tick();
    const token = a.last('welcome')!.token;
    room.disconnect(a);
    const a2 = new FakeConn();
    room.join(a2, 'A', token);
    expect(a2.last('started')!.you).toBe(0);
    expect(a2.last('tick')!.changedTiles.length).toBe(room.session!.state.tiles.length);
  });

  it('treats a player disconnected for more than 60 s as surrendered', () => {
    const { room, b, clock } = started();
    room.disconnect(b);
    clock.advance(59_000);
    room.housekeeping();
    room.tick();
    expect(room.session!.state.players[1].alive).toBe(true);
    clock.advance(2_000);
    room.housekeeping();
    room.tick();
    expect(room.session!.state.players[1].alive).toBe(false);
  });

  it('spectators joining mid-game get the full view; game over sends replay id', () => {
    const { room, a, b } = started();
    const spec = new FakeConn();
    room.join(spec, 'S');
    expect(spec.last('started')!.you).toBe(null);
    expect(spec.last('tick')!.full).toBe(true);
    room.handle(b, { t: 'surrender' });
    room.tick();
    room.handle(a, { t: 'surrender' });
    room.tick();
    expect(room.phase).toBe('over');
    expect(a.last('gameOver')!.replayId).toBeTruthy();
    expect(a.last('gameOver')!.winner).toBe(2); // the bot
    room.handle(a, { t: 'backToLobby' });
    expect(room.phase).toBe('lobby');
  });
});

describe('reconnect races', () => {
  it("a reload whose old socket is still open takes its seat back; another tab's token gets a new seat", () => {
    let now = 0;
    const room = new Room('r', { now: () => now, random: () => 0.5, startTicking() {}, stopTicking() {} });
    const a = new FakeConn();
    room.join(a, 'A');
    const token = a.last('welcome')!.token;
    const other = new FakeConn();
    room.join(other, 'B', token, false);
    expect(other.last('welcome')!.token).not.toBe(token);
    const reloaded = new FakeConn();
    room.join(reloaded, 'A', token, true);
    expect(reloaded.last('welcome')!.token).toBe(token);
    expect(room.seats.length).toBe(2);
    room.disconnect(a); // late close of the old socket must not knock the new one off
    expect(room.seats.find((s) => s.token === token)!.conn).toBe(reloaded);
  });
});
