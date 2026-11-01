// Silly superlatives for the end screen, computed by re-running the replay.
import { moveDest, stepDetailed, surrender } from './engine';
import { replayInitial, type Replay } from './replay';
import type { GameState, Move, PlayerId } from './types';
import { DIRS } from './types';

export interface Award {
  icon: string;
  title: string;
  player: PlayerId;
  detail: string;
}

interface Tally {
  captures: number;
  water: number;
  uproots: number;
  biggest: number;
  fails: number;
  steps: number;
  longestPath: number;
  peakLand: number;
  lastAliveTick: number;
}

export function tallyReplay(r: Replay): Tally[] {
  let s: GameState = replayInitial(r);
  const t: Tally[] = s.players.map(() => ({ captures: 0, water: 0, uproots: 0, biggest: 1, fails: 0, steps: 0, longestPath: 0, peakLand: 1, lastAliveTick: 0 }));
  const chainEnd = s.players.map(() => -1);
  const chainLen = s.players.map(() => 0);
  for (const tick of r.ticks) {
    for (const p of tick.s ?? []) s = surrender(s, p);
    const moves = new Map<PlayerId, Move>();
    for (const [p, from, d, half] of tick.m) moves.set(p, { from, dir: DIRS[d], half: half === 1 });
    const before = s;
    const res = stepDetailed(s, moves);
    s = res.state;
    for (const [p, m] of moves) {
      const out = res.outcomes.get(p);
      if (out === 'failed') t[p].fails++;
      if (out !== 'ok') continue;
      t[p].steps++;
      const to = moveDest(s, m);
      if (before.tiles[to].owner !== p && s.tiles[to].owner === p) {
        t[p].captures++;
        if (before.tiles[to].kind === 'water' && !before.tiles[to].isMother) t[p].water++;
      }
      chainLen[p] = chainEnd[p] === m.from ? chainLen[p] + 1 : 1;
      chainEnd[p] = to;
      t[p].longestPath = Math.max(t[p].longestPath, chainLen[p]);
    }
    for (const e of res.eliminations) t[e.by].uproots++;
    const land = s.players.map(() => 0);
    for (const tile of s.tiles) {
      if (tile.owner === null) continue;
      land[tile.owner]++;
      if (tile.stems > t[tile.owner].biggest) t[tile.owner].biggest = tile.stems;
    }
    s.players.forEach((p) => {
      if (p.alive) t[p.id].lastAliveTick = s.tick;
      t[p.id].peakLand = Math.max(t[p.id].peakLand, land[p.id]);
    });
  }
  return t;
}

function best(t: Tally[], key: keyof Tally, min: number, lowest = false): PlayerId | null {
  let who: PlayerId | null = null;
  t.forEach((x, i) => {
    if ((lowest ? x[key] > min : x[key] < min)) return;
    if (who === null || (lowest ? x[key] < t[who][key] : x[key] > t[who][key])) who = i;
  });
  return who;
}

/** Up to five awards, each to a different player where possible. */
export function computeAwards(r: Replay): Award[] {
  const t = tallyReplay(r);
  const out: Award[] = [];
  const add = (who: PlayerId | null, icon: string, title: string, detail: (x: Tally) => string) => {
    if (who !== null) out.push({ icon, title, player: who, detail: detail(t[who]) });
  };
  add(best(t, 'captures', 1), '🌿', 'Rampant Grower', (x) => `claimed ${x.captures} tiles`);
  add(best(t, 'uproots', 1), '🪓', 'Uprooter', (x) => `toppled ${x.uproots} mother plant${x.uproots === 1 ? '' : 's'}`);
  add(best(t, 'biggest', 30), '💐', 'Biggest Bouquet', (x) => `${x.biggest} stems in one spot`);
  add(best(t, 'water', 1), '🚰', 'Hydrant Hog', (x) => `drank from ${x.water} water tile${x.water === 1 ? '' : 's'}`);
  add(best(t, 'longestPath', 8), '🐍', 'Marathon Vine', (x) => `a ${x.longestPath}-step path in one go`);
  add(best(t, 'fails', 3), '🌵', 'Thorny Optimist', (x) => `${x.fails} attacks bounced off`);
  // Houseplant: the player who moved least while staying in the game a good while.
  const sitters = t.map((x, i) => ({ x, i })).filter(({ x }) => x.lastAliveTick >= Math.min(200, r.ticks.length));
  if (sitters.length > 1) {
    const h = sitters.reduce((a, b) => (b.x.steps < a.x.steps ? b : a));
    out.push({ icon: '🪴', title: 'Houseplant', player: h.i, detail: `only ${h.x.steps} moves. Very zen.` });
  }
  // Prefer spreading awards around: keep the first award per player, then fill.
  const seen = new Set<PlayerId>();
  const first = out.filter((a) => (seen.has(a.player) ? false : (seen.add(a.player), true)));
  const rest = out.filter((a) => !first.includes(a));
  return [...first, ...rest].slice(0, 5);
}

