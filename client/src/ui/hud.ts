import { EMOTES } from '../../../shared/config';
import type { Award } from '../../../shared/awards';
import type { Weather } from '../../../shared/protocol';
import { TEAM_BY_KEY, teamColor } from '../../../shared/teams';
import { sfx } from '../audio';
import type { ClientGame } from '../game';
import { DEFAULT_VIEW, type View3D } from '../render/view3d';
import { el, esc } from './dom';
import { glyph } from './glyphs';

export interface HudActions {
  surrender(): void;
  leave(): void;
  backToLobby(): void;
  replay(id: string): void;
  emote?(e: number): void;
  tutorial?(): void;
}

const WIN_TITLES = ['You bloomed', 'Total overgrowth', 'Concrete never stood a chance', 'Garden party'];
const LOSE_TITLES = ['Composted', 'Pruned', 'Back to seed', 'Wilted'];
const pickOf = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function compass(cx: number, cy: number, w: number, h: number) {
  const dx = cx / w - 0.5, dy = cy / h - 0.5;
  const ns = dy < -0.15 ? 'north' : dy > 0.15 ? 'south' : '';
  const ew = dx < -0.15 ? 'west' : dx > 0.15 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'middle';
}

export class Hud {
  readonly root: HTMLElement;
  private q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
  private overShown = false;
  private emotes = new Map<number, { e: number; until: number }>();

