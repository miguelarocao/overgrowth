# Overgrowth

Rival flowering plants take over an abandoned concrete city. A live multiplayer
territory game for 2–8 people in the browser: claim land, grow your stems, and
uproot every other mother plant. Shown as a tilt-shift miniature diorama.

See [SPEC.md](SPEC.md) for the full design. The 3D look is ported from
[reference/overgrowth-3d.html](reference/overgrowth-3d.html).

## Quick start

```bash
npm install
npm run dev        # game server on :8787 + Vite on :5173 (open http://localhost:5173)
```

Open the page, enter a name and either **Create a room** (share the `/r/<code>` link)
or **Play offline vs bots** (runs entirely in your tab, no server needed).

Production:

```bash
npm run build      # client -> dist/client
npm start          # serves the client and the WebSocket on $PORT (default 8787)
```

Or with Docker: `docker build -t overgrowth . && docker run -p 8787:8787 -v og-data:/data overgrowth`.
Any small Node host works; there is no database. Replays are JSON files under `$DATA_DIR/replays`.
Put it behind HTTPS if it's reachable from outside your network (the client switches to `wss://` automatically).

## Controls

| Input | Action |
|---|---|
| Click a tile | Select it |
| Arrow keys / WASD | Queue a step from the selection (the selection moves along, so presses draw a path) |
| Z | Next step sends half instead of all but one |
| E / Q | Undo last step / clear the queue |
| C | Toggle top-down camera (no blur) |
| H | Jump the camera back to your selection or mother plant |
| Drag / right-drag / scroll | Orbit / pan / zoom |
| 1–6 | Emotes (🌱 gg · 🌸 bloom! · 🐝 bzzz · 💧 thirsty · 🥀 oof · 👀 I see you) |
| M | Mute / unmute |

Arrow keys follow the screen: if you orbit the camera 90°, "up" still means up on your screen.

## What makes it fun

- **Spring showers** (host can turn them off): every ~70 turns a rain cloud drifts over a patch
  of the city. Clouds gather 10 turns ahead with a forecast banner, then for 15 turns every
  owned tile under the cloud grows +1 per turn. That pulls everyone to the same place to fight.
- **Pace**: Relaxed (500 ms ticks, the spec default), Brisk (350 ms) or Frantic (250 ms) for lunch-break games.
- **Sound**, all synthesized: captures pluck notes on a pentatonic scale that climbs as your
  streak grows, water splashes, bounced attacks thud, uprooting plays a fanfare, getting
  uprooted plays a sad trombone. Rain when it rains, faint birdsong otherwise.
- **Juice**: streak callouts ("Spreading!" → "Rampant!" → "Unstoppable overgrowth!"),
  floating text ("bonk!" when an attack bounces, "💧 +1 / turn" when you take water),
  screen shake for uproots (skipped with reduced motion), petal confetti when you win.
- **Banter**: emotes appear as speech bubbles in the player list, for everyone, including
  eliminated players and spectators. Bots emote too. Uproots get pun-filled announcements.
- **End-of-game awards** computed from the replay: Rampant Grower, Uprooter, Biggest Bouquet,
  Hydrant Hog, Marathon Vine, Thorny Optimist and Houseplant ("only 12 moves. Very zen.").
- **Secrets.** There are easter eggs. Spoilers in [EASTER_EGGS.md](EASTER_EGGS.md).

## Layout

```
shared/     engine: pure TypeScript, no DOM, no network, no clocks
  mapgen.ts   seeded map generator (streets every index % 5 == 2, blocks, plaza fountain, fair water)
  engine.ts   step(), combat, growth, elimination, surrender
  view.ts     viewFor(): the fog-filtered PlayerView
  session.ts  per-player move queues, path dropping, replay log
  replay.ts   replay format + re-running it
  protocol.ts JSON messages + tile deltas
server/
  room.ts     lobby, seats, bots, tick loop, per-client views (pure; also runs in the browser offline)
  index.ts    Node http + ws, static client, replay API
client/       Vite + TypeScript + three.js
  src/game.ts          client state, optimistic queue prediction, arrival estimates
  src/render/kit.ts    instancing toolkit (one InstancedMesh per part type, per-tile chunks)
  src/render/recipes.ts bushes, trees, buildings, props (ported from the reference)
  src/render/world.ts  the diorama: city, growth, smog, sprouts, capture effects
  src/render/view3d.ts renderer, tilt-shift, cameras, badge overlay
bots/         deterministic bot + headless simulator
reference/    overgrowth-3d.html
```

