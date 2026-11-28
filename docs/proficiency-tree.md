# Proficiency tree: proposal

**Status: approved by the technical director on 2026-11-27, as written; the creative director reviews it (his
changes, if any, come in through review). Step 1 of section 6 is built: Alchemy trains from brewing and
strengthens potions, and the Proficiencies screen shows the three branches with their roots.** The creative
director suggested three branches (Smithing, Crafting, Alchemy); this proposal builds on that and on what
the game already has. Sections 1–4 are the decisions to approve, each with a recommendation. Section 5 says
how it connects to generated blueprints, and section 6 how it would be built and in what order.

## What exists today

- **Gathering proficiencies:** mining, woodcutting and herbalism, 1–100. They rise by gathering and give
  extra yield (`packages/game-rules/src/progression.ts`).
- **Blacksmithing mastery:** open-ended (no cap), starts at 10. It rises by forging and multiplies everything
  forged (the smith factor; Orla is mastery 100).
- **Brewing:** healing salves and stamina tonics from Emberleaf (`packages/crafting/src/alchemy.ts`). It
  trains nothing.
- **Combat:** weapon mastery per family and the skills it unlocks. That is a separate system and stays so
  (GDD decision D7: proficiencies are not combat skills).
- **Backlog:** "training perks and titles" (`docs/design-backlog.md` section 1, AF-017) asks for rewards that
  stat points can't buy. Perk choices in this tree would answer it.

## 1. The branches (needs approval)

**Recommended: three crafting branches, with gathering as their roots.**

| Branch | What it covers | Trained by | Its gathering root |
| --- | --- | --- | --- |
| **Smithing** | Weapons and armor | Forging at the anvil | Mining (ore, ironglass) |
| **Crafting** | Jewelry (rings, necklaces), capes and cloth, cosmetics, dyes, sets | Crafting at the workbench in the forge (new) | Woodcutting (wood, fibre) |
| **Alchemy** | Potions, brews, food, enchanting (imbuements such as Storm Arc) | Brewing, cooking and enchanting | Herbalism |

- **Smithing** is today's blacksmithing mastery, renamed in the interface. Nothing is lost.
- **Alchemy** starts with today's brewing, which begins to give XP.
- **Crafting** is new. It needs its first recipes, which come with generated blueprints (section 5). The
  workshop can already generate rings, necklaces and capes.
- **Gathering stays separate**, as the roots: each root feeds its branch's materials, and a high root can
  unlock a perk in its branch (section 3).

**Alternatives:** fold gathering into the branches (mining becomes part of Smithing). That's simpler, but a
player who only gathers and sells would have no progression of their own.

## 2. How a branch grows (needs approval)

**Recommended: levels by doing, plus a perk choice at milestones.**

- **Each branch has a level**, rising only by doing that work, as blacksmithing does now. The server awards it.
- **Levels have a base effect:** Smithing keeps the smith factor; Crafting raises the quality of crafted pieces;
  Alchemy raises potion strength and how many a brew makes.
- **Every 10 levels the player picks one of two perks** in that branch (a "node"). That gives ten choices per
  branch from 1 to 100, so two smiths at the same level can still differ.
- **Blueprints and recipes ask for a level** in a branch: "Smithing 25" (section 5).

**Scale:** Crafting and Alchemy run 1–100 like the gathering proficiencies. Smithing keeps its open-ended
mastery, since forging maths and saves already depend on it; its milestones are also every 10 levels.

**Alternative:** a point-buy tree (earn a point per level, spend it anywhere in a big tree). It's more flexible,
but it's much more to design, balance and show in three weeks.

## 3. Perks (needs approval; the creative director's call on the list)

**Recommended:** two choices per milestone, small and specific. A starter list for the first milestones
(levels 10, 20, 30), for the directors to change:

