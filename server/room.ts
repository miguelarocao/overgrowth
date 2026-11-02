// Room logic: lobby, seats, bots, the authoritative game session and what each
// client is allowed to see. Pure TypeScript with no Node APIs, so the same code
// runs on the server and in the browser for offline play. Clocks, timers and
// randomness are injected through RoomHooks; the engine itself stays pure.
import { Bot } from '../bots/bot';
import { DISCONNECT_GRACE_MS, EMOTES, MAX_PLAYERS, MIN_PLAYERS, PACES, type Pace } from '../shared/config';
import { computeAwards, type Award } from '../shared/awards';
import { forecastAt, showerAt } from '../shared/weather';
import { playerStats } from '../shared/engine';
import { generateMap } from '../shared/mapgen';
import { diffView, kindCode, type ClientMsg, type LobbyPlayer, type PlayerInfo, type RoomOptions, type ServerMsg } from '../shared/protocol';
import type { Replay } from '../shared/replay';
import { GameSession, isWellFormedMove, type TickReport } from '../shared/session';
import { TEAMS, TEAM_BY_KEY } from '../shared/teams';
import type { PlayerId, ViewTile } from '../shared/types';
import { fogKind, viewFor } from '../shared/view';

export interface Conn {
  send(msg: ServerMsg): void;
}

export interface RoomHooks {
  now(): number;
  random(): number;
  startTicking(intervalMs: number): void;
  stopTicking(): void;
  /** Persist a finished game's replay; returns its id (or null if not stored). */
  saveReplay?(replay: Replay): string | null;
}

interface Seat {
  seat: number;
  name: string;
  team: string;
  bot: Bot | null;
  isBot: boolean;
  token: string;
  conn: Conn | null;
  disconnectedAt: number | null;
  pid: PlayerId | null;
  ack: number;
  lastView: ViewTile[] | null;
  gaveUp: boolean;
}

interface Spectator {
  conn: Conn;
  lastView: ViewTile[] | null;
}

export type Phase = 'lobby' | 'playing' | 'over';

const cleanName = (s: unknown, fallback: string) => {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) : '';
  return v || fallback;
};

export class Room {
  phase: Phase = 'lobby';
  seats: Seat[] = [];
  spectators: Spectator[] = [];
  host: number | null = null;
  session: GameSession | null = null;
  winner: PlayerId | null = null;
  replayId: string | null = null;
  lastReplay: Replay | null = null;
  awards: Award[] = [];
  options: RoomOptions = { showers: true, pace: 'relaxed' };
  tickMs: number = PACES.relaxed;
  private lastEmote = new WeakMap<Conn, number>();
  lastActive: number;
  private nextSeat = 1;

  constructor(readonly code: string, private hooks: RoomHooks) {
    this.lastActive = hooks.now();
  }

