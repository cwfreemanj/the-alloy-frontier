# Asset pipeline: Mixamo packs → game models

Turns the raw Mixamo downloads into what the game loads from `apps/web/public/models/`:

- one `.glb` per character: single skeleton, plain bone names (`Hips`, `RightHand`…), WebP textures
  at 1024 px, meshopt-compressed geometry (about 0.4–1.4 MB each instead of 11–32 MB)
- `anims.glb`: every clip the game uses, stored relative to the rest pose it was authored on
  (rotation deltas, hips offset in hip-heights, forward travel removed so the game drives movement)
- `manifest.json`: heights, hand grip frame, each clip's duration / strike frame / travel speed,
  and content hashes (the game requests `file.glb?v=<hash>`, so updates are never stale-cached)

The game rebuilds each clip for each character's own rest pose at load
(`apps/web/src/entities/models/Characters.ts`), so any Mixamo character can use any clip.

## Run it

1. Put the raw packs in `source-assets/` at the repo root (git ignores it). Layout:
   ```
   source-assets/
     AF Zipped/               Maria WProp J J Ong.fbx, Exo Gray.fbx, Eve By J.Gonzales.fbx, ...
     Sword_and_Shield_Pack/   *.fbx
     Great_Sword_Pack/        *.dae (Mixamo's zipped .dae files are fine) + Y Bot.dae
     Pro_Melee_Axe_Pack/      *.dae + Ch50_nonPBR.dae
   ```
   Or point `SOURCE_ASSETS=/path/to/packs` at another folder with that layout.
2. `cd tools/asset-pipeline && npm install && npm run build`
3. Commit the changed files in `apps/web/public/models/` and add a row to `ASSET_PROVENANCE.md`.

## Adding or swapping things

- **A clip:** add it to `clips` in `build.mjs` (id → `[pack, file name without extension]`;
  set `effector: 'RightFoot'` for kicks so the strike frame is found on the foot), rebuild, then
  reference the id in `apps/web/src/entities/models/animSets.ts`.
- **A character:** add it to `chars` in `build.mjs`, rebuild, then use its id in `animSets.ts`.
- **Timing feel:** attack clips are fitted to the rules' windup/active/recovery with the `shape`
  numbers in `animSets.ts` (how many seconds of clip before/after the strike frame each phase
  shows). Hit timing itself lives in `packages/game-rules` and is unaffected.

## Notes

- DAE packs store a mid-animation frame as their rest pose, so they're retargeted against the
  pack's own T-pose character (`Y Bot.dae`, `Ch50_nonPBR.dae`). FBX packs carry a T-pose rest.
- A few Sword & Shield FBX files fail in three's FBXLoader ("Unknown property type"):
  kick, slash (3), impact, walk (2), strafe (2), crouching, crouching (2), death (2), sheath 1.
  Re-download them as FBX 2013/2014 or DAE if you want them.
- `render.mjs` can draw CPU-skinned contact sheets of a character playing clips (no GPU needed),
  handy for checking poses and the sword grip.
