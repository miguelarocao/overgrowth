import './style.css';
import type { ServerMsg } from '../../shared/protocol';
import type { Replay } from '../../shared/replay';
import { teamColor } from '../../shared/teams';
import type { Dir } from '../../shared/types';
import { ClientGame } from './game';
import { LOCAL_REPLAY_KEY, LocalConnection, WsConnection, type Connection } from './net';
import { View3D } from './render/view3d';
import { Vines } from './render/vines';
import { World, type Badge } from './render/world';
import { ReplayPlayer } from './replay';
import { el, esc, savedName, toast } from './ui/dom';
import { glyph } from './ui/glyphs';
import { Hud } from './ui/hud';
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
  // Handy for debugging in devtools (and the browser tests): only your own client state.
(window as any).og = { get game() { return current?.game ?? null; }, get view() { return view; } };

route();
}
window.addEventListener('popstate', () => route());

/** Whatever is on screen now (a live game, an offline game or a replay). */
interface Screen {
  game: ClientGame | null;
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
  if (path !== '/') history.replaceState(null, '', '/');
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
  const send = (m: any) => conn.send(m);

  const screen: Screen = {
    get game() { return game; },
    get world() { return world; },
    get vines() { return vines; },
    refresh() {
      if (!game || !world || !hud) return;
      vines!.set(game.alive ? game.queue : [], teamColor(game.teamOf(game.you)));
      const sel = game.alive ? game.selection : null;
      world.selection.visible = sel !== null;
      if (sel !== null) world.selection.position.set(world.tilePos(sel).x, 0.13, world.tilePos(sel).z);
      extra = game.alive ? decorations(game, world) : [];
      hud.update(game);
    },
    dispose() {
      conn.close();
      view!.extraBadges = () => [];
      view!.onFrame = () => {};
    }
  };

  view!.extraBadges = () => extra;
  view!.onFrame = (now) => vines?.frame(now, view!.reduced);

  const showLobby = (m: Extract<ServerMsg, { t: 'lobby' }>) => {
    lastLobby = m;
    isHost = m.you !== null && m.you === m.host;
    if (game) {
      view!.setWorld(null);
      game = world = vines = null;
      hud = null;
    }
    app.replaceChildren(lobbyScreen(m, offline, { send, leave: () => go('/') }));
  };

  const onMessage = (m: ServerMsg) => {
    const now = performance.now();
    switch (m.t) {
      case 'lobby':
        showLobby(m);
        break;
      case 'started': {
        const firstStart = !game;
        game = new ClientGame(m, send);
        ({ world, vines } = attachGame(game));
        hud = new Hud(view!, {
          surrender: () => send({ t: 'surrender' }),
          leave: () => go('/'),
          backToLobby: () => send({ t: 'backToLobby' }),
          replay: (id) => go(`/replay/${id}`)
        }, offline ? 'OFFLINE' : `ROOM ${code!.toUpperCase()}`);
        hud.setStatus(status);
        app.replaceChildren(hud.root);
        if (firstStart && m.you !== null) toast(`${glyph(game.teamOf(m.you) ?? '', 16)} Your mother plant is the tall tree. Click it, then use the arrow keys.`, 6000);
        break;
      }
      case 'tick': {
        if (!game || !world) return;
        const firstTick = game.tick === 0 && game.selection === null && m.changedTiles.length > 50;
        const ch = game.applyTick(m);
        world.update(ch.changed, now);
        if (ch.dropped.length) vines!.flash(ch.dropped, now);
        if (firstTick && game.you !== null) {
          const mother = game.tiles.findIndex((t) => t.isMother && t.owner === game!.you);
          if (mother >= 0) {
            game.select(mother);
            view!.focus(world.tilePos(mother), true);
          }
        }
        screen.refresh();
        break;
      }
      case 'eliminated': {
        if (!game) return;
        const p = game.players.find((x) => x.id === m.player);
        const by = m.by !== null ? game.players.find((x) => x.id === m.by) : null;
        if (p) toast(`${glyph(p.team, 16)} ${esc(p.name)} ${by ? `was uprooted by ${esc(by.name)}` : 'surrendered'}`);
        if (m.player === game.you) game.select(null);
        break;
      }
      case 'gameOver':
        if (!game || !hud) return;
        game.over = true;
        game.winner = m.winner;
        hud.update(game);
        setTimeout(() => hud?.gameOver(game!, m.winner, m.replayId, isHost || offline), 700);
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
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right'
};

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'c' && view?.world) {
    view.update({ topDown: !view.settings.topDown });
    document.querySelector<HTMLInputElement>('#top') && (document.querySelector<HTMLInputElement>('#top')!.checked = view.settings.topDown);
    const blur = document.querySelector<HTMLInputElement>('#blur');
    if (blur) blur.disabled = !view.settings.tilt || view.settings.topDown;
    return;
  }
  const game = current?.game;
  if (!game || !current?.vines) return;
  const dir = KEY_DIRS[key];
  if (dir) {
    e.preventDefault();
    game.queueDir(view!.gridDir(dir));
  } else if (key === 'z') game.toggleHalf();
  else if (key === 'e') game.undo();
  else if (key === 'q') game.clear();
  else if (key === 'Escape') game.select(null);
  else if (key === 'h' && current.world) {
    const home = game.selection ?? game.tiles.findIndex((t) => t.isMother && t.owner === game.you);
    if (home >= 0) view!.focus(current.world.tilePos(home));
  }
  else return;
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
  game.select(tile >= 0 ? tile : null);
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

// Handy for debugging in devtools (and the browser tests): only your own client state.
(window as any).og = { get game() { return current?.game ?? null; }, get view() { return view; } };

route();