  private token(): string {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  private seatOf(conn: Conn) {
    return this.seats.find((s) => s.conn === conn) ?? null;
  }

  get connectedHumans() {
    return this.seats.filter((s) => !s.isBot && s.conn).length + this.spectators.length;
  }

  private freeTeam(): string {
    const used = new Set(this.seats.map((s) => s.team));
    return (TEAMS.find((t) => !used.has(t.key)) ?? TEAMS[0]).key;
  }

  // ---------- connections ----------

  join(conn: Conn, name: unknown, token?: unknown, resume = false) {
    this.lastActive = this.hooks.now();
    let seat = typeof token === 'string' && token ? this.seats.find((s) => !s.isBot && s.token === token) : undefined;
    // A token borrowed from another open tab gets its own seat; this tab's own token
    // (a reload whose old socket hasn't closed yet) takes the seat over.
    if (seat && seat.conn && seat.conn !== conn && !resume) seat = undefined;
    if (seat) {
      seat.conn = conn;
      seat.disconnectedAt = null;
      seat.ack = 0;
      seat.lastView = null;
      if (this.phase === 'lobby') seat.name = cleanName(name, seat.name);
    } else if (this.phase === 'lobby' && this.seats.length < MAX_PLAYERS) {
      seat = {
        seat: this.nextSeat++,
        name: cleanName(name, `Player ${this.nextSeat - 1}`),
        team: this.freeTeam(),
        bot: null,
        isBot: false,
        token: this.token(),
        conn,
        disconnectedAt: null,
        pid: null,
        ack: 0,
        lastView: null,
        gaveUp: false
      };
      this.seats.push(seat);
    }
    if (this.host === null || !this.seats.some((s) => s.seat === this.host)) this.pickHost();
    conn.send({ t: 'welcome', token: seat?.token ?? '', room: this.code });
    if (!seat) this.spectators.push({ conn, lastView: null });
    if (this.phase === 'lobby') this.broadcastLobby();
    else {
      this.sendStarted(conn, seat?.pid ?? null);
      this.sendTickTo(conn, seat ?? null, null);
      if (this.phase === 'over') conn.send({ t: 'gameOver', winner: this.winner, replayId: this.replayId, awards: this.awards });
    }
  }

  disconnect(conn: Conn) {
    this.spectators = this.spectators.filter((s) => s.conn !== conn);
    const seat = this.seatOf(conn);
    if (!seat) return;
    seat.conn = null;
    seat.disconnectedAt = this.hooks.now();
    if (this.phase === 'lobby') this.broadcastLobby();
  }

  private pickHost() {
    const h = this.seats.find((s) => !s.isBot && s.conn) ?? this.seats.find((s) => !s.isBot);
    this.host = h ? h.seat : null;
  }

  // ---------- messages ----------

  handle(conn: Conn, raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as ClientMsg;
    const seat = this.seatOf(conn);
    const isHost = !!seat && seat.seat === this.host;
    this.lastActive = this.hooks.now();
    switch (msg.t) {
      case 'rename':
        if (seat && this.phase === 'lobby') {
          seat.name = cleanName(msg.name, seat.name);
          this.broadcastLobby();
        }
        break;
      case 'pickTeam':
        if (seat && this.phase === 'lobby' && TEAM_BY_KEY[msg.team] && !this.seats.some((s) => s.team === msg.team)) {
          seat.team = msg.team;
          this.broadcastLobby();
        }
        break;
      case 'addBot':
        if (isHost && this.phase === 'lobby' && this.seats.length < MAX_PLAYERS) {
          const team = this.freeTeam();
          this.seats.push({
            seat: this.nextSeat++, name: `${TEAM_BY_KEY[team].name} bot`, team, bot: null, isBot: true, token: '',
            conn: null, disconnectedAt: null, pid: null, ack: 0, lastView: null, gaveUp: false
          });
          this.broadcastLobby();
        }
        break;
      case 'removeBot':
        if (isHost && this.phase === 'lobby') {
          this.seats = this.seats.filter((s) => !(s.isBot && s.seat === msg.seat));
          this.broadcastLobby();
        }
        break;
      case 'setOptions':
        if (isHost && this.phase === 'lobby') {
          if (typeof msg.showers === 'boolean') this.options.showers = msg.showers;
          if (typeof msg.pace === 'string' && msg.pace in PACES) this.options.pace = msg.pace as Pace;
          this.broadcastLobby();
        }
        break;
      case 'emote': {
        const now = this.hooks.now();
        if (!Number.isInteger(msg.e) || msg.e < 0 || msg.e >= EMOTES.length) break;
        if (now - (this.lastEmote.get(conn) ?? -1e9) < 1200) break;
        this.lastEmote.set(conn, now);
        const who = seat ?? null;
        this.broadcast({ t: 'emote', name: who?.name ?? 'Spectator', team: who?.team ?? '', player: who?.pid ?? null, e: msg.e });
        break;
      }
      case 'start':
        if (isHost && this.phase === 'lobby' && this.seats.length >= MIN_PLAYERS) this.startGame();
        break;
      case 'queue':
        if (this.canPlay(seat) && Array.isArray(msg.moves)) {
          const tiles = this.session!.state.tiles.length;
          this.session!.enqueue(seat!.pid!, msg.moves.filter((m) => isWellFormedMove(m, tiles)));
          this.ack(seat!, msg.seq);
        }
        break;
      case 'undo':
        if (this.canPlay(seat)) {
          this.session!.undo(seat!.pid!);
          this.ack(seat!, msg.seq);
        }
        break;
      case 'clearQueue':
        if (this.canPlay(seat)) {
          this.session!.clear(seat!.pid!);
          this.ack(seat!, msg.seq);
        }
        break;
      case 'surrender':
        if (this.canPlay(seat)) this.session!.surrender(seat!.pid!);
        break;
      case 'backToLobby':
        if (isHost && this.phase === 'over') this.toLobby();
        break;
    }
  }

  private canPlay(seat: Seat | null): boolean {
    return !!seat && this.phase === 'playing' && seat.pid !== null && !!this.session?.state.players[seat.pid].alive;
  }

  private ack(seat: Seat, seq: unknown) {
    if (Number.isInteger(seq) && (seq as number) > seat.ack) seat.ack = seq as number;
  }

  // ---------- lobby ----------

  lobbyPlayers(): LobbyPlayer[] {
    return this.seats.map((s) => ({ seat: s.seat, name: s.name, team: s.team, bot: s.isBot, connected: s.isBot || !!s.conn }));
  }

  private broadcastLobby() {
    const players = this.lobbyPlayers();
    const options = { ...this.options };
    for (const s of this.seats) s.conn?.send({ t: 'lobby', code: this.code, players, host: this.host, you: s.seat, options });
    for (const sp of this.spectators) sp.conn.send({ t: 'lobby', code: this.code, players, host: this.host, you: null, options });
  }

  private toLobby() {
    this.hooks.stopTicking();
    this.phase = 'lobby';
    this.session = null;
    this.winner = null;
    this.replayId = null;
    this.seats = this.seats.filter((s) => s.isBot || s.conn);
    for (const s of this.seats) Object.assign(s, { pid: null, bot: null, lastView: null, ack: 0, gaveUp: false });
    // Spectators get a seat if there's room.
    const specs = this.spectators;
    this.spectators = [];
    for (const sp of specs) this.join(sp.conn, '', undefined);
    this.pickHost();
    this.broadcastLobby();
  }

  // ---------- game ----------

  private startGame() {
    const seed = Math.floor(this.hooks.random() * 2 ** 31);
    const state = generateMap(seed, this.seats.length, { showers: this.options.showers });
    this.tickMs = PACES[this.options.pace];
    this.awards = [];
    this.seats.forEach((s, i) => {
      s.pid = i;
      state.players[i].team = s.team;
      s.lastView = null;
      s.ack = 0;
      s.gaveUp = false;
      s.bot = s.isBot ? new Bot(i, seed) : null;
    });
    this.session = new GameSession(state);
    this.phase = 'playing';
    this.winner = null;
    this.replayId = null;
    for (const s of this.seats) if (s.conn) this.sendStarted(s.conn, s.pid);
    for (const sp of this.spectators) this.sendStarted(sp.conn, null);
    this.broadcastTick(null);
    this.hooks.startTicking(this.tickMs);
  }

  private playerInfos(): PlayerInfo[] {
    if (!this.session) return [];
    const st = playerStats(this.session.state);
    return this.seats.map((s) => {
      const pid = s.pid!;
      return {
        id: pid, name: s.name, team: s.team, alive: this.session!.state.players[pid].alive,
        connected: s.isBot || !!s.conn, bot: s.isBot, stems: st[pid].stems, land: st[pid].land
      };
    });
  }

  private sendStarted(conn: Conn, you: PlayerId | null) {
    const s = this.session!.state;
    conn.send({
      t: 'started', width: s.width, height: s.height, terrain: this.session!.initial.tiles.map((t) => kindCode(you === null || this.phase === 'over' ? t.kind : fogKind(t.kind))),
      buildings: s.buildings, fountain: s.fountain, you, players: this.playerInfos(), tickMs: this.tickMs, tick: s.tick, rules: s.rules
    });
  }

  private sendTickTo(conn: Conn, seat: Seat | null, rep: TickReport | null, spec?: Spectator) {
    const session = this.session!;
    const pid = seat?.pid ?? null;
    const view = viewFor(session.state, pid, this.phase === 'over');
    const holder = seat ?? spec;
    const changedTiles = diffView(holder?.lastView ?? null, view.tiles);
    if (holder) holder.lastView = view.tiles;
    conn.send({
      t: 'tick', tick: session.state.tick, changedTiles, players: this.playerInfos(),
      queue: pid !== null ? session.queues[pid].map((m) => ({ ...m })) : null,
      ack: seat?.ack ?? 0,
      executed: pid !== null ? rep?.executed.get(pid) ?? null : null,
      dropped: pid !== null ? rep?.dropped.get(pid) ?? [] : [],
      full: view.full,
      weather: { now: showerAt(session.state, session.state.tick), next: forecastAt(session.state, session.state.tick) }
    });
  }

  private broadcastTick(rep: TickReport | null) {
    for (const s of this.seats) if (s.conn) this.sendTickTo(s.conn, s, rep);
    for (const sp of this.spectators) this.sendTickTo(sp.conn, null, rep, sp);
  }

  private broadcast(msg: ServerMsg) {
    for (const s of this.seats) s.conn?.send(msg);
    for (const sp of this.spectators) sp.conn.send(msg);
  }

  /** Called every TICK_MS while playing. */
  tick() {
    if (this.phase !== 'playing' || !this.session) return;
    const session = this.session;
    for (const s of this.seats) {
      if (!s.bot || !session.state.players[s.pid!].alive) continue;
      const moves = s.bot.think(viewFor(session.state, s.pid), session.queues[s.pid!].length);
      if (moves.length) session.enqueue(s.pid!, moves);
    }
    const rep = session.advance();
    if (rep.over) {
      this.finish(rep);
      return;
    }
    this.broadcastTick(rep);
    for (const e of rep.eliminations) this.broadcast({ t: 'eliminated', player: e.player, by: e.by });
    for (const p of rep.surrendered) this.broadcast({ t: 'eliminated', player: p, by: null });
    // Bots have feelings too.
    for (const e of rep.eliminations) {
      const victim = this.seats.find((s) => s.pid === e.player);
      const winner = this.seats.find((s) => s.pid === e.by);
      if (victim?.isBot) this.broadcast({ t: 'emote', name: victim.name, team: victim.team, player: victim.pid, e: 4 });
      else if (winner?.isBot) this.broadcast({ t: 'emote', name: winner.name, team: winner.team, player: winner.pid, e: 1 });
    }
  }

  private finish(rep: TickReport) {
    this.hooks.stopTicking();
    this.phase = 'over';
    this.winner = rep.winner;
    const session = this.session!;
    const id = `${this.code}-${Math.floor(this.hooks.now()).toString(36)}`;
    const replay = session.toReplay(id, this.seats.map((s) => ({ name: s.name, team: s.team })), rep.winner, this.tickMs);
    this.lastReplay = replay;
    try {
      this.awards = computeAwards(replay);
    } catch (err) {
      console.error('awards failed', err);
      this.awards = [];
    }
    this.replayId = this.hooks.saveReplay?.(replay) ?? null;
    this.broadcastTick(rep); // unfogged final board
    for (const e of rep.eliminations) this.broadcast({ t: 'eliminated', player: e.player, by: e.by });
    for (const p of rep.surrendered) this.broadcast({ t: 'eliminated', player: p, by: null });
    this.broadcast({ t: 'gameOver', winner: this.winner, replayId: this.replayId, awards: this.awards });
  }

  /** Run about once a second: disconnect grace periods and host hand-over. */
  housekeeping() {
    const now = this.hooks.now();
    const expired = (s: Seat) => !s.isBot && !s.conn && s.disconnectedAt !== null && now - s.disconnectedAt > DISCONNECT_GRACE_MS;
    if (this.phase === 'lobby') {
      const before = this.seats.length;
      this.seats = this.seats.filter((s) => !expired(s));
      if (this.seats.length !== before) {
        if (!this.seats.some((s) => s.seat === this.host)) this.pickHost();
        this.broadcastLobby();
      }
    } else if (this.phase === 'playing' && this.session) {
      for (const s of this.seats) {
        if (expired(s) && !s.gaveUp && this.session.state.players[s.pid!].alive) {
          s.gaveUp = true;
          this.session.surrender(s.pid!);
        }
      }
    }
    const host = this.seats.find((s) => s.seat === this.host);
    if (!host || (!host.conn && this.seats.some((s) => !s.isBot && s.conn))) {
      const prev = this.host;
      this.pickHost();
      if (prev !== this.host && this.phase === 'lobby') this.broadcastLobby();
    }
  }
}

/** Drift-corrected repeating timer: tick n fires at start + n * interval. */
export class TickLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private start = 0;
  private n = 0;

  constructor(private interval: number, private fn: () => void, private now: () => number = () => Date.now()) {}

  begin(interval = this.interval) {
    this.stop();
    this.interval = interval;
    this.start = this.now();
    this.n = 0;
    this.schedule();
  }

  private schedule() {
    this.n++;
    const due = this.start + this.n * this.interval;
    this.timer = setTimeout(() => {
      this.timer = null;
      // If we fell far behind (e.g. a sleeping laptop), resync instead of bursting.
      if (this.now() - due > this.interval * 4) {
        this.start = this.now();
        this.n = 0;
      }
      this.fn();
      if (this.timer === null && this.running) this.schedule();
    }, Math.max(0, due - this.now()));
    this.running = true;
  }

  private running = false;

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
