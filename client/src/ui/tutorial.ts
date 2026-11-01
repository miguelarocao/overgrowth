// A short, hands-on tutorial. Each step waits for you to actually do the thing
// (or press Next), with a pointer badge on the board where it helps.
import type { ClientGame } from '../game';
import type { View3D } from '../render/view3d';
import type { Badge, World } from '../render/world';
import { el } from './dom';

const DONE_KEY = 'og-tutorial-done';

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true;
  }
}

function markDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface Step {
  html: string;
  /** Advance automatically when this becomes true. */
  done?: (g: ClientGame, s: Snapshot) => boolean;
  /** Tile to point at. */
  point?: (g: ClientGame) => number;
  onEnter?: (g: ClientGame) => void;
}

interface Snapshot {
  land: number;
  queued: number;
}

const motherOf = (g: ClientGame) => g.tiles.findIndex((t) => t.isMother && t.owner === g.you);
const landOf = (g: ClientGame) => g.players.find((p) => p.id === g.you)?.land ?? 0;

export class Tutorial {
  readonly root: HTMLElement;
  private k = 0;
  private start: Snapshot = { land: 0, queued: 0 };
  private maxQueue = 0;
  private steps: Step[];

  constructor(private game: ClientGame, private world: World, private view: View3D, private onClose: () => void) {
    this.steps = [
      {
        html: '<b>This big tree is your mother plant.</b> It grows 1 stem every turn. Lose it and you\'re out.',
        point: motherOf,
        onEnter: (g) => {
          const m = motherOf(g);
          if (m >= 0) this.view.focus(this.world.tilePos(m));
        }
      },
      {
        html: '<b>Click your mother plant</b> to select it. The white square shows your selection.',
        point: motherOf,
        onEnter: (g) => g.select(null),
        done: (g) => g.selection !== null && g.selection === motherOf(g)
      },
      {
        html: 'Now press an <kbd>arrow key</kbd> a few times. Each press queues a step and moves on, so you draw a path. <b>Queue 3 steps.</b>',
        done: (_g, s) => this.maxQueue >= 3 || landOf(this.game) >= s.land + 3
      },
      {
        html: 'Each step sends <b>all stems but one</b>, leaving 1 behind to claim the tile. The bright vine is the next step. <kbd>E</kbd> undoes a step, <kbd>Q</kbd> clears them all. <b>Claim 4 tiles.</b>',
        done: (g) => landOf(g) >= 4
      },
      {
        html: '<b>Fog</b> hides everything you haven\'t reached; only tall buildings poke through. Your growth lifts it. Bigger stacks grow bigger plants.',
      },
      {
        html: '💧 <b>Fire hydrants</b> are guarded by 40–50 stems, but once yours they grow +1 every turn, like a second mother plant. Build a big stack first. Surround a building and it gets overgrown 🌿.',
        point: (g) => {
          let best = -1, bd = Infinity;
          const m = motherOf(g);
          g.tiles.forEach((t, i) => {
            if (t.kind !== 'water' || i === g.fountain) return;
            const d = Math.abs((i % g.width) - (m % g.width)) + Math.abs(Math.floor(i / g.width) - Math.floor(m / g.width));
            if (d < bd) { bd = d; best = i; }
          });
          return best;
        }
      },
      {
        html: '<b>Camera:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or drag to pan, scroll to zoom, right-drag or <kbd>R</kbd> to rotate, <kbd>H</kbd> to jump home, <kbd>C</kbd> for a top-down map. Speeds are in ⚙ Settings.'
      },
      {
        html: '<kbd>Z</kbd> makes your next step send <b>half</b> instead, handy for splitting a stack. <kbd>1</kbd>–<kbd>6</kbd> send emotes.'
      },
      {
        html: '<b>To win:</b> find an enemy mother plant and capture it with a bigger stack. You take everything they had. Last mother standing wins. Have fun! 🌱'
      }
    ];
    this.root = el(`<section class="panel tutorial" role="dialog" aria-label="Tutorial" aria-live="polite">
      <div class="tut-head"><span class="eyebrow" id="tut-n"></span><button class="btn small" id="tut-skip">Skip tutorial</button></div>
      <p id="tut-text"></p>
      <div class="row"><button class="btn small" id="tut-back">Back</button><button class="btn small primary" id="tut-next">Next</button></div>
    </section>`);
    this.root.querySelector('#tut-skip')!.addEventListener('click', () => this.close());
    this.root.querySelector('#tut-next')!.addEventListener('click', () => this.go(this.k + 1));
    this.root.querySelector('#tut-back')!.addEventListener('click', () => this.go(this.k - 1));
    this.go(0);
  }

  private go(k: number) {
    if (k >= this.steps.length) return this.close();
    this.k = Math.max(0, k);
    const s = this.steps[this.k];
    this.start = { land: landOf(this.game), queued: this.game.queue.length };
    this.maxQueue = 0;
    s.onEnter?.(this.game);
    this.root.querySelector('#tut-n')!.textContent = `Tutorial · ${this.k + 1} of ${this.steps.length}`;
    this.root.querySelector('#tut-text')!.innerHTML = s.html;
    const next = this.root.querySelector<HTMLButtonElement>('#tut-next')!;
    next.textContent = this.k === this.steps.length - 1 ? 'Let\'s grow' : s.done ? 'Skip step' : 'Next';
    next.classList.toggle('primary', !s.done);
    this.root.querySelector<HTMLButtonElement>('#tut-back')!.hidden = this.k === 0;
  }

  /** Call after every game update; advances steps that wait for an action. */
  check() {
    if (!this.game.alive) return this.close(false); // eliminated or surrendered: not the time
    const s = this.steps[this.k];
    this.maxQueue = Math.max(this.maxQueue, this.game.queue.length);
    if (s?.done?.(this.game, this.start)) this.go(this.k + 1);
  }

  badges(): Badge[] {
    const s = this.steps[this.k];
    const i = s?.point?.(this.game) ?? -1;
    if (i < 0) return [];
    const pulse = Math.sin(performance.now() * 0.006) * 0.08;
    const y = this.game.tiles[i].isMother ? 3.0 : 1.0;
    return [{ pos: this.world.tilePos(i, y + pulse), text: this.k === 1 ? '👇 click' : '👇', ring: '#FFFFFF', ghost: false }];
  }

  close(finished = true) {
    if (finished) markDone();
    this.root.remove();
    this.onClose();
  }
}
