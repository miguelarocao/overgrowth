# Overgrowth: game spec

Overgrowth is a browser strategy game for live multiplayer with my team at work. It plays exactly like generals.io: capture land, grow your army, take the enemy's base. The theme is rival flowering plants taking over an abandoned concrete city, shown as a tilt-shift miniature diorama.

Anyone who has played generals.io should be able to play without reading anything.

## Goals

- Fun 5 to 15 minute matches for 2 to 8 coworkers, joined from a shared link.
- Stable: an authoritative server, a deterministic engine, and reconnects that work.
- Looks like a tilt-shift miniature, but the numbers on the board stay readable at all times.

## Non-goals for now

- Accounts, rankings or a public matchmaking ladder.
- Phone-first controls (desktop keyboard play comes first).
- Different abilities per team. All teams play by the same rules in v1.

## Rules

### Tiles

| Game term | generals.io equivalent | Notes |
|---|---|---|
| Concrete, street | Plain | Empty, claimable land |
| Your growth | Owned tile | The number on it is the stem count (army) |
| Mother plant | General | A large tree. Lose it and you are out |
| Water | City | Burst hydrant, puddle or fountain. Starts with a neutral garrison |
| Building | Mountain | Impassable. Wrecked cars are a 1-tile building variant |
| Smog | Fog of war | Tiles you cannot currently see |

### Timing and growth

- The game advances one tick every 500 ms. Two ticks make one turn.
- Each player executes at most one queued move per tick.
- Mother plants and owned water gain 1 stem every turn.
- Every owned tile gains 1 stem every 25 turns.
- Neutral water does not grow.

### Moving and combat

- Select an owned tile, then press an arrow key to send its stems to the adjacent tile in that direction. Only up, down, left and right; no diagonals.
- By default a move sends all stems but one. In half mode (toggle with Z) it sends half, rounded down. The source tile must have at least 2 stems.
- Moving onto your own tile adds the stems together.
- Moving onto a neutral or enemy tile subtracts the defender's stems from the attacker's. If the attacker has more, the tile is captured with the remainder. If the defender has more or the same, the defender keeps the tile with the difference (0 on a tie).
- Buildings cannot be entered.
- Moves in the same tick are applied one at a time in player priority order. Priority rotates every tick so nobody always goes first. Resolution must be deterministic.

### Selecting and queueing moves

- Click an owned tile to select it.
- Each arrow press queues one step from the selected tile and moves the selection to the destination tile, so repeated presses draw a path. The stack itself only moves when the step executes.
- Every step sends all stems but one, leaving 1 behind, which is how a single stack claims a trail of land. Z makes the next queued step send half instead; it applies to that one step only.
- Each player has a single queue, executed in order, one step per tick. Clicking a different tile and pressing arrows appends steps for that stack to the same queue.
- E removes the last queued step and moves the selection back. Q clears the whole queue.
- When a step fails or becomes invalid (the attack was too small, the source tile was lost, or it has fewer than 2 stems), drop that step and every later step that continues the same path. Steps queued for other stacks stay.
- A player's queue is private. The server never sends it to anyone else.

Example: a stack of 30 queues → → ↓. Tick 1 leaves 1 behind and moves 29, tick 2 leaves 1 and moves 28, tick 3 leaves 1 and moves 27.

### Elimination and winning

- Capturing a mother plant eliminates its owner. All of their tiles transfer to the capturer with stem counts halved (rounded down), and the captured mother plant becomes a water tile owned by the capturer.
- The last player with a mother plant wins.
- Players can surrender. A player disconnected for more than 60 seconds is treated as surrendered.

### Visibility (smog)

- You see your own tiles and every tile touching them, including diagonals.
- Terrain is always visible: buildings, streets and water locations. Ownership and stem counts outside your vision are hidden.
- Nice to have: tiles you saw before keep a faint "last seen" tint of their owner's color.

## Map generation

- Fully seeded: the same seed always produces the same map.
- Size: 20x20 for 2 to 4 players, 26x26 for 5 to 8 players.
- Streets run along every row and column where `index % 5 == 2`, splitting the board into city blocks.
- Each block gets 1 or 2 rectangular buildings (1 to 2 tiles wide, 1 to 3 tiles deep). Streets never get buildings.
- The central block is an open plaza with a fountain: a water tile with a garrison of about 50.
- Other water tiles: roughly one per 30 non-building tiles, garrison 40 to 50, at least 3 tiles from any mother plant.
- Mother plants go on non-street tiles, spread far apart, with roughly equal path distance to their nearest water.
- Every non-building tile must be reachable from every mother plant (check with BFS). If a map fails this or the fairness checks, try the next seed.