| Level | Smithing | Crafting | Alchemy |
| --- | --- | --- | --- |
| 10 | **Weaponsmith:** +5% damage on forged weapons · **Armorsmith:** +8% defense on forged armor | **Jeweler:** rings and necklaces roll one extra affix · **Tailor:** capes and cloth gain +5 max stamina | **Brewer:** potions +15% stronger · **Distiller:** each brew makes one extra potion |
| 20 | **Flux saver:** recipes need 1 less flux · **Steady hands:** the masterwork puzzle forgives one overwork | **Setwright:** set bonuses need one fewer piece · **Engraver:** name and inscribe your gear (cosmetic) | **Cook:** food lasts 50% longer · **Quick hands:** potion cooldown −2 s |
| 30 | **Ironglass adept:** ironglass recipes 3 levels sooner · **Masterwork eye:** +5% chance of a rarer roll | **Dyer:** recolour gear (cosmetic) · **Salvager:** break down gear for some materials back | **Enchanter:** may add a minor imbuement to forged gear · **Herbal lore:** +1 herb per gather |
| 10 (roots) | Mining 50: **Prospector**, finds richer ore lots | Woodcutting 50: **Fibre sense**, gathers fibre with wood | Herbalism 50: **Green thumb**, herbs regrow faster |

**Respec:** let players re-pick a branch's perks at Orla's for a coin fee that grows each time. It keeps
choices meaningful without trapping anyone.

**Titles:** reaching a branch's top milestone (e.g. Smithing 100) gives a title shown to other players
("Master Smith"). That covers the titles half of the backlog item.

## 4. Where it lives in the game (needs approval)

**Recommended:**
- **The Proficiencies screen** (it exists) shows the three branches with their roots, the level and next
  milestone of each, and the perk choices taken or waiting.
- **When a milestone is reached,** a toast says a perk choice is waiting; the player picks it on that screen.
- **Crafting needs a station:** the workbench already in the forge building.
- **Alchemy stays** in the inventory's brewing panel for now; a cauldron station can come later.

## 5. Generated blueprints and the tree

The creative director is designing blueprints with a rarity, a set or single item, lore, resources, an item
or set type, a **proficiency required**, and an estimated worth. The tree gives "proficiency required" a
precise meaning:

- **Every blueprint names a branch and a level**, e.g. `{ branch: 'smithing', level: 25 }`. Rarer blueprints
  ask for higher levels.
- **Weapons and armor** are Smithing blueprints, **jewelry, capes and sets** Crafting, **potions, food and
  enchantments** Alchemy.
- **Perks can change blueprints:** Ironglass adept lowers a requirement; Setwright changes set bonuses.
- The blueprint format itself is the next contract to agree (generated blueprints have to be stored on the
  character, made only by the server, and found again for every item forged from them).

## 6. How it would be built, and in what order

**Rules** in `packages/game-rules` (branches, levels, milestones, the perk table), awarded by the server like
all progression; saved in `progression.professions` (Crafting and Alchemy added, optional in old saves, so
nothing breaks). **Perk effects** apply where the thing happens: forging (`packages/item-gen`, `crafting`),
brewing, gathering, all on the server for signed-in players.

**Order, aiming at the 18th:**
1. **Alchemy branch:** brewing gives XP, its level strengthens potions, and the screen shows the three branches.
   About 2 days.
2. **Perk choices:** milestones, the choice on the screen, the first Smithing and Alchemy perks, and respec.
   About 3 days.
3. **Generated blueprints** (the contract, then storage and drops), with their branch and level requirements.
   About a week.
4. **The Crafting branch:** the workbench and the first jewelry and cape recipes, from generated blueprints.
   About 3–4 days.
5. **Titles** shown to other players. About a day.

Sets and trading come after the 18th. Sets build on Crafting and blueprints; trading is its own system.

## Open questions

- **Names:** "Smithing, Crafting, Alchemy", or something more in the setting's voice?
- **Does Crafting cover cooking,** or does Alchemy (as proposed)?
- **Should perks show on the character sheet** to other players, or only titles?
