import './style.css';
import type { ServerMsg } from '../../shared/protocol';
import type { Replay } from '../../shared/replay';
import { teamColor } from '../../shared/teams';
import type { Dir } from '../../shared/types';
import { ClientGame } from './game';
import { LAND_GROWTH_TICKS } from '../../shared/config';
import { sfx } from './audio';
import { Fun, greetConsole } from './fun';
import { LOCAL_REPLAY_KEY, LocalConnection, WsConnection, type Connection } from './net';
import { View3D } from './render/view3d';
import { Vines } from './render/vines';
import { World, type Badge } from './render/world';
import { ReplayPlayer } from './replay';
import { el, esc, savedName, toast } from './ui/dom';
import { glyph } from './ui/glyphs';
import { Hud } from './ui/hud';
import { Tutorial, tutorialDone } from './ui/tutorial';
import { homeScreen, lobbyScreen } from './ui/screens';

const app = document.getElementById('app')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('badges') as HTMLCanvasElement;

let view: View3D | null = null;
try {
  view = new View3D(canvas, overlay);
} catch (e) {
  console.error(e);
}

function go(path: string) {
  history.pushState(null, '', path);
  route();
}
window.addEventListener('popstate', () => route());

/** Whatever is on screen now (a live game, an offline game or a replay). */
interface Screen {
  game: ClientGame | null;
  fun?: Fun | null;
  world: World | null;
  vines: Vines | null;
  refresh(): void;
  dispose(): void;
}
let current: Screen | null = null;

function noWebGL() {
  app.replaceChildren(el(`<div class="center"><section class="panel card"><h1 class="title" style="font-size:40px">Overgrowth</h1>
    <p class="lede">This game draws a 3D board and needs WebGL, which is turned off or unavailable in this browser.</p></section></div>`));
}

function route() {
  current?.dispose();
  current = null;
  view?.setWorld(null);
  app.replaceChildren();
  const path = location.pathname;
  const room = path.match(/^\/r\/([a-z0-9-]{3,24})\/?$/i);
  const rep = path.match(/^\/replay\/([a-z0-9-]{3,48})\/?$/i);
  if (room || path === '/offline' || rep) {
    if (!view) return noWebGL();
    if (rep) current = replayScreen(rep[1]);
    else current = gameScreen(room ? room[1].toLowerCase() : null);
    return;
  }
  if (path !== '/') {
    // Unknown path: it's overgrown.
    app.replaceChildren(el(`<div class="center"><section class="panel card"><h1 class="title" style="font-size:52px">404 🌿</h1>
      <p class="lede">This path is completely overgrown. Nobody has walked it in years.</p><button class="btn primary" id="home">Take the main road</button></section></div>`));
    app.querySelector('#home')!.addEventListener('click', () => go('/'));
    return;
  }
  app.replaceChildren(homeScreen(go));
}

// ---------- shared game rendering ----------

function attachGame(game: ClientGame): { world: World; vines: Vines } {
  const world = new World(game);
  view!.setWorld(world);
  const vines = new Vines((i, y) => world.tilePos(i, y), (m) => game.dest(m));
  world.scene.add(vines.group);
  return { world, vines };
}

function decorations(game: ClientGame, world: World) {
  const team = teamColor(game.teamOf(game.you));
  const extra: Badge[] = [];
  for (const e of game.estimates()) {
    const t = game.tiles[e.tile];
    extra.push({ pos: world.tilePos(e.tile, t.isMother ? 2.95 : t.owner !== null || t.stems ? 1.1 : 0.62), text: e.text, ring: team, ghost: true });
  }
  for (const m of game.queue) {
    if (!m.half) continue;
    const a = world.tilePos(m.from), b = world.tilePos(game.dest(m));
    extra.push({ pos: a.lerp(b, 0.5).setY(0.5), text: '½', ring: team, ghost: true, small: true });
  }
  return extra;
}

// ---------- live / offline game ----------

