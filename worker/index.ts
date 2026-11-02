// Cloudflare deployment: one Worker serves the built client and routes each room's
// WebSocket to a Durable Object named after the room code. The object runs the same
// transport-agnostic Room as the Node server (server/index.ts); only the plumbing differs.
//
//   npm run cf:dev      local, in workerd
//   npm run cf:deploy   to your Cloudflare account
//
// Rooms live in memory, like on the Node server: when a room has been empty for a while
// it is dropped, and Cloudflare may evict an idle object at any time, which forgets it.
// Replays are the one thing written to storage (SQLite in the room's object) and are
// deleted after REPLAY_TTL_MS.
import { DurableObject } from 'cloudflare:workers';
import { Room, TickLoop, type Conn } from '../server/room';
import { TICK_MS } from '../shared/config';
import type { Replay } from '../shared/replay';

interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}

const ROOM_CODE = /^[a-z0-9-]{3,24}$/;
/** Replay ids are `<room code>-<base36 time>` (see Room.finish), so the id says which object holds it. */
const REPLAY_ID = /^([a-z0-9-]{3,24})-[a-z0-9]{1,12}$/;
const MAX_MESSAGE = 64 * 1024;
const ROOM_IDLE_MS = 10 * 60_000;
/** Clients send a ping every 10 s; a socket silent for this long is treated as gone. */
const SILENT_MS = 35_000;
const REPLAY_TTL_MS = 7 * 24 * 60 * 60_000;
/** SQLite-backed objects cap a row at 2 MB; long 8-player games are around 0.15 MB. */
const MAX_REPLAY = 1_900_000;

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const code = (url.searchParams.get('room') ?? '').toLowerCase();
      if (!ROOM_CODE.test(code)) return new Response('Bad room code', { status: 400 });
      return roomStub(env, code).fetch(req);
    }
    if (url.pathname === '/api/health') return Response.json({ ok: true });
    const rep = url.pathname.match(/^\/api\/replays\/([^/]+)$/);
    if (rep) {
      const id = decodeURIComponent(rep[1]).toLowerCase();
      const m = REPLAY_ID.exec(id);
      const json = m ? await roomStub(env, m[1]).getReplay(id) : null;
      if (json === null) return new Response('not found', { status: 404 });
      return new Response(json, { headers: { 'content-type': 'application/json' } });
    }
    // Everything else is the client; wrangler.jsonc makes unknown paths (/r/<code>…) serve index.html.
    return env.ASSETS.fetch(req);
  }
} satisfies ExportedHandler<Env>;

interface Live {
  code: string;
  room: Room;
  loop: TickLoop;
  house: ReturnType<typeof setInterval>;
}

export class GameRoom extends DurableObject<Env> {
  private live: Live | null = null;
  /** Open sockets: when each last said anything, and how to drop it. */
  private sockets = new Map<WebSocket, { seen: number; leave: () => void }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS replays (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL)');
  }

  async fetch(req: Request): Promise<Response> {
    const code = (new URL(req.url).searchParams.get('room') ?? '').toLowerCase();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Plain accept(), not the hibernation API: the Room lives in memory, so the object
    // must stay awake while anyone is connected (a hibernated object would forget it).
    server.accept();
    this.attach(server, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  async getReplay(id: string): Promise<string | null> {
    const row = this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM replays WHERE id = ?', id).toArray()[0];
    return row?.json ?? null;
  }

  /** Deletes expired replays, then wakes again for the next one to expire. */
  async alarm() {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM replays WHERE at < ?', Date.now() - REPLAY_TTL_MS);
    const next = sql.exec<{ at: number | null }>('SELECT MIN(at) AS at FROM replays').one().at;
    if (next !== null) await this.ctx.storage.setAlarm(next + REPLAY_TTL_MS);
  }

  private attach(ws: WebSocket, code: string) {
    let room: Room | null = null;
    const conn: Conn = {
      send: (msg) => {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* already closing */
        }
      }
    };

    ws.addEventListener('message', (ev) => {
      const s = this.sockets.get(ws);
      if (s) s.seen = Date.now();
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MESSAGE) return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || msg.t === 'ping') return;
      if (msg.t === 'join') {
        if (String(msg.room ?? '').toLowerCase() !== code) {
          conn.send({ t: 'error', message: 'Bad room code' });
          return;
        }
        room?.disconnect(conn);
        room = this.open(code).room;
        room.join(conn, msg.name, msg.token, msg.resume === true);
        return;
      }
      try {
        room?.handle(conn, msg);
      } catch (err) {
        console.error('message failed', err);
      }
    });

    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      this.sockets.delete(ws);
      room?.disconnect(conn);
      try {
        ws.close(1000, 'bye');
      } catch {
        /* already closed */
      }
    };
    this.sockets.set(ws, { seen: Date.now(), leave });
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
  }

  /** The live room, created on first join (or again after it went idle). */
  private open(code: string): Live {
    if (this.live) return this.live;
    let loop!: TickLoop;
    const room = new Room(code, {
      now: () => Date.now(),
      random: () => Math.random(),
      startTicking: (ms) => loop.begin(ms),
      stopTicking: () => loop.stop(),
      saveReplay: (r) => this.saveReplay(r)
    });
    loop = new TickLoop(TICK_MS, () => {
      try {
        room.tick();
      } catch (err) {
        console.error(`room ${code} tick failed`, err);
      }
    });
    const house = setInterval(() => this.housekeeping(), 1000);
    this.live = { code, room, loop, house };
    return this.live;
  }

  private housekeeping() {
    const now = Date.now();
    // No protocol-level pings here, so a client that vanished without closing is only
    // noticed by going quiet. Closing it starts the room's normal disconnect grace period.
    for (const s of [...this.sockets.values()]) if (now - s.seen > SILENT_MS) s.leave();
    const live = this.live;
    if (!live) return;
    live.room.housekeeping();
    // Same rule as the Node server: drop a room nobody has been in for a while. With no
    // timers left and no sockets open, Cloudflare stops billing and evicts the object.
    if (live.room.connectedHumans === 0 && now - live.room.lastActive > ROOM_IDLE_MS) {
      live.loop.stop();
      clearInterval(live.house);
      this.live = null;
    }
  }

  private saveReplay(r: Replay): string | null {
    const json = JSON.stringify(r);
    if (json.length > MAX_REPLAY) return null;
    try {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO replays (id, at, json) VALUES (?, ?, ?)', r.id, Date.now(), json);
      this.ctx.storage.getAlarm().then((at) => (at === null ? this.ctx.storage.setAlarm(Date.now() + REPLAY_TTL_MS) : undefined));
      return r.id;
    } catch (err) {
      console.error('could not save replay', err);
      return null;
    }
  }
}
