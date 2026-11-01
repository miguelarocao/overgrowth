// Two transports with the same shape: a WebSocket to the server, or an in-browser
// Room (the exact server room code) for offline play against bots.
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { TICK_MS } from '../../shared/config';
import { Room, TickLoop, type Conn } from '../../server/room';

export interface Handlers {
  onMessage(m: ServerMsg): void;
  onStatus(s: 'connecting' | 'open' | 'closed'): void;
}

export interface Connection {
  send(m: ClientMsg): void;
  close(): void;
  readonly offline: boolean;
}

const store = {
  /** This tab's own value (survives reloads). */
  own(k: string) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  get(k: string) {
    try {
      return sessionStorage.getItem(k) ?? localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  }
};

export class WsConnection implements Connection {
  readonly offline = false;
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private outbox: ClientMsg[] = [];

  constructor(private room: string, private name: () => string, private h: Handlers) {
    this.connect();
  }

  private connect() {
    this.h.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const key = `og-token-${this.room}`;
      const own = store.own(key);
      ws.send(JSON.stringify({ t: 'join', room: this.room, name: this.name(), token: own ?? store.get(key) ?? undefined, resume: !!own }));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
      this.h.onStatus('open');
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome' && m.token) store.set(`og-token-${this.room}`, m.token);
      this.h.onMessage(m);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.h.onStatus('closed');
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'queue' && m.t !== 'undo' && m.t !== 'clearQueue') this.outbox.push(m);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

export const LOCAL_REPLAY_KEY = 'og-replay-local';

export class LocalConnection implements Connection {
  readonly offline = true;
  private room: Room;
  private conn: Conn;
  private loop: TickLoop;
  private house: ReturnType<typeof setInterval>;

  constructor(name: string, h: Handlers) {
    this.conn = { send: (m) => queueMicrotask(() => h.onMessage(structuredClone(m))) };
    this.room = new Room('offline', {
      now: () => Date.now(),
      random: () => Math.random(),
      startTicking: () => this.loop.begin(),
      stopTicking: () => this.loop.stop(),
      saveReplay: (r) => {
        try {
          sessionStorage.setItem(LOCAL_REPLAY_KEY, JSON.stringify(r));
          return 'local';
        } catch {
          return null;
        }
      }
    });
    this.loop = new TickLoop(TICK_MS, () => this.room.tick());
    this.house = setInterval(() => this.room.housekeeping(), 1000);
    h.onStatus('open');
    this.room.join(this.conn, name);
    this.room.handle(this.conn, { t: 'addBot' });
  }

  send(m: ClientMsg) {
    this.room.handle(this.conn, structuredClone(m));
  }

  close() {
    this.loop.stop();
    clearInterval(this.house);
  }
}