## Teams

The four core teams are below. Each has its own bloom color and bloom shape, so teams stay distinguishable for colorblind players. Never rely on color alone.

| Team | Color | Bloom shape |
|---|---|---|
| Morning glory | `#4A86F2` | Blue trumpets with a cream center |
| Sunflower | `#F2C230` | Tall stalks with yellow heads and brown centers |
| Lavender | `#A27DF0` | Thin upright purple spikes; the mother tree has hanging clusters like wisteria |
| Rose | `#EC4D63` | Round red blooms with dark centers on darker leaves |

Candidates for players 5 to 8, to playtest for distinctness first: Poppy (orange `#F07A2A`, cup blooms), Daisy (white `#F4F1E8`, flat petals with yellow center), Cherry blossom (light pink `#F5A7C7`, small clustered blossoms), Bluebell (indigo `#4B3FC9`, drooping bells).

## Art direction

The look is already prototyped. Use these as the reference:

- `reference/overgrowth-3d.html`: a working three.js scene with the bush, mother tree, building and prop recipes, tilt-shift post-processing, and number badges drawn after the blur. Port from this rather than starting from scratch.
- Design canvas with the HUD layout and tile legend: https://claude.ai/artifact/QTBGiQ9AWDsB8nWmJpE1gp (private to my account, for my reference).

### Scene

- three.js (r160 or later), ES modules, low-poly flat shading.
- One tile is one world unit. The whole board sits on a dark diorama base slab.
- Overcast grey-green sky, light distance fog. The city is muted grey so the plants pop.
- Concrete tiles are slabs with visible seams and occasional cracks. Streets are darker asphalt with faded yellow dashes.
- Owned tiles: a soil patch with a thin rim in the team color, topped with a bush of green leaf clusters covered in the team's blooms.
- Mother plants: a large tree, about 2.5 units tall, with roots cracking the pavement and a canopy covered in team blooms. It should be visible from anywhere on the board.
- Buildings: concrete apartment block (windows, rooftop water tower, a few lit windows), rusted sawtooth warehouse, collapsed ruin with rebar, small shop with a faded billboard. Props live only on building tiles so playable tiles stay clean.
- Small sprouts appear on neutral tiles that touch someone's growth.
- Smog: tiles outside your vision get a translucent grey-brown haze and hide plants and numbers. Buildings stay visible but desaturated.

### Tilt-shift and readability

- Post-processing: horizontal and vertical tilt-shift shader passes, applied twice, with the sharp band across the middle of the screen. Then a small saturation boost (about +0.18).
- Players can turn tilt-shift off and adjust its strength.
- Stem counts must always be sharp. Draw them after post-processing, either as a separate sprite scene rendered on top or as an HTML overlay. Each count sits on a dark rounded badge with a border in the team color.
- Provide a top-down camera mode with no blur for players who want maximum clarity.

### Showing the queue

The 3D kit has a working version of this: press "Play queue" in `reference/overgrowth-3d.html`.

- Draw the queued path as a translucent vine in the player's team color along the ground, with a chevron on each tile pointing in the step's direction.
- The next step to execute is brighter and gently pulses. Later steps fade progressively by their order in the queue.
- Half steps use a thinner vine and a small "½" marker.
- When a step executes, its vine segment disappears and the bush on the destination tile grows in.
- When a step is dropped, the dropped segments flash red for about 400 ms and disappear.
- A dashed "ghost" badge at the end of each path shows the estimated arrival, like "≈14". Compute it assuming all but one per step and subtracting only stems the player can see; show "≈?" once the path enters smog.
- The selection (where the next arrow press continues from) is a white square outline.
- The HUD shows a queue readout: remaining steps and time until done, for example "5 steps · 2.5 s" (steps times the tick length).

### Feedback and animation

- A bush grows in (scale 0 to 1 over about 250 ms, with a slight overshoot) when a tile is captured.
- A burst of team-colored petals when water or a mother plant is captured.
- Keep everything else calm. Readability beats spectacle.

### Performance

- Use one `InstancedMesh` per part type (leaves, blooms, stems, windows) and only rewrite the instances for tiles that changed.
- Target 60 fps on a typical work laptop on a 26x26 board.