function gameScreen(code: string | null): Screen {
  const offline = code === null;
  const name = () => savedName.get();
  let game: ClientGame | null = null;
  let world: World | null = null;
  let vines: Vines | null = null;
  let hud: Hud | null = null;
  let status = 'connecting';
  let extra: Badge[] = [];
  let lastLobby: Extract<ServerMsg, { t: 'lobby' }> | null = null;
  let isHost = false;
  let fun: Fun | null = null;
  let tutorial: Tutorial | null = null;
  const wantTutorial = offline && new URLSearchParams(location.search).has('tutorial');
  let autoStarted = false;
  const startTutorial = () => {
    if (!game || !world || !hud || !game.alive) return;
    tutorial?.close();
    tutorial = new Tutorial(game, world, view!, () => (tutorial = null));
    hud.root.appendChild(tutorial.root);
  };
  const send = (m: any) => conn.send(m);

  const screen: Screen = {
    get game() { return game; },
    get world() { return world; },
    get vines() { return vines; },
    get fun() { return fun; },
    refresh() {
      if (!game || !world || !hud) return;
      vines!.set(game.alive ? game.queue : [], teamColor(game.teamOf(game.you)));
      const sel = game.alive ? game.selection : null;
      world.selection.visible = sel !== null;
      if (sel !== null) world.selection.position.set(world.tilePos(sel).x, 0.13, world.tilePos(sel).z);
      extra = game.alive ? decorations(game, world) : [];
      tutorial?.check();
      hud.update(game);
    },
    dispose() {
      conn.close();
      view!.extraBadges = () => [];
      view!.onFrame = () => {};
    }
  };

  view!.extraBadges = () => (tutorial ? [...extra, ...tutorial.badges()] : extra);
  view!.onFrame = (now) => vines?.frame(now, view!.reduced);

  const showLobby = (m: Extract<ServerMsg, { t: 'lobby' }>) => {
    lastLobby = m;
    isHost = m.you !== null && m.you === m.host;
    if (game) {
      view!.setWorld(null);
      game = world = vines = null;
      hud = null;
      fun = null;
      tutorial = null;
      sfx.setRain(false);
    }
    app.replaceChildren(lobbyScreen(m, offline, { send, leave: () => go('/') }));
    // The tutorial skips the lobby: you and one bot, straight in.
    if (wantTutorial && !autoStarted && m.you !== null && m.you === m.host && m.players.length >= 2) {
      autoStarted = true;
      send({ t: 'start' });
    }
  };

  const onMessage = (m: ServerMsg) => {
    const now = performance.now();
    switch (m.t) {
      case 'lobby':
        showLobby(m);
        break;
      case 'started': {
        const firstStart = !game;
        // A fresh game state (e.g. after a reconnect): drop any tutorial bound to the old one,
        // otherwise its board pointer would linger without its panel.
        tutorial?.close(false);
        tutorial = null;
        game = new ClientGame(m, send);
        ({ world, vines } = attachGame(game));
        hud = new Hud(view!, {
          surrender: () => send({ t: 'surrender' }),
          leave: () => go('/'),
          backToLobby: () => send({ t: 'backToLobby' }),
          replay: (id) => go(`/replay/${id}`),
          emote: (e) => send({ t: 'emote', e }),
          tutorial: () => startTutorial()
        }, offline ? 'OFFLINE' : `ROOM ${code!.toUpperCase()}`);
        hud.setStatus(status);
        fun = new Fun(game, world!, view!, hud, send);
        app.replaceChildren(hud.root);
        if (firstStart && m.you !== null && tutorialDone() && !wantTutorial) toast(`${glyph(game.teamOf(m.you) ?? '', 16)} Your mother plant is the tall tree (👑). It's already selected: use the arrow keys to grow.`, 6000);
        break;
      }
      case 'tick': {
        if (!game || !world) return;
        const firstTick = game.tick === 0 && game.selection === null && m.changedTiles.length > 50;
        const before = fun?.snapshot(m);
        const ch = game.applyTick(m);
        world.update(ch.changed, now);
        if (ch.dropped.length) vines!.flash(ch.dropped, now);
        if (fun && before) fun.onTick(before, ch, m);
        // Round growth (every 25 turns): the land visibly breathes, with a soft chime.
        if (m.tick > 0 && m.tick % LAND_GROWTH_TICKS === 0 && !game.over) {
          const n = world.pulse(game.alive ? game.you : null, now);
          if (n && !view!.reduced) sfx.growth();
          const mother = game.tiles.findIndex((t) => t.isMother && t.owner === game!.you);
          if (mother >= 0 && game.alive) view!.float(world.tilePos(mother, 2.4), `🌱 +1 on all ${game.players.find((p) => p.id === game!.you)?.land ?? ''} tiles`, '#B9E6A0', 15, 1600);
        }
        if (firstTick && game.you !== null) {
          const mother = game.tiles.findIndex((t) => t.isMother && t.owner === game!.you);
          if (mother >= 0) {
            game.select(mother);
            view!.focus(world.tilePos(mother), true);
          }
          if (wantTutorial || !tutorialDone()) startTutorial();
        }
        screen.refresh();
        break;
      }
      case 'eliminated': {
        if (!game) return;
        fun?.onEliminated(m);
        if (m.player === game.you) game.select(null);
        break;
      }
      case 'emote':
        if (fun) fun.onEmote(m);
        else toast(`${glyph(m.team, 16)} <b>${esc(m.name)}</b>`, 1500);
        break;
      case 'gameOver':
        if (!game || !hud) return;
        game.over = true;
        game.winner = m.winner;
        hud.update(game);
        fun?.onGameOver(m, isHost || offline);
        break;
      case 'error':
        toast(esc(m.message));
        break;
      case 'welcome':
        game?.resetPrediction();
        break;
    }
  };

  const conn: Connection = offline
    ? new LocalConnection(name() || 'You', { onMessage, onStatus: (s) => (status = s) })
    : new WsConnection(code!, name, {
        onMessage,
        onStatus: (s) => {
          status = s;
          hud?.setStatus(s);
          if (s === 'closed' && !game && !lastLobby) app.replaceChildren(el('<div class="center"><section class="panel card"><p class="lede">Connecting to the game server…</p></section></div>'));
        }
      });
  if (!offline) app.replaceChildren(el('<div class="center"><section class="panel card"><p class="lede">Connecting…</p></section></div>'));
  return screen;
}

