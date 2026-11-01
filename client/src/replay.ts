// Replays are just the seed plus every tick's inputs. The viewer re-runs the
// engine and feeds the renderer the same tick messages a spectator would get.
import { TICK_MS } from '../../shared/config';
import { playerStats } from '../../shared/engine';
import { diffView, kindCode, type PlayerInfo, type ServerMsg } from '../../shared/protocol';
import { applyReplayTick, replayInitial, type Replay } from '../../shared/replay';
import type { GameState, ViewTile } from '../../shared/types';
import { viewFor } from '../../shared/view';

export class ReplayPlayer {
  private checkpoints = new Map<number, GameState>();
  private state: GameState;
  private sent: ViewTile[] | null = null;
  readonly total: number;

  constructor(readonly replay: Replay) {
    this.state = replayInitial(replay);
    this.checkpoints.set(0, this.state);
    this.total = replay.ticks.length;
  }

  get tick() {
    return this.state.tick;
  }

  private infos(s: GameState): PlayerInfo[] {
    const st = playerStats(s);
    return s.players.map((p) => ({
      id: p.id, name: this.replay.players[p.id]?.name ?? `Player ${p.id + 1}`, team: p.team, alive: p.alive,
      connected: true, bot: false, stems: st[p.id].stems, land: st[p.id].land
    }));
  }

  started(): Extract<ServerMsg, { t: 'started' }> {
    const s0 = this.checkpoints.get(0)!;
    this.sent = null;
    return {
      t: 'started', width: s0.width, height: s0.height, terrain: s0.tiles.map((t) => kindCode(t.kind)),
      buildings: s0.buildings, fountain: s0.fountain, you: null, players: this.infos(s0), tickMs: TICK_MS, tick: 0
    };
  }

  /** Move to tick t and return the tick message that brings a viewer up to date. */
  seek(t: number): Extract<ServerMsg, { t: 'tick' }> {
    t = Math.max(0, Math.min(this.total, Math.floor(t)));
    if (t < this.state.tick) {
      let k = Math.floor(t / 100) * 100;
      while (!this.checkpoints.has(k)) k -= 100;
      this.state = this.checkpoints.get(k)!;
    }
    while (this.state.tick < t) {
      this.state = applyReplayTick(this.state, this.replay.ticks[this.state.tick]);
      if (this.state.tick % 100 === 0) this.checkpoints.set(this.state.tick, this.state);
    }
    const view = viewFor(this.state, null);
    const changedTiles = diffView(this.sent, view.tiles);
    this.sent = view.tiles;
    return { t: 'tick', tick: this.state.tick, changedTiles, players: this.infos(this.state), queue: null, ack: 0, executed: null, dropped: [], full: true };
  }
}
