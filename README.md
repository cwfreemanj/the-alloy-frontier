# the-alloy-frontier

the alloy frontier open game jam entrant

A browser-first 3D action MMORPG prototype: one shared world where everyone who opens the
game is online together, with crafting at the heart of it (gather, forge your own weapon,
fight with it). Built with TypeScript, Three.js and Vite; a small Node server runs the world.

## Status

The First Forge vertical slice has passed GDD gates A–D (combat, crafting, network, integrated
quest) and is at **M4, quality acceptance**: see [docs/M4.md](docs/M4.md) for what's left, and
[docs/GDD-v0.5.md](docs/GDD-v0.5.md) for what's built and the next tickets. Playtesters:
[docs/PLAYTEST.md](docs/PLAYTEST.md).

## Play / run locally

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install        # once, and after pulling changes to package.json
npm run world      # builds the game and starts the world server
```

Open http://localhost:2568, and open it in a second window to see yourself as another player.

| Command | What it does |
| --- | --- |
| `npm run dev` | Fast dev mode with hot reload at http://localhost:5178 (joins a running `npm run world` server if there is one, otherwise plays offline) |
| `npm run world` | Production build + shared-world server at http://localhost:2568 |
| `npm run world:lan` | Same, reachable from other devices on your Wi-Fi |
| `npm test` | Unit and integration tests (rules, crafting, saves, world server) |
| `npm run test:e2e` | Browser tests in Chrome, including a two-player test |
| `npm run typecheck` | TypeScript checks |
| `npm run build` | Typecheck + production build into `apps/web/dist` |

Every pull request into `main` (and every push to `main`) runs the typecheck, unit tests, build and browser tests automatically on GitHub Actions. The browser tests are informational there; see [CONTRIBUTING.md](CONTRIBUTING.md).

Add `?debug` to a localhost address for test shortcuts (`window.__alloy.teleport(x, z)`, `give`, `heal`).
They never work on a hosted copy.

## Controls

Click the game to capture the mouse, **Esc** for the menu.
WASD move · Shift sprint · Space jump · LMB/J light combo · F heavy · hold RMB/L block ·
Q dodge · R Guardbreaker · G Storm Arc · Tab lock-on · E interact/gather · I inventory · F3 performance.

## Where things live

```
apps/
  web/        the game client (Three.js scene, UI, input, entities, networking)
    src/entities/   player, other players, enemies, NPCs, weapons, procedural rig
    src/entities/models/  character models + animation library; animSets.ts maps game states to clips
    src/game/       Game.ts (main loop), Online.ts (shared world glue), dialogue
    src/ui/         HUD, forge, inventory, menus, styles
  server/     world server (worldRoom = the shared world, worldServer = HTTP + WebSocket,
              characters = signed-in characters the server owns and saves, accounts/ = sign-in + storage)
packages/     plain TypeScript, no rendering; shared by client and server
  session/    the character and the rules for changing it (gather, buy, forge, equip, kill rewards)
  game-rules/ combat, stamina, enemy AI brains, progression, quest
  item-gen/   seeded item generation, formulas, materials, blueprints
  crafting/   inventory, forge transactions, Masterwork puzzle, merchant
  protocol/   network message formats and validation
  world/      map layout, terrain height, colliders, enemy movement
tests/e2e/    Playwright browser tests
tools/asset-pipeline/  converts raw Mixamo packs into the game's models (not part of the game build)
docs/         playtest guide, performance capture, screenshots
```

Gameplay rules live in `packages/` so the server can run them too. Rendering-only code stays in `apps/web`.

**Who decides what:**
- **Signed-in players:** the server owns the character. The browser sends actions such as gather, buy,
  forge, equip or talk. The server checks them against where the player is, the quest and what they own,
  applies them with the rules in `packages/session`, and sends the character back. Kill rewards, weapon
  XP and hit damage are worked out on the server too.
- **Guests:** their character lives in their browser and runs the same rules locally.

## Assets

Characters are Mixamo models and animations converted by `tools/asset-pipeline` (see its README)
into `apps/web/public/models/`; weapons, the Sentinel, terrain and buildings are still procedural.
If the models fail to load, the game falls back to its procedural placeholder rigs.
When adding models or animations:

- Commit only the **converted files the game loads** (e.g. `.glb`) under `apps/web/public/models/`
  (not `public/assets/`: the server caches that path forever under the same name).
- Keep raw source packs (Mixamo zips, FBX, `.blend`) in the shared Drive folder, or in
  `source-assets/` locally, which git ignores. GitHub rejects files over 100 MB.
- Record where each asset came from and its license in `ASSET_PROVENANCE.md` when you add it.

## Hosting

`render.yaml` describes the world server for [Render](https://render.com) (free plan). The server
serves the game and the world at the same address, so players just open the link.

## Team workflow

See [CONTRIBUTING.md](CONTRIBUTING.md).