// ---------- replay viewer ----------

function replayScreen(id: string): Screen {
  let game: ClientGame | null = null;
  let world: World | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  const screen: Screen = {
    get game() { return game; },
    get world() { return world; },
    vines: null,
    refresh() {},
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
    }
  };
  app.replaceChildren(el('<div class="center"><section class="panel card"><p class="lede">Loading replay…</p></section></div>'));
  const load = async (): Promise<Replay> => {
    if (id === 'local') {
      const raw = sessionStorage.getItem(LOCAL_REPLAY_KEY);
      if (!raw) throw new Error('No offline replay in this tab.');
      return JSON.parse(raw);
    }
    const res = await fetch(`/api/replays/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Replay not found.');
    return res.json();
  };
  load().then((rep) => {
    if (disposed) return;
    const player = new ReplayPlayer(rep);
    game = new ClientGame(player.started(), () => {});
    ({ world } = attachGame(game));
    const hud = new Hud(view!, { surrender() {}, leave: () => go('/'), backToLobby() {}, replay() {} }, 'REPLAY', true);
    app.replaceChildren(hud.root);
    const bar = el(`<section class="panel replaybar" aria-label="Replay controls">
      <button class="btn small" id="play">Pause</button>
      <select class="input" id="speed" aria-label="Speed" style="min-height:30px"><option value="1">1×</option><option value="2">2×</option><option value="4" selected>4×</option><option value="8">8×</option></select>
      <input type="range" id="scrub" min="0" max="${player.total}" value="0" aria-label="Turn">
      <span class="mono" id="pos"></span></section>`);
    hud.slot('replay-slot')!.appendChild(bar);
    const scrub = bar.querySelector<HTMLInputElement>('#scrub')!;
    const pos = bar.querySelector<HTMLElement>('#pos')!;
    const playBtn = bar.querySelector<HTMLButtonElement>('#play')!;
    const speed = bar.querySelector<HTMLSelectElement>('#speed')!;
    let playing = true;
    const show = (t: number) => {
      const ch = game!.applyTick(player.seek(t));
      world!.update(ch.changed, performance.now());
      scrub.value = String(player.tick);
      pos.textContent = `turn ${Math.floor(player.tick / 2)} / ${Math.floor(player.total / 2)}`;
      hud.update(game!);
      if (player.tick >= player.total) {
        playing = false;
        playBtn.textContent = 'Replay';
      }
    };
    show(0);
    const restart = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => playing && show(player.tick + 1), game!.tickMs / Number(speed.value));
    };
    playBtn.addEventListener('click', () => {
      if (player.tick >= player.total) show(0);
      playing = !playing || player.tick === 0;
      playBtn.textContent = playing ? 'Pause' : 'Play';
    });
    speed.addEventListener('change', restart);
    scrub.addEventListener('input', () => show(Number(scrub.value)));
    restart();
  }).catch((e) => {
    app.replaceChildren(el(`<div class="center"><section class="panel card"><p class="lede">${esc(String(e.message ?? e))}</p><button class="btn" id="home">Home</button></section></div>`));
    app.querySelector('#home')!.addEventListener('click', () => go('/'));
  });
  return screen;
}

// ---------- input ----------

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
};
const PAN_KEYS = new Set(['w', 'a', 's', 'd']);

window.addEventListener('keyup', (e) => view?.held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => view?.held.clear());

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (target instanceof HTMLInputElement) {
    // Text fields keep their keys; sliders and switches hand the keyboard back to the game.
    if (!['checkbox', 'range'].includes(target.type)) return;
    target.blur();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (PAN_KEYS.has(key) && view?.world) {
    view.held.add(key);
    current?.fun?.onKey(key, false);
    return;
  }
  if (key === 'r' && view?.world) {
    view.quarterTurn(e.shiftKey ? -1 : 1);
    current?.fun?.onKey(key, false);
    return;
  }
  if (key === 'm') {
    sfx.setMuted(!sfx.muted);
    toast(sfx.muted ? '🔇 Sound off' : '🔊 Sound on', 1200);
    document.querySelector<HTMLInputElement>('#sound') && (document.querySelector<HTMLInputElement>('#sound')!.checked = !sfx.muted);
    return;
  }
  if (key === 'c' && view?.world) {
    view.update({ topDown: !view.settings.topDown });
    document.querySelector<HTMLInputElement>('#top') && (document.querySelector<HTMLInputElement>('#top')!.checked = view.settings.topDown);
    return;
  }
  const game = current?.game;
  if (!game || !current?.vines) return;
  const dir = KEY_DIRS[key];
  let queued = false;
  if (dir) {
    e.preventDefault();
    queued = game.queueDir(view!.gridDir(dir));
    if (queued) sfx.tick(game.queue.length);
  } else if (key === 'z') {
    game.toggleHalf();
    sfx.tick(game.halfNext ? 6 : 0);
  } else if (key === 'e' || key === 'Backspace') {
    e.preventDefault();
    game.undo();
  }
  else if (key === 'q') game.clear();
  else if (/^[1-6]$/.test(key)) current.fun?.emote(Number(key) - 1);
  else if (key === 'Escape') game.select(null);
  else if ((key === ' ' || key === 'Tab') && current.world) {
    // Space / Tab: grab your biggest stack; press again for the next biggest. Shift goes back.
    e.preventDefault();
    const best = game.cycleStacks(e.shiftKey);
    if (best !== null) {
      // Only move the camera if the stack isn't already near the middle of the screen; then glide, don't jump.
      const at = current.world.tilePos(best);
      if (!view!.nearCenter(at)) view!.glideTo(at);
      current.world.ping(best, performance.now());
      sfx.select();
    }
  }
  else if (key === 'h' && current.world) {
    const home = game.selection ?? game.tiles.findIndex((t) => t.isMother && t.owner === game.you);
    if (home >= 0) view!.focus(current.world.tilePos(home));
  }
  current.fun?.onKey(e.key.length === 1 ? e.key.toLowerCase() : e.key, queued);
  current.refresh();
});

let down: { x: number; y: number; button: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, button: e.button }));
canvas.addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  const game = current?.game;
  if (!game || !view || !current?.vines) return;
  const tile = view.pick(e.clientX, e.clientY);
  if (current.fun?.onClick(e.clientX, e.clientY, tile)) return;
  const had = game.selection;
  game.select(tile >= 0 ? tile : null);
  if (game.selection !== null && game.selection !== had) sfx.select();
  current.refresh();
});
canvas.addEventListener('pointermove', (e) => {
  const world = current?.world;
  if (!world || !view) return;
  const tile = view.pick(e.clientX, e.clientY);
  const ok = tile >= 0 && world.game.tiles[tile].kind !== 'building';
  world.hover.visible = ok;
  if (ok) {
    const p = world.tilePos(tile);
    world.hover.position.set(p.x, 0.125, p.z);
  }
  canvas.style.cursor = ok && world.game.canSelect(tile) ? 'pointer' : '';
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// After clicking a HUD button, hand the keyboard back to the game (otherwise Space would re-press it).
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement | null)?.closest?.('.hud button');
  if (b instanceof HTMLButtonElement) b.blur();
});

// Handy for debugging in devtools (and the browser tests): only your own client state.
(window as any).og = { get game() { return current?.game ?? null; }, get view() { return view; } };

greetConsole();
route();
