// JSON over WebSocket. Shared by the server, the browser and the offline room.
import type { Building, PlayerId, QueuedMove, Rules, TileKind, ViewTile } from './types';
import type { Pace } from './config';
import type { Shower } from './weather';
import type { Award } from './awards';
import { KINDS } from './types';

export interface LobbyPlayer {
  seat: number;
  name: string;
  team: string;
  bot: boolean;
  connected: boolean;
}

export interface RoomOptions {
  showers: boolean;
  pace: Pace;
  /** Minutes, one of TIME_LIMITS; 0 = play until one mother plant is left. */
  timeLimit: number;
}

export interface Weather {
  now: Shower | null;
  next: Shower | null;
}

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  team: string;
  alive: boolean;
  connected: boolean;
  bot: boolean;
  stems: number;
  land: number;
}

/** [index, kind, owner (-1 none), stems, isMother 0/1, visible 0/1] */
export type TileDelta = [number, number, number, number, number, number];

export type ClientMsg =
  /** resume: the token is this tab's own (take the seat over); otherwise it may belong to another open tab. */
  | { t: 'join'; room: string; name: string; token?: string; resume?: boolean }
  | { t: 'rename'; name: string }
  | { t: 'pickTeam'; team: string }
  | { t: 'addBot' }
  | { t: 'removeBot'; seat: number }
  | { t: 'start' }
  | { t: 'setOptions'; showers?: boolean; pace?: Pace; timeLimit?: number }
  | { t: 'emote'; e: number }
  | { t: 'queue'; seq: number; moves: QueuedMove[] }
  | { t: 'clearQueue'; seq: number }
  | { t: 'undo'; seq: number }
  | { t: 'surrender' }
  | { t: 'backToLobby' }
  /** Heartbeat every few seconds so a host without protocol pings (Cloudflare) can drop dead sockets. */
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; token: string; room: string }
  | { t: 'lobby'; code: string; players: LobbyPlayer[]; host: number | null; you: number | null; options: RoomOptions }
  | {
      t: 'started';
      width: number;
      height: number;
      terrain: number[];
      buildings: Building[];
      fountain: number;
      you: PlayerId | null;
      players: PlayerInfo[];
      tickMs: number;
      tick: number;
      rules: Rules;
    }
  | {
      t: 'tick';
      tick: number;
      changedTiles: TileDelta[];
      players: PlayerInfo[];
      /** Your own queue (never anyone else's). null for spectators. */
      queue: QueuedMove[] | null;
      /** Highest client seq the server has applied. */
      ack: number;
      executed: number | null;
      dropped: number[];
      full: boolean;
      weather: Weather;
    }
  | { t: 'eliminated'; player: PlayerId; by: PlayerId | null }
  | { t: 'emote'; name: string; team: string; player: PlayerId | null; e: number }
  | { t: 'gameOver'; winner: PlayerId | null; replayId: string | null; awards: Award[]; reason?: 'conquest' | 'time' }
  | { t: 'error'; message: string };

export const kindCode = (k: TileKind) => KINDS.indexOf(k);

export function encodeTile(i: number, t: ViewTile): TileDelta {
  return [i, kindCode(t.kind), t.owner ?? -1, t.stems, t.isMother ? 1 : 0, t.visible ? 1 : 0];
}

export function decodeTile(d: TileDelta): ViewTile {
  return { kind: KINDS[d[1]], owner: d[2] < 0 ? null : d[2], stems: d[3], isMother: d[4] === 1, visible: d[5] === 1 };
}

export function sameTile(a: ViewTile | undefined, b: ViewTile): boolean {
  return !!a && a.kind === b.kind && a.owner === b.owner && a.stems === b.stems && a.isMother === b.isMother && a.visible === b.visible;
}

/** Tiles that differ between what a client last saw and what it may see now. */
export function diffView(prev: ViewTile[] | null, next: ViewTile[]): TileDelta[] {
  const out: TileDelta[] = [];
  for (let i = 0; i < next.length; i++) if (!prev || !sameTile(prev[i], next[i])) out.push(encodeTile(i, next[i]));
  return out;
}