  constructor(view: View3D, private act: HudActions, label: string, replay = false) {
    this.root = el(`
    <div class="hud">
      <header class="top">
        <div class="brand">
          <h1>Overgrowth</h1>
          <p><span id="turn">TURN 0</span> · ${esc(label)} <span class="status-pill" id="status" hidden></span></p>
        </div>
        <div class="weather" id="weather" hidden aria-live="polite"></div>
        <section class="panel board" aria-label="Players"><table><thead><tr><th>PLAYER</th><th>STEMS</th><th>LAND</th></tr></thead><tbody id="rows"></tbody></table></section>
      </header>
      <div class="bottom">
        ${replay ? '<div id="replay-slot"></div>' : `
        <section class="panel queue" aria-label="Your move queue" id="queue">
          <div class="queue-head"><span class="eyebrow" id="q-title">Your queue</span><span class="readout" id="readout" aria-live="polite">Queue empty</span></div>
          <div class="line"><span>Next step</span><b id="mode">All but one</b></div>
          <div class="line"><span>Selected stack</span><b id="sel">None</b></div>
          <div class="keys">Click a tile · <kbd>←↑→↓</kbd> grow · <kbd>Z</kbd> half · <kbd>E</kbd> undo · <kbd>Q</kbd> clear<br><kbd>WASD</kbd>/drag pan · scroll zoom · right-drag or <kbd>R</kbd> rotate · <kbd>H</kbd> home · <kbd>C</kbd> top-down</div>
        </section>`}
        <div class="panel emotes" aria-label="Emotes" ${replay ? 'hidden' : ''}>
          ${EMOTES.map((e, k) => `<button class="emote" data-e="${k}" title="${e.label} (${k + 1})" aria-label="Emote: ${e.label}">${e.emoji}<kbd>${k + 1}</kbd></button>`).join('')}
        </div>
        <section class="panel settings" id="settings" hidden aria-label="Camera settings">
          <div class="eyebrow">View</div>
          <label class="slider"><span>Rotate speed</span><input type="range" id="s-rot" min="0.05" max="1.2" step="0.05"></label>
          <label class="slider"><span>Pan speed</span><input type="range" id="s-pan" min="0.3" max="3" step="0.1"></label>
          <label class="slider"><span>Zoom speed</span><input type="range" id="s-zoom" min="0.3" max="3" step="0.1"></label>
          <label class="switch"><input type="checkbox" id="s-drag"><span>Left-drag pans (off: left-drag rotates)</span></label>
          <label class="switch"><input type="checkbox" id="s-map"><span>Map colours in top-down</span></label>
          <label class="switch"><input type="checkbox" id="s-clouds"><span>Clouds over unexplored areas</span></label>
          <button class="btn small" id="s-reset">Reset to defaults</button>
        </section>
        <div class="panel controls">
          <label class="switch"><input type="checkbox" id="sound"><span>Sound <kbd>M</kbd></span></label>
          <label class="switch"><input type="checkbox" id="top"><span>Top-down <kbd>C</kbd></span></label>
          <button class="btn small" id="gear" aria-expanded="false" aria-controls="settings" title="Camera settings">⚙ Settings</button>
          <button class="btn small" id="help" title="Tutorial">?</button>
          ${replay ? '<button class="btn small" id="leave">Exit replay</button>' : '<button class="btn small danger" id="surrender">Surrender</button>'}
        </div>
      </div>
    </div>`);
    const top = this.q<HTMLInputElement>('#top');
    const rot = this.q<HTMLInputElement>('#s-rot'), pan = this.q<HTMLInputElement>('#s-pan'), zoom = this.q<HTMLInputElement>('#s-zoom');
    const drag = this.q<HTMLInputElement>('#s-drag'), map = this.q<HTMLInputElement>('#s-map'), clouds = this.q<HTMLInputElement>('#s-clouds');
    const sync = () => {
      const s = view.settings;
      top.checked = s.topDown;
      rot.value = String(s.rotateSpeed);
      pan.value = String(s.panSpeed);
      zoom.value = String(s.zoomSpeed);
      drag.checked = s.dragPans;
      map.checked = s.mapLayer;
      clouds.checked = s.driftClouds;
    };
    sync();
    top.addEventListener('change', () => { view.update({ topDown: top.checked }); sync(); });
    rot.addEventListener('input', () => view.update({ rotateSpeed: Number(rot.value) }));
    pan.addEventListener('input', () => view.update({ panSpeed: Number(pan.value) }));
    zoom.addEventListener('input', () => view.update({ zoomSpeed: Number(zoom.value) }));
    drag.addEventListener('change', () => view.update({ dragPans: drag.checked }));
    map.addEventListener('change', () => view.update({ mapLayer: map.checked }));
    clouds.addEventListener('change', () => view.update({ driftClouds: clouds.checked }));
    this.q('#s-reset').addEventListener('click', () => { view.update({ ...DEFAULT_VIEW, topDown: view.settings.topDown }); sync(); });
    const gear = this.q('#gear'), panel = this.q('#settings');
    gear.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      gear.setAttribute('aria-expanded', String(!panel.hidden));
    });
    this.q('#help').addEventListener('click', () => act.tutorial?.());
    this.syncControls = sync;
    const sound = this.q<HTMLInputElement>('#sound');
    sound.checked = !sfx.muted;
    sound.addEventListener('change', () => sfx.setMuted(!sound.checked));
    this.root.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => b.addEventListener('click', () => act.emote?.(Number(b.dataset.e))));
    this.root.querySelector('#surrender')?.addEventListener('click', () => {
      if (confirm('Surrender? Your land turns neutral and your mother plant becomes water.')) act.surrender();
    });
    this.root.querySelector('#leave')?.addEventListener('click', () => act.leave());
  }

  syncControls: () => void;

  slot(id: string) {
    return this.root.querySelector<HTMLElement>(`#${id}`);
  }

  syncSound() {
    this.q<HTMLInputElement>('#sound').checked = !sfx.muted;
  }

  /** Big centred text for moments that matter (combos, eliminations). */
  callout(text: string, sub = '', color = '#FFFFFF') {
    this.root.querySelector('.callout')?.remove();
    const c = el(`<div class="callout" role="status"><div class="big" style="color:${color}">${esc(text)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`);
    this.root.appendChild(c);
    setTimeout(() => c.remove(), 2200);
  }

  showEmote(player: number | null, e: number) {
    if (player === null) return;
    this.emotes.set(player, { e, until: performance.now() + 3500 });
  }

  setWeather(w: Weather, g: ClientGame) {
    const box = this.q('#weather');
    const sh = w.now ?? w.next;
    box.hidden = !sh;
    if (!sh) return;
    const where = compass(sh.x + sh.size / 2, sh.y + sh.size / 2, g.width, g.height);
    if (w.now) box.innerHTML = `<b>☔ Spring shower</b> over the ${where}: land under the cloud grows +1 a turn · ${Math.ceil((sh.end - g.tick) / 2)} turns left`;
    else box.innerHTML = `<b>☁️ Clouds gathering</b> over the ${where} · rain in ${Math.ceil((sh.start - g.tick) / 2)} turns`;
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
    const now = performance.now();
    this.q('#rows').innerHTML = rows.map((p, rank) => {
      const em = this.emotes.get(p.id);
      const bubble = em && em.until > now ? `<span class="bubble" title="${esc(EMOTES[em.e].label)}">${EMOTES[em.e].emoji}<small>${esc(EMOTES[em.e].label)}</small></span>` : '';
      const crown = rank === 0 && p.alive && g.tick > 60 ? '<span class="crown" title="Biggest garden">👑</span>' : '';
      return `
      <tr class="${p.id === g.you ? 'me' : ''} ${p.alive ? '' : 'dead'}">
        <td><span class="who">${glyph(p.team, 16)}<span style="color:${teamColor(p.team)}">${esc(p.name)}</span>${crown}${!p.connected ? '<span class="dc" title="Disconnected">●</span>' : ''}${bubble}</span></td>
        <td>${p.stems}</td><td>${p.land}</td>
      </tr>`;
    }).join('');
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

  gameOver(g: ClientGame, winner: number | null, replayId: string | null, canGoLobby: boolean, awards: Award[] = []) {
    if (this.overShown) return;
    this.overShown = true;
    const w = g.players.find((p) => p.id === winner);
    const youWon = winner !== null && winner === g.you;
    const box = el(`
      <div class="overlay"><section class="panel card" role="dialog" aria-label="Game over">
        <div class="eyebrow">Game over · turn ${Math.floor(g.tick / 2)}</div>
        <h2 class="title">${youWon ? pickOf(WIN_TITLES) : g.you !== null && w ? pickOf(LOSE_TITLES) : w ? `${esc(w.name)} wins` : 'Draw'}</h2>
        ${w ? `<p class="lede" style="display:flex;gap:8px;align-items:center">${glyph(w.team, 22)} ${youWon ? `Your ${esc(TEAM_BY_KEY[w.team]?.name.toLowerCase() ?? 'garden')}` : esc(w.name)} took the city with ${w.land} ${w.land === 1 ? 'tile' : 'tiles'}.</p>` : ''}
        ${awards.length ? `<ul class="awards">${awards.map((a) => {
          const p = g.players.find((x) => x.id === a.player);
          return `<li><span class="icon">${a.icon}</span><span><b>${esc(a.title)}</b><span class="who">${p ? glyph(p.team, 14) : ''} ${esc(p?.name ?? '?')}</span><small>${esc(a.detail)}</small></span></li>`;
        }).join('')}</ul>` : ''}
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
