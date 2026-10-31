import { generateMap } from '../shared/mapgen';
import { GameSession } from '../shared/session';
import { hashState } from '../shared/engine';
import { viewFor } from '../shared/view';
import { Bot } from './bot';

export interface HeadlessResult {
  seed: number;
  players: number;
  ticks: number;
  winner: number | null;
  finished: boolean;
  hash: string;
  session: GameSession;
}

/** Play a full bot-vs-bot game with no server and no clock. */
export function runBotGame(seed: number, players: number, maxTicks = 6000): HeadlessResult {
  const session = new GameSession(generateMap(seed, players));
  const bots = session.state.players.map((p) => new Bot(p.id, seed));
  let winner: number | null = null;
  let finished = false;
  while (session.state.tick < maxTicks) {
    for (const b of bots) {
      if (!session.state.players[b.player].alive) continue;
      const moves = b.think(viewFor(session.state, b.player), session.queues[b.player].length);
      if (moves.length) session.enqueue(b.player, moves);
    }
    const r = session.advance();
    if (r.over) {
      winner = r.winner;
      finished = true;
      break;
    }
  }
  return { seed, players, ticks: session.state.tick, winner, finished, hash: hashState(session.state), session };
}
