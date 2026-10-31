// Headless bot-vs-bot runs: no crashes, every game ends, typical length 5-15 minutes.
// Usage: npm run sim -- [games=300] [maxTicks=6000]
import { TICK_MS } from '../shared/config';
import { runBotGame } from './headless';

const games = Number(process.argv[2] ?? 300);
const maxTicks = Number(process.argv[3] ?? 6000);
const lengths: number[] = [];
let unfinished = 0, crashes = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const players = 2 + (g % 7);
  try {
    const r = runBotGame(1000 + g * 17, players, maxTicks);
    if (!r.finished) unfinished++;
    else lengths.push(r.ticks);
  } catch (e) {
    crashes++;
    console.error(`game ${g} crashed:`, e);
  }
}
lengths.sort((a, b) => a - b);
const min = (t: number) => ((t * TICK_MS) / 60000).toFixed(1);
const q = (p: number) => lengths[Math.floor((lengths.length - 1) * p)] ?? 0;
console.log(`${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`crashes ${crashes}, unfinished (>${min(maxTicks)} min) ${unfinished}`);
console.log(`length minutes: min ${min(q(0))}, p10 ${min(q(0.1))}, median ${min(q(0.5))}, p90 ${min(q(0.9))}, max ${min(q(1))}`);
const in5to15 = lengths.filter((t) => t * TICK_MS >= 5 * 60000 && t * TICK_MS <= 15 * 60000).length;
console.log(`within 5-15 min: ${in5to15}/${lengths.length}`);
if (crashes || unfinished > games * 0.05) process.exitCode = 1;
