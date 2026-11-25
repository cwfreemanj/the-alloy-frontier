# Dev log: cwfreemanj

Creative director; owns models, animation and world art.
Newest first. Times are US Eastern. How to write entries: [README.md](README.md).

Entries before 2026-11-25 were backfilled from pull requests on 2026-11-25. Add new entries with
`npm run devlog -- "What happened" --as cwfreemanj` (see the README), or edit this file by hand.

## 2026-11-23 02:52 — Fixed A/D strafing (#5)
- **PR:** #5 `fix-ad-strafe` · merged 02:52 · made with Claude Code
- **Done:** A moves left and D moves right, relative to the camera. The strafe animations follow the real
  movement direction, so they flipped with it.
- **Verified:** typecheck and 105 unit tests passed; checked in a browser on the production build.

## 2026-11-23 02:46 — Emberhold world from the Model Workshop (#4)
- **PR:** #4 `world-emberhold` · merged 02:46 · made with Claude Code
- **Done:**
  - Replaced the procedural starting area with the Emberhold area built in the Model Workshop's World view:
    the village, Ironwood Trail, Ironglass Quarry and Dormant Foundry.
  - About 1,040 baked placements, painted terrain, sky, golden-hour lighting, particles, wind grass and post-processing.
  - Shared colliders, so the server's enemy movement matches the browser.
- **Not done / deferred:** NPCs, quests, enemy spawns and the anvil kept their old positions on purpose.
- **Verified:** typecheck, 105 unit tests and the build passed. Some browser tests failed in the headless
  sandbox the same way they fail on `main`; a local GPU run was requested before merging.

## 2026-11-22 22:59 — Character models, animations and character select (#3)
- **PR:** #3 `character-models` · merged 22:59 · made with Claude Code
- **Done:**
  - Skinned characters and animations replaced the procedural rigs; combat rules unchanged.
  - Character select on the title screen: Maria or Exo Gray, visible to other players.
  - Each attack clip is timed so its strike lands inside the rules' hit window.
  - About 4.6 MB of game files from about 370 MB of source packs; a reproducible conversion pipeline.
- **Not done / deferred:** the Sentinel and training post stayed procedural. No dodge roll (the packs have none).
- **Verified:** 105 unit tests, typecheck and build passed. Poses were checked on still images, not yet in a real browser.