## How it works (the interesting bits)

- **Deterministic engine.** `step(state, moves)` is a pure function with no `Date.now()` or
  `Math.random()` inside. That's what makes replays tiny (seed + inputs) and lets the replay
  viewer just re-run the game. A test plays a full bot game, replays it, and compares state hashes.
- **The server never sends what you can't see.** Each tick the server computes `viewFor(state, you)`,
  diffs it against the last view it sent you, and sends only changed tiles. Hidden tiles arrive
  as terrain only (no owner, no stems, no mother flag), so devtools can't reveal the map. Queues are private too.
- **Optimistic queue.** Your arrow presses show up instantly. Each queue edit carries a sequence
  number; the server echoes the highest one it applied (`ack`), and the client replays any newer
  local edits on top of the server's authoritative queue. This is the same idea as client-side
  prediction in action games, just for a move list.
- **Sharp numbers over a blurry world.** Tilt-shift is a post-processing blur, so anything drawn in
  the 3D scene gets blurred. Stem counts are drawn on a separate 2D canvas *after* the 3D frame,
  so they stay crisp at any blur strength.
- **Instancing.** Every part type (leaves, blooms, stems, buds, windows…) is one `InstancedMesh`.
  Each tile owns a fixed chunk of instances in a per-team pool, so a capture rewrites only that
  tile's chunk. A late 8-player game is about 0.4M triangles in roughly 60 draw calls.

## Rules decisions not covered by the spec

- **Surrender / 60 s disconnect:** the player's land turns neutral and keeps its stems; their mother
  plant becomes neutral water with its stems as the garrison.
- **Invalid steps are skipped in the same tick.** If the next queued step is invalid (source lost,
  under 2 stems), it and its path continuation are dropped and the next valid step runs that tick.
  A step that executes but fails (attack too small) uses up the tick and drops its path continuation.
- **Growth order:** moves first, then growth. On tick multiples of 50, a mother gets both +1s.
- **Spring showers** default to on; the host can switch them off for classic rules. The schedule is
  derived from the seed (deterministic, replayable), but the seed is never sent to clients,
  since it would reveal the map. The server sends the current and upcoming shower instead.
- **Map fairness:** each mother gets a "home" water at exactly the same path distance (5–7), and every
  other water is farther from all mothers than that. Maps failing a check retry with a derived seed.
- **Tabs and reconnects:** a tab keeps its seat token in sessionStorage (survives reloads); a new tab
  falls back to localStorage but gets its own seat if that seat is still live, so several tabs on
  one machine work for testing.

## Testing

```bash
npm test           # Vitest: engine, map generator, queue/session, visibility, room, determinism, replays
npm run typecheck
npm run sim -- 300 # headless bot-vs-bot games: crashes, unfinished games, length distribution
```

## Status vs. milestones

1. Engine — done, with tests.
2. Local prototype — done as **offline mode** in the 3D client (same room code as the server) rather than a separate 2D canvas.
3. Multiplayer — done: rooms by link, lobby, teams, host start, bots, spectators, reconnect, 60 s grace.
4. 3D renderer — done: ported kit, tilt-shift + strength, top-down camera, counts after blur, queue vines, smog with last-seen tint, sprouts, grow-in and petal bursts.
5. Polish — end screen, awards, replays, synthesized sound, emotes and juice done.
6. Extras — teams 5–8 are in (Poppy, Daisy, Cherry blossom, Bluebell) and need a playtest for distinctness. Rule variants: spring showers and pace.

Known gaps: bots are simple (fine for filling seats; games with 5–8 bots run long), frame rate
has not been measured on real laptop GPUs, and no Cloudflare Durable Objects adapter
(`server/room.ts` is transport-agnostic, so one would be a thin wrapper).
