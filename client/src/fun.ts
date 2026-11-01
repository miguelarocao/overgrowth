// Feedback, juice and easter eggs. Reacts to what the player can already see;
// never reveals anything hidden.
import * as THREE from 'three';
import { EMOTES } from '../../shared/config';
import type { Award } from '../../shared/awards';
import type { ServerMsg } from '../../shared/protocol';
import { TEAMS, teamColor } from '../../shared/teams';
import type { ViewTile } from '../../shared/types';
import { sfx } from './audio';
import type { ClientGame, TickChanges } from './game';
import type { View3D } from './render/view3d';
import type { World } from './render/world';
import { season } from './render/critters';
import { esc, toast } from './ui/dom';
import { glyph } from './ui/glyphs';
import type { Hud } from './ui/hud';

type TickMsg = Extract<ServerMsg, { t: 'tick' }>;

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const STREAKS: [number, string, string][] = [
  [5, 'Spreading!', '#B9E6A0'],
  [10, 'Rampant!', '#7FE07F'],
  [18, 'Unstoppable overgrowth!', '#FFD66B'],
  [30, 'Botanical domination', '#FF9AD5']
];
const FORTUNES = [
  'May your stems be many and your queues be short.',
  'A tall tree was once a stubborn seed.',
  'The concrete remembers. The roots do not care.',
  'Someone nearby is about to make a terrible move. Let it be them.',
  'Today is a good day to be slightly larger than your neighbour.',
  'Water the plants you want to grow. Including coworkers.',
  'Half is sometimes more than all but one.',
  'The fountain thanks you for your coin. It has nowhere to spend it.',
  'You will find what you seek beyond the smog.',
  'Patience is a mother plant with 300 stems.'
];
const UPROOT_LINES = [
  (v: string, b: string) => `${b} uprooted ${v}`,
  (v: string, b: string) => `${v} got composted by ${b}`,
  (v: string, b: string) => `${b} turned ${v} into mulch`,
  (v: string, b: string) => `${v} was weeded out by ${b}`,
  (v: string, b: string) => `${b} pruned ${v} for good`
];
const pickOf = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** Console greeting for the curious. */
export function greetConsole() {
  console.log(
    '%c  _\\|/_\n  (o o)    OVERGROWTH\n ooO-(_)-Ooo\n',
    'color:#7FC468;font-family:monospace;font-weight:bold'
  );
  console.log(
    '%cLooking for the hidden map? The server never sends tiles you can\'t see, so there\'s nothing to find here.\nThere ARE secrets, though. Try typing "joy" in a game. 🌱',
    'color:#B8B4A9'
  );
}

export class Fun {
  private streak = 0;
  private quiet = 0;
  private firstUproot = true;
  private raining = false;
  private keys: string[] = [];
  private queuedDuring: number[] = [];
  private sneeze: number[] = [];
  private pets = 0;
  private lastInput = performance.now();
  private lastNag = 0;
  private halfCity = false;
  private letters = '';

  constructor(private game: ClientGame, private world: World, private view: View3D, private hud: Hud, private send: (m: any) => void) {
    const s = season();
    if (s === 'halloween') setTimeout(() => toast('🎃 Spooky season. Something is glowing on the rooftops.', 4500), 7000);
    if (s === 'winter') setTimeout(() => toast('✨ The city put its lights up. Even the abandoned bits.', 4500), 7000);
  }

  private get me() {
    return this.game.you;
  }

  private team(pid: number | null) {
    return this.game.teamOf(pid) ?? 'glory';
  }

  /** Snapshot tiles before a tick is applied, so we can see what changed hands. */
  snapshot(msg: TickMsg): Map<number, ViewTile> {
    const snap = new Map<number, ViewTile>();
    for (const d of msg.changedTiles) snap.set(d[0], { ...this.game.tiles[d[0]] });
    return snap;
  }

