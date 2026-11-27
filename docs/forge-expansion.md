# Forge expansion

The forge makes more than swords. **Phase 1 is built** (2026-11-27). Phase 2 is planned.

## Phase 1 (built)

**What a player can forge**, from five tabs at the anvil (Swords, Maces, Shields, Helmets, Body):

| Blueprint | Slot | Base | Materials | Flux | Mastery |
| --- | --- | --- | --- | --- | --- |
| Iron Mace | Main hand | 22 damage, 0.90× speed, 30 stagger (blunt) | 4 iron ore, 1 ironwood | 2 | 3 |
| Ironglass Mace | Main hand | 23 damage, 0.95× speed, 28 stagger (blunt) | 2 iron ore, 3 ironglass, 1 ironwood | 3 | 7 |
| Iron Heater Shield | Off hand | 14 defense | 3 iron ore, 2 ironwood | 2 | 0 |
| Ironglass Kite Shield | Off hand | 20 defense | 2 iron ore, 3 ironglass, 1 ironwood | 3 | 6 |
| Iron Kettle Helm | Head | 8 defense | 2 iron ore | 1 | 0 |
| Ironglass Crested Helm | Head | 12 defense | 1 iron ore, 2 ironglass | 2 | 5 |
| Iron Breastplate | Chest | 18 defense | 5 iron ore, 1 ironwood | 3 | 2 |
| Ironglass Lamellar Cuirass | Chest | 26 defense | 3 iron ore, 4 ironglass, 1 ironwood | 4 | 8 |
| Iron Platelegs | Legs | 12 defense | 4 iron ore | 2 | 1 |
| Ironglass Lamellar Legs | Legs | 17 defense | 2 iron ore, 3 ironglass | 3 | 7 |

**These are starter values.** Item generation is the creative director's area (`docs/equipment-contract.md`),
and every number here may change.

**How it works:**
- **Armor stats:** defense is crafted like a weapon's damage: smith mastery × material quality × flux × forge
  quality. Rarer pieces roll armor affixes: more defense, max health, max stamina, Vitality or Endurance.
  All equipped defense adds up; 100 defense halves a hit.
- **The mace** uses the sword's moves for now. It hits blunt, so the Quarry Sentinels take extra damage.
- **The server decides:** forging, equipping and every stat go through the same server-checked actions as swords.
- **The quest** still asks for a forged weapon: armor and shields don't count for those steps.
- **The forge screen** compares armor with the piece already in that slot, and shows defense where weapons
  show damage. Each type has its own 2D preview drawing.

**Looks.** The 3D looks come from the creative director's Model Workshop generator, vendored into
`apps/web/src/world/workshop/` (`equipment.js`, `resources.js`, `body.js`, and the updated `core.js`).
- It loads on demand as its own 48 KB (compressed) file, the first time someone has such an item.
- Each blueprint is built once per rarity and shared by everyone who has it.
- **The mace** is held in the right hand.
- **The shield** is strapped to the left forearm and **the helmet** sits on the head. Both are placed as the
  workshop fits its mannequin, using each character's own skeleton; helmets are scaled to the head.
  Checked on Maria and Exo.
- **Other players see them:** the avatar message carries the off-hand and head pieces (`gr`, optional, checked by
  the server).
- **Chest and leg armor** count for defense but **don't show on the character yet** (phase 2).

**Code:** blueprints and generation in `packages/item-gen`; forge screen in `apps/web/src/ui/ForgePanel.ts`
and `ItemView.ts`; looks in `apps/web/src/entities/Gear.ts`.

## For the creative director to review

1. **Numbers:** the table above, `ARMOR_AFFIXES` in `packages/item-gen/src/generate.ts`, and `armorRating` in `rating.ts`.
2. **Looks:** each blueprint's `look` (`type`, `shape`, `blend`) in `packages/item-gen/src/blueprints.ts`.
   Ironglass pieces use the `quarry_glass` blend, iron ones `emberhold_smithy`.
3. **Generator version:** looks are made from the vendored copy, so updating `equipment.js` restyles items
   on purpose, never by accident. Copy a new version over it when you want the game to follow the workshop.

## Phase 2 (planned)

- Fit chest and leg armor to Maria and Exo so they show on the character. The workshop sizes armor from its
  mannequin's measurements (`body.js`); the game's characters need their own, or a refit.
- More families from the workshop: axe, dagger, greatsword, staff, bow, and gloves, boots, pauldrons, capes.
- Movesets for non-sword weapons (needs animations).
