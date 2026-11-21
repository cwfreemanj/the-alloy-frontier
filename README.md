# the-alloy-frontier

the alloy frontier open game jam entrant

A browser-first 3D action MMORPG prototype: one shared world where everyone who opens the
game is online together, with crafting at the heart of it (gather, forge your own weapon,
fight with it). Built with TypeScript, Three.js and Vite; a small Node server runs the world.

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

Every pull request into `main` (and every push to `main`) runs the typecheck, unit tests, build and browser tests automatically on GitHub Actions.

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
    src/game/       Game.ts (main loop), Online.ts (shared world glue), dialogue
    src/ui/         HUD, forge, inventory, menus, styles
  server/     world server (worldRoom = the shared world, worldServer = HTTP + WebSocket)
packages/     plain TypeScript, no rendering; shared by client and server
  game-rules/ combat, stamina, enemy AI brains, progression, quest
  item-gen/   seeded item generation, formulas, materials, blueprints
  crafting/   inventory, forge transactions, Masterwork puzzle, merchant
  protocol/   network message formats and validation
  world/      map layout, terrain height, colliders, enemy movement
tests/e2e/    Playwright browser tests
docs/         playtest guide, performance capture, screenshots
```

Gameplay rules live in `packages/` so the server can run them too. Rendering-only code stays in `apps/web`.

## Assets

Everything in the game today is procedural (built in code), so there are no third-party assets yet.
When adding models or animations:

- Commit only the **converted files the game loads** (e.g. `.glb`) under `apps/web/public/assets/`.
- Keep raw source packs (Mixamo zips, FBX, `.blend`) in the shared Drive folder, or in
  `source-assets/` locally, which git ignores. GitHub rejects files over 100 MB.
- Record where each asset came from and its license in `ASSET_PROVENANCE.md` when you add it.

## Hosting

`render.yaml` describes the world server for [Render](https://render.com) (free plan). The server
serves the game and the world at the same address, so players just open the link.

## Team workflow

See [CONTRIBUTING.md](CONTRIBUTING.md).