  onTick(before: Map<number, ViewTile>, ch: TickChanges, msg: TickMsg) {
    const g = this.game, me = this.me, now = performance.now();
    let gained = 0;
    let lost = 0;
    if (msg.changedTiles.length < 200) {
      for (const [i, prev] of before) {
        const t = g.tiles[i];
        if (!t.visible || !prev.visible) continue;
        if (me !== null && t.owner === me && prev.owner !== me) {
          gained++;
          if (t.kind === 'water' && !prev.isMother) {
            sfx.splash();
            this.view.float(this.world.tilePos(i, 0.9), '💧 +1 / turn', '#CFE3EA', 16, 1500);
          }
        } else if (me !== null && prev.owner === me && t.owner !== me) {
          lost++;
          if (lost <= 3) this.view.float(this.world.tilePos(i, 0.7), '−', '#FF7A6A', 22, 700);
        }
      }
    }
    if (gained && ch.executed) {
      this.streak++;
      this.quiet = 0;
      sfx.pluck(Math.min(this.streak, 14));
      const hit = STREAKS.filter(([n]) => this.streak === n).pop();
      if (hit) {
        this.hud.callout(hit[1], `${this.streak} captures in a row`, hit[2]);
        sfx.callout(STREAKS.indexOf(hit));
      }
    } else if (++this.quiet > 2) this.streak = 0;
    if (lost) sfx.lose();
    // A step that bounced off (attack too small).
    if (!ch.executed && ch.dropped.length) {
      const first = ch.dropped[0];
      const to = g.dest(first);
      if (to >= 0 && g.tiles[to].visible && g.tiles[to].owner !== me) {
        sfx.thud();
        this.view.float(this.world.tilePos(to, 0.8), pickOf(['bonk!', 'thorns!', 'too small!', 'nope']), '#FFB36B', 15, 900);
      }
    }
    // Half the city: a one-off cheer.
    const mine = g.players.find((p) => p.id === me);
    const open = g.tiles.filter((t) => t.kind !== 'building').length;
    if (mine && !this.halfCity && mine.land * 2 >= open) {
      this.halfCity = true;
      this.hud.callout('Half the city is yours', 'the concrete is nervous', teamColor(this.team(me)));
      sfx.fanfare();
    }
    // Weather.
    this.world.setWeather(msg.weather);
    this.hud.setWeather(msg.weather, g);
    const raining = !!msg.weather.now;
    if (raining !== this.raining) {
      this.raining = raining;
      sfx.setRain(raining);
      if (raining) this.hud.callout('Spring shower!', 'land under the cloud grows every turn', '#CFE3EA');
    }
    // A gentle nudge if you've been idle with a fat mother plant.
    if (g.alive && !g.over && !g.queue.length && now - this.lastInput > 45000 && now - this.lastNag > 90000) {
      const mother = g.tiles.find((t) => t.isMother && t.owner === me);
      if (mother && mother.stems >= 40) {
        this.lastNag = now;
        toast(`🪴 Your mother plant is sitting on ${mother.stems} stems. Gardens don't grow themselves (well, they do, slowly).`, 6000);
      }
    }
  }

  onEliminated(m: Extract<ServerMsg, { t: 'eliminated' }>) {
    const g = this.game;
    const v = g.players.find((x) => x.id === m.player);
    const b = m.by !== null ? g.players.find((x) => x.id === m.by) : null;
    if (!v) return;
    const first = this.firstUproot && !!b;
    if (b) this.firstUproot = false;
    if (m.player === this.me) {
      this.hud.callout(b ? 'Composted' : 'You threw in the trowel', b ? `uprooted by ${esc(b.name)}. You can still watch (and emote).` : 'the city remembers you fondly', '#FF8A7A');
      sfx.sadTrombone();
      this.view.shake(0.5, 700);
      return;
    }
    if (b && m.by === this.me) {
      this.hud.callout('Uprooted!', `${glyph(v.team, 16)} ${esc(v.name)} is now compost`, teamColor(this.team(this.me)));
      sfx.fanfare();
      this.view.shake(0.45, 600);
      return;
    }
    const line = b ? pickOf(UPROOT_LINES)(esc(v.name), esc(b.name)) : `${esc(v.name)} threw in the trowel`;
    toast(`${glyph(v.team, 16)} ${first ? '<b>First uproot!</b> ' : ''}${line}`, 4500);
    sfx.chime();
  }

  onGameOver(m: Extract<ServerMsg, { t: 'gameOver' }>, canGoLobby: boolean) {
    const g = this.game;
    sfx.setRain(false);
    if (m.winner !== null && m.winner === this.me) {
      sfx.fanfare();
      const c = teamColor(this.team(this.me));
      this.world.confetti([c, '#FFFFFF', '#FFD66B', c]);
      setTimeout(() => this.world.confetti([c, '#F5A7C7', '#7FC468']), 900);
    } else if (this.me === null || !g.alive) sfx.chime();
    setTimeout(() => this.hud.gameOver(g, m.winner, m.replayId, canGoLobby, m.awards as Award[]), 900);
  }

  emote(e: number) {
    this.send({ t: 'emote', e });
  }

  onEmote(m: Extract<ServerMsg, { t: 'emote' }>) {
    this.hud.showEmote(m.player, m.e);
    this.hud.update(this.game);
    sfx.emote();
    if (m.player === null) toast(`${EMOTES[m.e].emoji} <b>${esc(m.name)}</b> ${esc(EMOTES[m.e].label)}`, 2500);
    setTimeout(() => this.hud.update(this.game), 3600);
  }

