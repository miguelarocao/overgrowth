import { MAX_PLAYERS, PACES, TIME_LIMITS, boardSize, type Pace } from '../../../shared/config';
import { sfx } from '../audio';
import type { LobbyPlayer, RoomOptions } from '../../../shared/protocol';
import { TEAMS, TEAM_BY_KEY } from '../../../shared/teams';
import { el, esc, savedName } from './dom';
import { glyph } from './glyphs';

function randomCode() {
  const words = ['moss', 'fern', 'ivy', 'root', 'seed', 'vine', 'bud', 'leaf', 'thorn', 'stem', 'petal', 'bloom'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.random().toString(36).slice(2, 6)}`;
}

export function homeScreen(go: (path: string) => void): HTMLElement {
  const root = el(`
  <div class="center">
    <section class="panel card" aria-labelledby="home-title">
      <div>
        <h1 class="title" id="home-title">Overgrowth</h1>
        <p class="lede">Rival flowering plants take over an abandoned city. Grow your stems, claim the streets, uproot every other mother plant.</p>
      </div>
      <label class="field"><span class="eyebrow">Your name</span>
        <input class="input" id="name" maxlength="20" autocomplete="nickname" placeholder="Gardener"></label>
      <div class="row">
        <button class="btn primary grow" id="create">Create a room</button>
        <button class="btn grow" id="offline">Play offline vs bots</button>
      </div>
      <button class="btn" id="tutorial">New here? Play the 2-minute tutorial</button>
      <form class="row" id="join">
        <input class="input grow" id="code" placeholder="Room code, e.g. moss-4k2p" aria-label="Room code" autocomplete="off">
        <button class="btn" type="submit">Join</button>
      </form>
      <div>
        <div class="eyebrow" style="margin-bottom:6px">How to play</div>
        <ul class="rules">
          <li><b>Click</b> one of your tiles, then press the <b>arrow keys</b> to send its stems. Each press queues a step and moves on, so you can draw a path. <b>WASD</b> moves the camera.</li>
          <li>Each step sends all stems but one. <kbd>Z</kbd> sends half on the next step. <kbd>E</kbd> (or <kbd>Backspace</kbd>) undoes, <kbd>Q</kbd> clears.</li>
          <li>Mother plants and water you own grow 1 stem per turn. All your land grows 1 every 25 turns.</li>
          <li>Capture a rival's mother plant to take everything they have. Last mother standing wins.</li>
        </ul>
      </div>
    </section>
  </div>`);
  // Poke the title a few times and it starts sprouting.
  const title = root.querySelector<HTMLElement>('#home-title')!;
  let pokes = 0;
  title.addEventListener('click', () => {
    pokes++;
    sfx.pluck(pokes);
    if (pokes >= 3 && pokes <= 12) title.insertAdjacentHTML('beforeend', `<span class="sprout">${['🌱', '🌿', '🌸', '🌼', '🍃'][pokes % 5]}</span>`);
    if (pokes === 12) title.insertAdjacentHTML('afterend', '<p class="note">Okay, okay. It\'s overgrown now. Happy?</p>');
  });
  const name = root.querySelector<HTMLInputElement>('#name')!;
  name.value = savedName.get();
  name.addEventListener('input', () => savedName.set(name.value.trim()));
  root.querySelector('#create')!.addEventListener('click', () => go(`/r/${randomCode()}`));
  root.querySelector('#offline')!.addEventListener('click', () => go('/offline'));
  root.querySelector('#tutorial')!.addEventListener('click', () => go('/offline?tutorial=1'));
  root.querySelector('#join')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = root.querySelector<HTMLInputElement>('#code')!.value.trim().toLowerCase();
    const code = raw.replace(/^.*\/r\//, '').replace(/[^a-z0-9-]/g, '');
    if (code.length >= 3) go(`/r/${code}`);
  });
  return root;
}

export interface LobbyActions {
  send: (m: any) => void;
  leave: () => void;
}

/** "Fill with bots" tops up to the next of 4, 8, 12 or 16 players. */
const fillTarget = (n: number) => Math.min(MAX_PLAYERS, (Math.floor(n / 4) + 1) * 4);

const PACE_LABEL: Record<Pace, string> = { relaxed: 'Relaxed', brisk: 'Brisk', frantic: 'Frantic' };

export function lobbyScreen(msg: { code: string; players: LobbyPlayer[]; host: number | null; you: number | null; options: RoomOptions }, offline: boolean, act: LobbyActions): HTMLElement {
  const me = msg.players.find((p) => p.seat === msg.you);
  const isHost = msg.you !== null && msg.you === msg.host;
  const link = `${location.origin}/r/${msg.code}`;
  const taken = new Set(msg.players.filter((p) => p.seat !== msg.you).map((p) => p.team));
  const full = msg.players.length >= MAX_PLAYERS;
  const root = el(`
  <div class="center">
    <section class="panel card" aria-labelledby="lobby-title">
      <div class="row" style="justify-content:space-between">
        <h1 class="title" id="lobby-title" style="font-size:44px">${offline ? 'Offline' : 'Lobby'}</h1>
        <button class="btn small" id="leave">Leave</button>
      </div>
      ${offline ? '<p class="note">Practice against bots in this tab. Nothing is sent to a server.</p>' : `
      <div class="field"><span class="eyebrow">Invite link</span>
        <div class="share"><code>${esc(link)}</code><button class="btn small" id="copy">Copy</button></div></div>`}
      <div class="field"><span class="eyebrow">Players ${msg.players.length}/${MAX_PLAYERS} · ${boardSize(msg.players.length)}×${boardSize(msg.players.length)} map</span>
        <ul class="players">
          ${msg.players.map((p) => `
            <li class="${p.connected ? '' : 'off'}">${glyph(p.team, 20)}
              <span>${esc(p.name)}</span>
              ${p.seat === msg.you ? '<span class="tag">YOU</span>' : ''}
              ${p.seat === msg.host ? '<span class="tag">HOST</span>' : ''}
              ${p.bot ? '<span class="tag">BOT</span>' : ''}
              ${!p.connected ? '<span class="tag">RECONNECTING…</span>' : ''}
              <span class="spacer"></span>
              <span class="tag">${esc(TEAM_BY_KEY[p.team]?.name ?? p.team)}</span>
              ${isHost && p.bot ? `<button class="btn small" data-remove="${p.seat}" aria-label="Remove ${esc(p.name)}">Remove</button>` : ''}
            </li>`).join('')}
        </ul></div>
      <div class="field"><span class="eyebrow">Garden rules ${isHost ? '' : '· set by the host'}</span>
        <div class="options">
          <span class="seg" role="group" aria-label="Spring showers">
            <button data-showers="1" aria-pressed="${msg.options.showers}" ${isHost ? '' : 'disabled'}>☔ Showers on</button>
            <button data-showers="0" aria-pressed="${!msg.options.showers}" ${isHost ? '' : 'disabled'}>Off</button>
          </span>
          <span class="seg" role="group" aria-label="Pace">
            ${(Object.keys(PACES) as Pace[]).map((p) => `<button data-pace="${p}" aria-pressed="${msg.options.pace === p}" ${isHost ? '' : 'disabled'}>${PACE_LABEL[p]}</button>`).join('')}
          </span>
          <span class="seg" role="group" aria-label="Time limit">
            ${TIME_LIMITS.map((m) => `<button data-limit="${m}" aria-pressed="${(msg.options.timeLimit ?? 0) === m}" ${isHost ? '' : 'disabled'}>${m ? `${m} min` : '⏱ No limit'}</button>`).join('')}
          </span>
        </div>
        <span class="note">${msg.options.showers ? 'A rain cloud drifts over part of the city now and then. Land under it grows every turn: worth fighting over.' : 'Classic rules.'} ${msg.options.pace === 'relaxed' ? '2 ticks a second.' : msg.options.pace === 'brisk' ? 'About 3 ticks a second.' : '4 ticks a second. Hold on to your leaves.'} ${msg.options.timeLimit ? `After ${msg.options.timeLimit} minutes the biggest garden (most land) wins.` : 'Play until one mother plant is left.'}</span>
      </div>
      ${me ? `
      <label class="field"><span class="eyebrow">Your name</span>
        <input class="input" id="rename" maxlength="20" value="${esc(me.name)}"></label>
      <div class="field"><span class="eyebrow">Your team</span>
        <div class="teams">
          ${TEAMS.map((t) => `<button class="team" data-team="${t.key}" aria-pressed="${me.team === t.key}" ${taken.has(t.key) ? 'disabled' : ''}>${glyph(t.key, 18)}<span>${esc(t.name)}</span></button>`).join('')}
        </div></div>` : '<p class="note">The room is full. You are spectating; you will see the whole board.</p>'}
      ${isHost ? `
      <div class="row">
        <button class="btn grow" id="bot" ${full ? 'disabled' : ''}>Add bot</button>
        <button class="btn grow" id="fill" ${full ? 'disabled' : ''}>Fill to ${fillTarget(msg.players.length)} with bots</button>
        <button class="btn primary grow" id="start" ${msg.players.length < 2 ? 'disabled' : ''}>Start game</button>
      </div>
      ${msg.players.length < 2 ? '<p class="note">Need at least 2 players. Share the link or add a bot.</p>' : ''}` : '<p class="note">Waiting for the host to start…</p>'}
    </section>
  </div>`);
  root.querySelector('#leave')!.addEventListener('click', act.leave);
  root.querySelector('#copy')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(link);
      (e.target as HTMLButtonElement).textContent = 'Copied';
    } catch {
      /* clipboard blocked */
    }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) => b.addEventListener('click', () => act.send({ t: 'pickTeam', team: b.dataset.team })));
  root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => act.send({ t: 'removeBot', seat: Number(b.dataset.remove) })));
  const rename = root.querySelector<HTMLInputElement>('#rename');
  rename?.addEventListener('change', () => {
    savedName.set(rename.value.trim());
    act.send({ t: 'rename', name: rename.value });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-showers]').forEach((b) => b.addEventListener('click', () => act.send({ t: 'setOptions', showers: b.dataset.showers === '1' })));
  root.querySelectorAll<HTMLButtonElement>('[data-limit]').forEach((b) => b.addEventListener('click', () => act.send({ t: 'setOptions', timeLimit: Number(b.dataset.limit) })));
  root.querySelectorAll<HTMLButtonElement>('[data-pace]').forEach((b) => b.addEventListener('click', () => act.send({ t: 'setOptions', pace: b.dataset.pace })));
  root.querySelector('#bot')?.addEventListener('click', () => act.send({ t: 'addBot' }));
  root.querySelector('#fill')?.addEventListener('click', () => {
    for (let k = msg.players.length; k < fillTarget(msg.players.length); k++) act.send({ t: 'addBot' });
  });
  root.querySelector('#start')?.addEventListener('click', () => act.send({ t: 'start' }));
  return root;
}
