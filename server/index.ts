// Overgrowth game server: serves the built client, runs rooms over WebSocket and
// stores replays. Any small Node host works: `npm run build && npm start`.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_MS } from '../shared/config';
import type { Replay } from '../shared/replay';
import { Room, TickLoop, type Conn } from './room';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve(import.meta.dirname, '..');
const STATIC = resolve(ROOT, 'dist/client');
const DATA = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
const REPLAYS = join(DATA, 'replays');
mkdirSync(REPLAYS, { recursive: true });

const ROOM_CODE = /^[a-z0-9-]{3,24}$/;
const REPLAY_ID = /^[a-z0-9-]{3,48}$/;
const ROOM_IDLE_MS = 10 * 60_000;

// ---------- rooms ----------

interface RoomEntry { room: Room; loop: TickLoop }
const rooms = new Map<string, RoomEntry>();

function getRoom(code: string): RoomEntry {
  let e = rooms.get(code);
  if (e) return e;
  let loop!: TickLoop;
  const room = new Room(code, {
    now: () => Date.now(),
    random: () => Math.random(),
    startTicking: (ms) => loop.begin(ms),
    stopTicking: () => loop.stop(),
    saveReplay: (r: Replay) => {
      try {
        writeFileSync(join(REPLAYS, `${r.id}.json`), JSON.stringify(r));
        return r.id;
      } catch (err) {
        console.error('could not save replay', err);
        return null;
      }
    }
  });
  loop = new TickLoop(TICK_MS, () => {
    try {
      room.tick();
    } catch (err) {
      console.error(`room ${code} tick failed`, err);
    }
  });
  e = { room, loop };
  rooms.set(code, e);
  return e;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, e] of rooms) {
    e.room.housekeeping();
    if (e.room.connectedHumans === 0 && now - e.room.lastActive > ROOM_IDLE_MS) {
      e.loop.stop();
      rooms.delete(code);
    }
  }
}, 1000);

// ---------- http ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const rep = path.match(/^\/api\/replays\/([^/]+)$/);
  if (rep) {
    const id = rep[1];
    const file = join(REPLAYS, `${id}.json`);
    if (!REPLAY_ID.test(id) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(readFileSync(file));
    return;
  }

  // Static client with SPA fallback for /r/<code>, /offline and /replay/<id>.
  let file = normalize(join(STATIC, path));
  if (!file.startsWith(STATIC)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run build`, or use `npm run dev` for development.');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  createReadStream(file).pipe(res);
});

// ---------- websocket ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let entry: RoomEntry | null = null;
  const conn: Conn = {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    }
  };
  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);

  ws.on('message', (data) => {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      const code = String(msg.room ?? '').toLowerCase();
      if (!ROOM_CODE.test(code)) {
        conn.send({ t: 'error', message: 'Bad room code' });
        return;
      }
      if (entry) entry.room.disconnect(conn);
      entry = getRoom(code);
      entry.room.join(conn, msg.name, msg.token, msg.resume === true);
      return;
    }
    try {
      entry?.room.handle(conn, msg);
    } catch (err) {
      console.error('message failed', err);
    }
  });

  ws.on('close', () => {
    clearInterval(ping);
    entry?.room.disconnect(conn);
  });
});

server.listen(PORT, () => {
  console.log(`Overgrowth server on http://localhost:${PORT}`);
});