  /** Keyboard hook. Returns true if the key was an easter egg and shouldn't do anything else. */
  onKey(key: string, queuedStep: boolean) {
    this.lastInput = performance.now();
    // Konami code: arrows also queue moves, so undo the ones the code itself queued.
    this.keys.push(key);
    this.queuedDuring.push(queuedStep ? 1 : 0);
    if (this.keys.length > KONAMI.length) {
      this.keys.shift();
      this.queuedDuring.shift();
    }
    if (this.keys.join(',') === KONAMI.join(',')) {
      const n = this.queuedDuring.reduce((a, b) => a + b, 0);
      for (let k = 0; k < n; k++) this.game.undo();
      this.keys = [];
      this.disco();
      return true;
    }
    if (/^[a-z]$/.test(key)) {
      this.letters = (this.letters + key).slice(-8);
      if (this.letters.endsWith('joy')) this.joy();
      else if (this.letters.endsWith('buzz')) this.bees();
      else if (this.letters.endsWith('photo')) this.photo();
    }
    return false;
  }

  disco() {
    this.world.discoUntil = performance.now() + 15000;
    sfx.disco();
    const t = setInterval(() => sfx.disco(), 1150);
    setTimeout(() => clearInterval(t), 14000);
    toast('🪩 Disco garden! The plants have been waiting for this.', 4000);
  }

  joy() {
    this.world.confetti(TEAMS.map((t) => t.color));
    [0, 2, 4, 7, 9, 12].forEach((n, k) => setTimeout(() => sfx.pluck(n + 5), k * 90));
    toast('✨ Joy, sparked.', 3000);
  }

  bees() {
    const g = this.game;
    const on = !this.world.critters.hasBees;
    const home = g.tiles.findIndex((t) => t.isMother && t.owner === g.you);
    const spot = home >= 0 ? home : g.selection ?? Math.floor(g.tiles.length / 2);
    this.world.critters.setBees(on ? this.world.tilePos(spot, home >= 0 ? 1.7 : 0.6) : null);
    sfx.buzz();
    toast(on ? '🐝 The bees have arrived. They are very supportive.' : '🐝 The bees have other gardens to visit.', 3000);
  }

  photo() {
    this.hud.root.style.visibility = 'hidden';
    toast('📸 Say cheese! HUD hidden for 6 seconds.', 1500);
    setTimeout(() => (this.hud.root.style.visibility = ''), 6000);
  }

  /** Click hook, before tile selection. Returns true if the click was used up. */
  onClick(x: number, y: number, tile: number): boolean {
    this.lastInput = performance.now();
    const w = this.world, now = performance.now();
    const hit = this.view.pickObject(x, y, [...w.critters.clickables(), ...w.billboards]);
    if (hit) {
      if (hit === w.critters.cat) {
        this.pets++;
        w.critters.pet(now);
        sfx.purr();
        const at = hit.getWorldPosition(new THREE.Vector3());
        for (let k = 0; k < 3; k++) setTimeout(() => this.view.float(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3, 0)), '♥', '#FF8FB8', 18, 1000), k * 120);
        if (this.pets === 5) { sfx.meow(); toast('🐈 The rooftop cat approves of your gardening.'); }
        if (this.pets === 20) { sfx.meow(); toast('🐈 The rooftop cat has adopted you. There is no going back.'); }
        return true;
      }
      const pigeon = w.critters.pigeonOf(hit);
      if (pigeon) {
        sfx.coo();
        setTimeout(() => sfx.flap(), 250);
        this.view.float(hit.getWorldPosition(new THREE.Vector3()), pickOf(['coo!', 'coo?', 'COO.']), '#E8EEF2', 14, 900);
        w.critters.fly(pigeon, now);
        return true;
      }
      if (w.critters.pumpkins.includes(hit as any)) {
        sfx.boo();
        this.view.float(hit.getWorldPosition(new THREE.Vector3()), 'BOO!', '#FFB04A', 20, 1100);
        return true;
      }
      if (w.billboards.includes(hit as any)) {
        w.flipBillboard(hit);
        sfx.tick(3);
        return true;
      }
    }
    if (tile < 0) return false;
    const g = this.game;
    const t = g.tiles[tile];
    // Your own mother plant: click it seven times quickly and it sneezes.
    if (t.isMother && t.owner === g.you) {
      this.sneeze = [...this.sneeze.filter((s) => now - s < 4000), now];
      if (this.sneeze.length >= 7) {
        this.sneeze = [];
        sfx.sneeze();
        setTimeout(() => {
          w.burst(tile, ['#F6E27A', '#FFF3B0', '#E8C840'], 120, 1.4, 1.6);
          this.view.shake(0.15, 300);
          toast('🤧 Bless you!', 2000);
        }, 600);
      }
      return false;
    }
    if (t.owner === g.you && g.alive) return false;
    if (tile === g.fountain) {
      sfx.coin();
      toast(`🪙 You toss a coin in the fountain. <i>${esc(pickOf(FORTUNES))}</i>`, 6000);
      setTimeout(() => w.burst(tile, ['#CFE3EA', '#A9C3CE'], 30, 0.6, 0.2), 450);
      return false;
    }
    if (t.kind === 'water') {
      sfx.splash();
      w.burst(tile, ['#CFE3EA', '#A9C3CE', '#FFFFFF'], 30, 0.7, 0.1);
    }
    return false;
  }
}
