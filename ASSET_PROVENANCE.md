# Asset provenance

Every asset the game ships, where it came from, and its license. Add a row whenever you add an asset.

| Asset | Used for | Source | License | Added by |
| --- | --- | --- | --- | --- |
| All characters, enemies, weapons, terrain, buildings, trees, effects | Everything currently in the game | Procedural: generated in code (`apps/web/src/entities`, `packages/world`) | Project code | Initial build |
| Favicon | Browser tab icon | Inline SVG in `apps/web/index.html` | Project code | Initial build |
| `maria.glb` (Maria WProp, J J Ong) | Player character option | Mixamo (Adobe) character, converted with `tools/asset-pipeline` (prop sword removed; its grip frame is reused for crafted swords) | Mixamo terms: royalty-free use in projects; don't redistribute the raw files on their own | Character pass |
| `exo.glb` (Exo Gray) | Player character option | Mixamo character | Mixamo terms | Character pass |
| `eve.glb` (Eve, J. Gonzales) | Master Smith Orla | Mixamo character | Mixamo terms | Character pass |
| `demon.glb` (Demon T, Wiezzorek) | Bram the Trader | Mixamo character | Mixamo terms | Character pass |
| `heraklios.glb` (Heraklios, A. Dizon) | Ironwood Scavengers | Mixamo character | Mixamo terms | Character pass |
| `maw.glb` (Maw J Laygo) | Foundry Warden (first-quest boss) | Mixamo character | Mixamo terms | Character pass |
| `anims.glb` | All character animation | Mixamo Sword and Shield Pack, Great Sword Pack, Pro Melee Axe Pack, Happy Idle; clip-by-clip sources are listed in `apps/web/public/models/manifest.json` (`clips.*.source`) | Mixamo terms | Character pass |

Still procedural (code): the Quarry Sentinel, training post, weapons, terrain, buildings, trees, effects.
Raw packs live in the shared Drive folder / `source-assets/` (git-ignored), never in the repo.
Do not add assets from other games (for example New World or Elden Ring).
