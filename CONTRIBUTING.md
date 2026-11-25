# Working together

## Daily workflow (GitHub Desktop)

1. **Fetch/Pull** to get the latest code.
2. **Current Branch → New Branch** and give it a name (e.g. `add-alita-model`, `fix-boss-spam`).
3. Make your changes, then **Commit** with a short message that says what changed.
4. **Push**, then click **Create Pull Request**.
5. Someone looks it over and tests it, then clicks **Merge**. The game redeploys automatically.

Before opening a pull request, run `npm test` (and `npm run test:e2e` if you changed gameplay or UI).

Every pull request runs checks on GitHub automatically:

- **Typecheck, unit tests, build:** required. A red check here means the PR is not ready to merge.
- **Browser tests (Playwright, informational):** these also run, and their report is uploaded when they fail,
  but a failure does not block the merge. GitHub's runners have no GPU and render too slowly for the game's
  frame-rate floor, so these timing-based tests can fail there even when the game is fine.
  **Run `npm run test:e2e` locally before merging any gameplay or UI change.**

## Staying out of each other's way

The code is split by area so two people rarely edit the same file:

| Area | Folder |
| --- | --- |
| Characters, enemies, weapons (visuals) | `apps/web/src/entities/` |
| HUD, menus, forge screen | `apps/web/src/ui/` |
| Main loop and online glue | `apps/web/src/game/` |
| Combat, AI, quests (rules) | `packages/game-rules/` |
| Items and crafting | `packages/item-gen/`, `packages/crafting/` |
| Map, terrain, spawns | `packages/world/` |
| World server | `apps/server/` |

`apps/web/src/game/Game.ts` is the busiest file. Keep changes there small and say so in your PR.

## Big files

- Never commit raw source packs (`.zip`, `.fbx` packs, `.blend`, half-finished `.crdownload` downloads).
  `.gitignore` blocks the common ones, and `source-assets/` is ignored entirely.
- Commit only what the game loads. Avoid Git LFS for files the game loads; use it only for source files.

## Tracking work

- **Dev logs:** each of us, and each AI agent, keeps a timestamped log of what happened in `docs/devlog/`.
  Add an entry with `npm run devlog -- "What happened"`. See [docs/devlog/README.md](docs/devlog/README.md).

- **Issues:** one per task or bug, assigned to whoever takes it.
- **Projects:** a board with To Do / In Progress / Done.

## Multiplayer safety

The live world runs from `main`. Once players are around, consider a `dev` branch:
merge into `dev` first, test there, then merge `dev` into `main`.