## Controls

| Input | Action |
|---|---|
| Click a tile | Select it |
| Arrow keys or WASD | Queue a move from the selected tile |
| Z | Toggle sending half instead of all but one |
| Q | Clear queued moves |
| E | Undo the last queued move |
| Mouse drag, scroll | Orbit and zoom the camera (limited range) |
| C | Toggle top-down camera |

## Architecture

### Repo layout

```
overgrowth/
  shared/     game engine: pure TypeScript, no DOM, no network
  server/     Node + ws: rooms, lobby, authoritative tick loop
  client/     Vite + TypeScript + three.js: renderer, input, HUD
  bots/       simple bots that use the same move API as players
  reference/  overgrowth-3d.html
```

### Engine (shared/)

The engine is a pure, deterministic function. Same seed and same inputs must always give the same state. No `Date.now()` or `Math.random()` inside the engine; use a seeded RNG.

```ts
type PlayerId = number;
type Dir = 'up' | 'down' | 'left' | 'right';

interface Tile {
  kind: 'plain' | 'street' | 'building' | 'water';
  owner: PlayerId | null;
  stems: number;
  isMother: boolean;
}

interface GameState {
  seed: number;
  tick: number;
  width: number;
  height: number;
  tiles: Tile[];          // row-major
  players: { id: PlayerId; team: string; alive: boolean }[];
}

interface Move { from: number; dir: Dir; half: boolean }

function generateMap(seed: number, playerCount: number): GameState;
function step(state: GameState, moves: Map<PlayerId, Move | null>): GameState;
function viewFor(state: GameState, player: PlayerId): PlayerView; // fog-filtered
```

### Server

- The server is authoritative. Each room runs its own tick loop (drift-corrected, 500 ms).
- The server holds each player's move queue. Every tick it pops one move per player, runs `step`, and sends each client only what that player can see.
- Never send hidden tiles to a client, or anyone can read the whole map from devtools.
- Rooms are joined by link (`/r/<code>`). The lobby shows players and their chosen team; the host starts the game; empty seats can optionally be filled with bots.
- Eliminated players and spectators get the full, unfogged view.
- Reconnect: the client keeps a player token in localStorage and can rejoin within 60 seconds.
- Replays: store the seed plus every tick's moves. A replay viewer just re-runs the engine.
- Hosting: any small Node host works. Cloudflare Durable Objects (one per room) is a good fit too.

### Protocol (JSON over WebSocket)

Client to server: `join { room, name, token? }`, `pickTeam { team }`, `start`, `queue { moves: Move[] }`, `clearQueue`, `undo`, `surrender`.

Server to client: `lobby { players, host }`, `started { width, height, terrain, you }`, `tick { tick, changedTiles, players, queue }`, `eliminated { player, by }`, `gameOver { winner, replayId }`.

### Client

- Renders only from the `PlayerView` the server sends.
- Shows your own queued moves immediately, before the server confirms them.
- HUD: player list with stems and land counts, turn counter, selected stack, controls reminder, surrender button.

## Milestones

1. **Engine.** Map generation, `step`, visibility, with unit tests.
2. **Local 2D prototype.** A simple 2D canvas client playing against bots in one browser tab, no server. Use this to tune the rules.
3. **Multiplayer.** Server, lobby, rooms and reconnect, still with the 2D client. Test with several browser tabs plus bots.
4. **3D renderer.** Port the look from `reference/overgrowth-3d.html`, with counts drawn after the blur.
5. **Polish.** Animations, sounds, end screen, replays.
6. **Extras.** Teams 5 to 8, optional rule variants.

## Testing

- Unit tests for the engine (Vitest): combat, ties, half mode, growth intervals, capture and elimination, visibility, invalid queued moves.
- Determinism test: the same seed and inputs produce an identical state hash.
- Headless bot-vs-bot runs (a few hundred games): no crashes, every game ends, typical length 5 to 15 minutes.
- Manual multiplayer test: 4 browser tabs plus bots on one machine.

## Starting values to tune

| Setting | Start value |
|---|---|
| Tick length | 500 ms |
| Mother plant and owned water growth | +1 per turn |
| Land growth | +1 every 25 turns |
| Water garrison | 40 to 50 (plaza fountain about 50) |
| Vision | 1 tile around owned tiles, including diagonals |
| Map size | 20x20 (2 to 4 players), 26x26 (5 to 8 players) |
| Disconnect grace period | 60 s |
