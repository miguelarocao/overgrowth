import { TEAM_BY_KEY, teamColor } from '../../../shared/teams';
import type { ClientGame } from '../game';
import type { View3D } from '../render/view3d';
import { el, esc } from './dom';
import { glyph } from './glyphs';

export interface HudActions {
  surrender(): void;
  leave(): void;
  backToLobby(): void;
  replay(id: string): void;
}

export class Hud {
  readonly root: HTMLElement;
  private q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
  private overShown = false;

  constructor(view: View3D, private act: HudActions, label: string, replay = false) {
    this.root = el(`
    <div class="hud">
      <header class="top">
        <div class="brand">
          <h1>Overgrowth</h1>
          <p><span id="turn">TURN 0</span> · ${esc(label)} <span class="status-pill" id="status" hidden></span></p>
        </div>
        <section class="panel board" aria-label="Players"><table><thead><tr><th>PLAYER</th><th>STEMS</th><th>LAND</th></tr></thead><tbody id="rows"></tbody></table></section>
      </header>
      <div class="bottom">
        ${replay ? '<div id="replay-slot"></div>' : `
        <section class="panel queue" aria-label="Your move queue" id="queue">
          <div class="queue-head"><span class="eyebrow" id="q-title">Your queue</span><span class="readout" id="readout" aria-live="polite">Queue empty</span></div>
          <div class="line"><span>Next step</span><b id="mode">All but one</b></div>
          <div class="line"><span>Selected stack</span><b id="sel">None</b></div>
          <div class="keys">Click a tile · <kbd>←↑→↓</kbd>/<kbd>WASD</kbd> move · <kbd>Z</kbd> half · <kbd>E</kbd> undo · <kbd>Q</kbd> clear · <kbd>H</kbd> home · <kbd>C</kbd> camera · right-drag pans</div>
        </section>`}
        <div class="panel controls">
          <label class="switch"><input type="checkbox" id="tilt"><span>Tilt-shift</span></label>
          <label class="slider"><span>Blur</span><input type="range" id="blur" min="0" max="1" step="0.01" aria-label="Tilt-shift strength"></label>
          <label class="switch"><input type="checkbox" id="top"><span>Top-down <kbd>C</kbd></span></label>
          ${replay ? '<button class="btn small" id="leave">Exit replay</button>' : '<button class="btn small danger" id="surrender">Surrender</button>'}
        </div>
      </div>
    </div>`);
    const tilt = this.q<HTMLInputElement>('#tilt');
    const blur = this.q<HTMLInputElement>('#blur');
    const top = this.q<HTMLInputElement>('#top');
    const sync = () => {
      tilt.checked = view.settings.tilt;
      blur.value = String(view.settings.blur);
      blur.disabled = !view.settings.tilt || view.settings.topDown;
      top.checked = view.settings.topDown;
    };
    sync();
    tilt.addEventListener('change', () => { view.update({ tilt: tilt.checked }); sync(); });
    blur.addEventListener('input', () => view.update({ blur: Number(blur.value) }));
    top.addEventListener('change', () => { view.update({ topDown: top.checked }); sync(); });
    this.syncControls = sync;
    this.root.querySelector('#surrender')?.addEventListener('click', () => {
      if (confirm('Surrender? Your land turns neutral and your mother plant becomes water.')) act.surrender();
    });
    this.root.querySelector('#leave')?.addEventListener('click', () => act.leave());
  }

  syncControls: () => void;

  slot(id: string) {
    return this.root.querySelector<HTMLElement>(`#${id}`);
  }

  setStatus(s: string) {
    const pill = this.q('#status');
    pill.hidden = s === 'open';
    pill.textContent = s === 'closed' ? 'RECONNECTING…' : s === 'connecting' ? 'CONNECTING…' : '';
    pill.classList.toggle('bad', s === 'closed');
  }

  update(g: ClientGame) {
    this.q('#turn').textContent = `TURN ${Math.floor(g.tick / 2)}`;
    const rows = [...g.players].sort((a, b) => Number(b.alive) - Number(a.alive) || b.land - a.land || b.stems - a.stems);
    this.q('#rows').innerHTML = rows.map((p) => `
      <tr class="${p.id === g.you ? 'me' : ''} ${p.alive ? '' : 'dead'}">
        <td><span class="who">${glyph(p.team, 16)}<span style="color:${teamColor(p.team)}">${esc(p.name)}</span>${!p.connected ? '<span class="dc" title="Disconnected">●</span>' : ''}</span></td>
        <td>${p.stems}</td><td>${p.land}</td>
      </tr>`).join('');
    const queue = this.root.querySelector('#queue');
    if (!queue) return;
    if (g.over) this.root.querySelector('#surrender')?.setAttribute('hidden', '');
    if (!g.alive) {
      this.q('#q-title').textContent = g.you === null ? 'Spectating' : 'Eliminated';
      this.q('#readout').textContent = 'Full view';
      this.q('#mode').textContent = '—';
      this.q('#sel').textContent = '—';
      this.root.querySelector('#surrender')?.setAttribute('hidden', '');
      return;
    }
    const n = g.queue.length;
    this.q('#readout').textContent = n ? `${n} ${n === 1 ? 'step' : 'steps'} · ${((n * g.tickMs) / 1000).toFixed(1)} s` : 'Queue empty';
    const mode = this.q('#mode');
    mode.textContent = g.halfNext ? 'Half (Z)' : 'All but one';
    mode.classList.toggle('half-on', g.halfNext);
    const sel = g.selection;
    const t = sel !== null ? g.tiles[sel] : null;
    this.q('#sel').textContent = t ? (t.owner === g.you ? `${t.stems} stems` : 'path end') : 'None';
  }

  gameOver(g: ClientGame, winner: number | null, replayId: string | null, canGoLobby: boolean) {
    if (this.overShown) return;
    this.overShown = true;
    const w = g.players.find((p) => p.id === winner);
    const youWon = winner !== null && winner === g.you;
    const box = el(`
      <div class="overlay"><section class="panel card" role="dialog" aria-label="Game over">
        <div class="eyebrow">Game over · turn ${Math.floor(g.tick / 2)}</div>
        <h2 class="title">${youWon ? 'You bloomed' : w ? `${esc(w.name)} wins` : 'Draw'}</h2>
        ${w ? `<p class="lede" style="display:flex;gap:8px;align-items:center">${glyph(w.team, 22)} ${esc(TEAM_BY_KEY[w.team]?.name ?? '')} took the city with ${w.land} ${w.land === 1 ? 'tile' : 'tiles'}.</p>` : ''}
        <div class="row">
          ${replayId ? '<button class="btn" id="watch">Watch replay</button>' : ''}
          <button class="btn" id="look">Look at the board</button>
          ${canGoLobby ? '<button class="btn primary" id="again">Back to lobby</button>' : ''}
          <button class="btn" id="home">Home</button>
        </div>
      </section></div>`);
    box.querySelector('#watch')?.addEventListener('click', () => this.act.replay(replayId!));
    box.querySelector('#look')!.addEventListener('click', () => box.remove());
    box.querySelector('#again')?.addEventListener('click', () => this.act.backToLobby());
    box.querySelector('#home')!.addEventListener('click', () => this.act.leave());
    this.root.appendChild(box);
  }
}
