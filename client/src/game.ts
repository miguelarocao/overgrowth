// Client-side game state, rebuilt only from what the server sends (a PlayerView).
// Your own queue is predicted locally: steps show up immediately and are
// reconciled with the server's authoritative queue using acked sequence numbers.
import { neighbor } from '../../shared/grid';
import { decodeTile, type PlayerInfo, type ServerMsg } from '../../shared/protocol';
import { sendAmount } from '../../shared/engine';
import { KINDS, type Building, type Dir, type PlayerId, type QueuedMove, type TileKind, type ViewTile } from '../../shared/types';
import type { ClientMsg } from '../../shared/protocol';

type StartedMsg = Extract<ServerMsg, { t: 'started' }>;
type TickMsg = Extract<ServerMsg, { t: 'tick' }>;

type PendingOp = { seq: number } & ({ k: 'queue'; moves: QueuedMove[] } | { k: 'undo' } | { k: 'clear' });

export interface TickChanges {
  changed: number[];
  executed: QueuedMove | null;
  dropped: QueuedMove[];
}

export interface Estimate {
  tile: number;
  text: string;
}

export class ClientGame {
  readonly width: number;
  readonly height: number;
  readonly buildings: Building[];
  readonly fountain: number;
  readonly tickMs: number;
  tiles: ViewTile[];
  /** Owner when we last saw a tile, for the faint "last seen" tint. */
  lastSeen: (PlayerId | null)[];
  you: PlayerId | null;
  players: PlayerInfo[];
  tick: number;
  full = false;
  over = false;
  winner: PlayerId | null = null;

  selection: number | null = null;
  halfNext = false;
  private serverQueue: QueuedMove[] = [];
  private pending: PendingOp[] = [];
  private seq = 0;
  private nextId = Math.floor(Math.random() * 1e9);
  private cachedQueue: QueuedMove[] | null = null;

  constructor(msg: StartedMsg, private send: (m: ClientMsg) => void) {
    this.width = msg.width;
    this.height = msg.height;
    this.buildings = msg.buildings;
    this.fountain = msg.fountain;
    this.tickMs = msg.tickMs;
    this.you = msg.you;
    this.players = msg.players;
    this.tick = msg.tick;
    this.tiles = msg.terrain.map((k) => ({ kind: KINDS[k] as TileKind, owner: null, stems: 0, isMother: false, visible: false }));
    this.lastSeen = this.tiles.map(() => null);
  }

  get alive() {
    return this.you !== null && !!this.players.find((p) => p.id === this.you)?.alive;
  }

  teamOf(pid: PlayerId | null): string | undefined {
    return pid === null ? undefined : this.players.find((p) => p.id === pid)?.team;
  }

  applyTick(msg: TickMsg): TickChanges {
    const before = this.queue;
    const changed: number[] = [];
    for (const d of msg.changedTiles) {
      const t = decodeTile(d);
      this.tiles[d[0]] = t;
      if (t.visible) this.lastSeen[d[0]] = t.owner;
      changed.push(d[0]);
    }
    this.tick = msg.tick;
    this.players = msg.players;
    this.full = msg.full;
    if (msg.queue) this.serverQueue = msg.queue;
    this.pending = this.pending.filter((p) => p.seq > msg.ack);
    this.cachedQueue = null;
    const byId = new Map(before.map((m) => [m.id, m]));
    return {
      changed,
      executed: msg.executed !== null ? byId.get(msg.executed) ?? null : null,
      dropped: msg.dropped.map((id) => byId.get(id)).filter((m): m is QueuedMove => !!m)
    };
  }

  /** The queue as the player should see it: server queue plus not-yet-acked local edits. */
  get queue(): QueuedMove[] {
    if (this.cachedQueue) return this.cachedQueue;
    const q = this.serverQueue.map((m) => ({ ...m }));
    for (const p of this.pending) {
      if (p.k === 'queue') q.push(...p.moves);
      else if (p.k === 'undo') q.pop();
      else q.length = 0;
    }
    this.cachedQueue = q;
    return q;
  }

  private op(op: PendingOp) {
    this.pending.push(op);
    this.cachedQueue = null;
    if (op.k === 'queue') this.send({ t: 'queue', seq: op.seq, moves: op.moves });
    else if (op.k === 'undo') this.send({ t: 'undo', seq: op.seq });
    else this.send({ t: 'clearQueue', seq: op.seq });
  }

  /** Reset prediction after a reconnect (the server resets acks per connection). */
  resetPrediction() {
    this.pending = [];
    this.seq = 0;
    this.cachedQueue = null;
  }

  // ---------- input ----------

  canSelect(i: number) {
    return this.alive && this.tiles[i]?.owner === this.you;
  }

  select(i: number | null) {
    this.selection = i !== null && this.canSelect(i) ? i : null;
    this.halfNext = false;
  }

  /** Queue one step from the selection; the selection moves to the destination. */
  queueDir(dir: Dir): boolean {
    if (this.selection === null || !this.alive || this.over) return false;
    const to = neighbor(this.selection, dir, this.width, this.height);
    if (to < 0 || this.tiles[to].kind === 'building') return false;
    const move: QueuedMove = { id: this.nextId++, from: this.selection, dir, half: this.halfNext };
    this.op({ seq: ++this.seq, k: 'queue', moves: [move] });
    this.halfNext = false;
    this.selection = to;
    return true;
  }

  toggleHalf() {
    if (this.alive) this.halfNext = !this.halfNext;
  }

  undo() {
    const q = this.queue;
    if (!q.length) return;
    const last = q[q.length - 1];
    this.op({ seq: ++this.seq, k: 'undo' });
    this.selection = last.from;
  }

  clear() {
    if (!this.queue.length) return;
    this.op({ seq: ++this.seq, k: 'clear' });
  }

  dest(m: QueuedMove) {
    return neighbor(m.from, m.dir, this.width, this.height);
  }

  // ---------- estimates ----------

  /**
   * Estimated arrival at the end of each queued path: assume all but one per step
   * (or half), subtract only stems we can see, and give up ("≈?") inside smog.
   */
  estimates(): Estimate[] {
    const q = this.queue;
    if (!q.length || this.you === null) return [];
    const me = this.you;
    const sim = this.tiles.map((t) => ({ owner: t.owner, stems: t.stems, unknown: !t.visible }));
    const out: Estimate[] = [];
    q.forEach((m, k) => {
      const to = this.dest(m);
      if (to < 0) return;
      const src = sim[m.from], dst = sim[to];
      if (src.unknown || src.owner !== me) {
        dst.unknown = true;
      } else if (src.stems < 2) {
        // Nothing to send: path stalls here.
      } else {
        const send = sendAmount(src.stems, m.half);
        src.stems -= send;
        if (dst.unknown) {
          /* stays unknown */
        } else if (dst.owner === me) dst.stems += send;
        else if (send > dst.stems) {
          dst.owner = me;
          dst.stems = send - dst.stems;
        } else dst.stems -= send;
      }
      const continues = q.slice(k + 1).some((n) => n.from === to);
      if (!continues) out.push({ tile: to, text: dst.unknown ? '≈?' : `≈${dst.owner === me ? dst.stems : 0}` });
    });
    return out;
  }
}
